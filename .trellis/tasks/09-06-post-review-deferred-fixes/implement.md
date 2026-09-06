# 实施计划：审查遗留修复

按 PRD 顺序执行；每步独立验证，按阶段提交。

## 阶段 0：环境治理
- [ ] E1 复核 `server/dev.db` 为空库（大小/表数量），`pnpm --filter @write-now/server prisma:deploy` 建表；重跑此前失败的 fast/integration 测试确认消失。
- [ ] E2 `run-tests.cjs` fast 分支：require 改为 node:test `run({ files })` 编程式执行，await 后按失败数 `process.exit()`；验证 `pnpm --filter @write-now/server test` 能自然退出并输出汇总。
- [ ] 提交：`chore(server): 测试套件改为编程式执行并显式退出`（E1 为本地数据库状态，不产生代码提交）。

## 阶段 1：修复 1（投影计数器）
- [ ] 读 `DirectorEventProjectionService.ts` 相关函数；改分母为 `totalSteps ?? snapshot.steps.length`；`deferredChapterCount` 按 chapterOrder 去重。
- [ ] 新增测试（新文件，不碰徽标任务测试文件）：factSummary 存在时 x/totalSteps；重复 defer 事件计数去重。
- [ ] 运行新测试 + 既有 `directorEventProjection.test.js`。
- [ ] 提交。

## 阶段 2：修复 4（RAG 去重）
- [ ] 读 `RagIndexService.enqueueOwnerJob / enqueueReindex`；实现 per-owner 进程内互斥（链式 promise，参考 `agents/runtime/runLocks.ts` 的实现风格）。
- [ ] 评估部分唯一索引：确认 prisma schema 不支持部分索引（避免 migrate dev 漂移）则仅做进程内互斥并在代码注释与 spec 说明边界。
- [ ] 新增测试：并发 enqueue 同 owner 仅一个 queued 任务；不同 owner 不受影响。
- [ ] 提交。

## 阶段 3：修复 3（命令竞态）
- [ ] `recordCommandResult`：读-改-写放进 `prisma.$transaction(async tx => {...})`，事务内重读。
- [ ] `DirectorCommandService` 幂等键改为 `commandType:hashPayload`；create 捕获 P2002（Prisma 已有错误码判断工具？grep isMissingTableError 同层）后重查复用。
- [ ] 测试：并发同命令（stub prisma 时序）仅一条；既有 directorCommand 相关测试全绿。
- [ ] 提交。

## 阶段 4：修复 2（RuntimeStore）
- [ ] 读 `DirectorRuntimeStore.ts` 全文 + `withSharedRunLock` 实现与依赖方向。
- [ ] 缓存上限 + LRU 淘汰；mutateSnapshot 基线改 persisted；变更路径套 per-task 串行域。
- [ ] 测试：并发 recordStepStarted 两条事件均落盘；缓存超限淘汰。
- [ ] 提交。

## 阶段 5：修复 5（rebuildState）
- [ ] 改逐章删建 + 失败聚合（错误信息含失败章节序号列表）。
- [ ] 测试：第 2 章提取失败 → 第 1 章快照保留 + 错误信息明确。
- [ ] 提交。

## 阶段 6：修复 6 + 7
- [ ] character.ts take 上限（查看路由与前端调用后定值）。
- [ ] TaskCenterService 响应附加可选 `truncated` 标记（类型为可选字段，客户端不读不受影响）。
- [ ] anthropicClient 读空闲超时 + reader.cancel()。
- [ ] tryFixTruncatedJson 告警日志。
- [ ] provider.ts multipart 多参考图（image[] 字段）。
- [ ] 关注中心/任务中心终态停轮。
- [ ] 相关既有测试 + typecheck。
- [ ] 提交。

## 阶段 7：收尾
- [ ] release-notes / README 更新（readme-release-updater 流程）。
- [ ] wiki/spec 更新（trellis-update-spec：新增稳定性契约）。
- [ ] E3 排查记录写入任务目录。
- [ ] 收尾报告。

## 验证命令
- 单文件测试：`node --test tests/<file>.test.js`
- fast 套件：`pnpm --filter @write-now/server test`
- typecheck：`pnpm --filter @write-now/server build`、`pnpm --filter @write-now/client typecheck`
