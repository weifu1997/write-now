# 2026-09 代码审查沉淀：六类反复出现的服务端缺陷模式

> 来源：2026-09-06 全库代码审查。本文记录可复用的失败模式与判定方法，供后续开发与 AI 代理在同类代码路径上直接套用，避免按文件逐个重新踩坑。

## 背景

对 server / client / desktop 做了一轮系统性审查，发现的问题在多个模块中呈现高度相似的形态。逐个修复已在代码中完成，本文只沉淀"模式"本身：什么代码形状会出什么问题、怎么在写代码时预防、怎么在 review 时识别。

## 模式一：worker 轮询回调里的 `void` 调用链会成为进程退出漏洞

**形状**：`setInterval(() => { void this.tick(); })` 或 `void this.processQueue()`，而 `tick`/`processQueue` 内部存在未被 catch 的 `await`（数据库 CAS 更新匹配 0 行、瞬时 SQLITE_BUSY 等）。

**后果**：Node 20+ 默认对 unhandledRejection 退出进程。一次租约过期（GC 停顿超过 leaseMs）就足以让整个服务端掉线。

**现行规则**：
- worker/tick 式方法必须自己兜底：前置步骤（租约、读库）失败记日志后等待下一轮；执行成功后的记账失败（`markFailedOrDead` 二次抛错）也不允许向上抛。
- 数据库 CAS 更新（`updateMany` 后检查 count）在"丢租约"场景下必然抛错，调用方要把它当正常路径处理，不是异常。
- 参考实现：`NovelSideEffectWorker.tick`、`ImageGenerationService.processQueue`。

## 模式二：SQLite 事务内 `PRAGMA foreign_keys` 是空操作

**形状**：迁移包装器把 SQL 包在 `BEGIN...COMMIT` 里执行，而迁移文件第一行写 `PRAGMA foreign_keys=OFF;`。

**后果**：PRAGMA 在事务内不生效，外键保持开启。重建表（建新表→拷贝→`DROP TABLE` 旧表→改名）时，DROP 的隐式 DELETE 会触发子表 `ON DELETE CASCADE`，静默清空子表全部数据（如 `BookAnalysisCharacter` 的弧线、场景、图片资产）。

**现行规则**：
- `server/src/db/runtimeMigrations.ts` 的 `applyMigration` 检测迁移 SQL 中的 `PRAGMA foreign_keys=OFF`，在事务外执行、结束后恢复原状。新增依赖该 PRAGMA 的桌面迁移无需再自行处理。
- 事务内合法的替代是 `PRAGMA defer_foreign_keys=ON`（只延迟约束检查，不能阻止级联删除）。
- 迁移文件本身不要改动已发布迁移的语义；wrapper 的检测是唯一的提升点。

## 模式三：Express 路径参数会先百分号解码再进入 `path.join`

**形状**：`z.string().trim().min(1)` 校验通过的路由参数（`jobId`、`panelId`、`filename`）被 `path.join(根目录, id, 文件名)` 拼进文件路径。

**后果**：`..%2F..%2F` 在路由匹配后解码成 `../..`，`path.join` 归一化后逃出资源目录。`path.basename` 只能保护最后一个文件名段，保护不了前面的 id 段。

**现行规则**：
- 漫画模块统一走 `server/src/services/comic/comicStoragePaths.ts` 的 `resolveComicStoragePath(subdir, ...rest)`：限定合法一级子目录 + 归一化后做包含性校验，越界返回 null 由调用方按 404 处理。
- 新增"请求侧 id → 文件路径"的代码时必须经过该入口（或等价的包含性校验），不允许直接 `path.join`。
- `res.setHeader("Content-Disposition", ...)` 的文件名同样要用 basename 后的值，防 header 注入。

## 模式四：`z.coerce.boolean()` 会把 `"false"` 变成 `true`

**形状**：query/body schema 里用 `z.coerce.boolean()` 表达"布尔过滤参数"。

**后果**：`Boolean("false")` 为 true，"仅不可批量"这类反向筛选永远查不出结果，且不报错。

**现行规则**：
- 布尔参数用 `z.union([z.boolean(), z.enum(["true", "false"])])` + transform，拒绝 "0"/"1"/任意字符串。
- schema 必须对"validate 中间件已写回一次"的输入幂等：`validate` 中间件会把解析结果（布尔、数字）写回 `req.query`，路由内若还有二次 `parse`，schema 要同时接受原始字符串与已转换形态。新增 transform 类字段时自查一次二次解析。

## 模式五：SSE 先发响应头、后做可失败的解析

**形状**：路由先 `initSSE(res)` 再 `await` 查线程/权限/种子消息。

**后果**：解析失败时响应头已提交，只能给一条"死流"（200 后立即断开）或触发 `ERR_HTTP_HEADERS_SENT`。

**现行规则**：
- 所有可能失败的解析（存在性、权限、参数展开）必须在 `initSSE` 之前完成，失败走正常 JSON 错误（如 `CreativeHubService.getThreadState` 抛 `AppError 404`）。
- `errorHandler` 顶部有 `res.headersSent` 守卫；流中途的错误由流式 helper 自己写 error 帧，不允许依赖全局错误处理器回 JSON。
- body-parser 的解析类错误（`entity.parse.failed`、`charset.unsupported` 等）在 `errorHandler` 里映射为 400/415，不要落入 500 分支。

## 模式六：客户端渲染根相对 `/api/...` 媒体地址在桌面端失效

**形状**：URL 构建器或服务端持久化的 URL 是 `/api/comic/...` 这类根相对路径，客户端直接塞进 `<img src>` / `<a href>` / `window.open`。

**后果**：打包后的桌面端用 `file://` 加载页面，根相对地址解析到 `file:///api/...`，图片全部裂开、导出打开失败。Web 开发（vite 代理）与 Web 生产（nginx 同源代理）会掩盖该问题。

**现行规则**：
- 媒体地址渲染前必须经 `client/src/api/images.ts` 的 `resolveImageAssetUrl`（已对 http/https/data/blob 直通）。
- 外部链接（抓取、厂商返回）经 `client/src/lib/internalNavigation.ts` 的 `safeExternalUrl`，只放行 http/https，防 `javascript:` 协议注入。
- Electron 主进程已配置 `setWindowOpenHandler`（http(s) 交给系统浏览器，其余拒绝）与 `will-navigate` 守卫；新增窗口时沿用。
