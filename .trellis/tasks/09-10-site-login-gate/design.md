# Design：站点登录门禁

## Architecture

单实例站点门禁：一份部署共用全部数据，登录只证明“被允许进入这台服务器上的这个实例”。

不新增用户表，不改小说/设置归属。凭证来自启动期环境变量，符合配置规范里“密钥走 env、不进设置面板”的边界。

鉴权实现放在平台层，不散落到各个业务路由：

- `server/src/platform/auth/`：读取配置、签发/校验会话、登录限流
- `server/src/middleware/auth.ts`：真正执行门禁
- `server/src/platform/auth/http/authRoutes.ts`：登录、退出、状态
- 在 `createApp()` 里对 `/api` 做一次全局挂载，覆盖现有漏挂 `authMiddleware` 的路由

前端增加独立登录页和 `AuthGate`，登录页不进入带侧栏/工作台数据请求的 `AppLayout`。

## Gate Rules

按启动配置分成三种状态：

1. **不要求门禁**：本机开发默认；桌面端 `AI_NOVEL_RUNTIME=desktop` 默认。业务接口保持现有免登录。
2. **要求门禁且已配置**：校验 HttpOnly 会话 cookie。无会话返回 401。
3. **要求门禁但未配置用户名或密码**：除公开接口外返回 503，提示配置环境变量。不得放行工作台。

`SITE_AUTH_REQUIRED` 默认值：

- `AI_NOVEL_RUNTIME=desktop` → `false`
- 其他且 `NODE_ENV=production`（含 Docker API 镜像）→ `true`
- 其余开发环境 → `false`

不能只用 `NODE_ENV=production` 判断，因为桌面端打包服务也是 production。

环境变量：

- `SITE_AUTH_USERNAME`
- `SITE_AUTH_PASSWORD`
- `SITE_AUTH_REQUIRED`（可选覆盖）
- `SITE_AUTH_SECRET`（可选；缺省时由用户名+密码派生，改密码后旧会话失效）

Docker Compose 必须显式要求设置用户名和密码，不写默认值。

## Session

登录成功后设置 HttpOnly cookie：

- 名称：`wn_site_session`
- 内容：HMAC 签名的到期时间（默认 7 天）
- `Path=/`
- `SameSite=Lax`
- `Secure` 仅在 HTTPS（含 `X-Forwarded-Proto=https`）时开启
- 用户名和密码用 `crypto.timingSafeEqual` 比对
- 登录接口做进程内限流，降低暴力试密码

不引入 JWT 库、session 表、bcrypt。env 里已经是部署者持有的明文口令，启动后做常时比较即可。

## Public Endpoints

全局门禁允许匿名访问：

- `GET /api/health`
- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `/api/auto-director/channel-callbacks/*`（继续走既有通道令牌/签名）

其余 `/api/*` 在门禁开启时都必须过会话。

`GET /api/auth/status` 返回：

```ts
{
  required: boolean;
  configured: boolean;
  authenticated: boolean;
}
```

前端用它决定：直接进工作台、显示登录页，还是显示“尚未配置访问口令”。

## Frontend

`main.tsx` 顺序：`DesktopBootstrapBoundary` → `ServerStartupGate` → `AuthGate` → `AppRouter`。

- 健康检查仍走 `/api/health`，不受登录影响。
- `AuthGate` 在服务就绪后读 `/api/auth/status`。
- `required && !configured`：全屏说明去配置环境变量，不渲染工作台。
- `required && !authenticated`：渲染 `/login`，不挂载 `AppLayout`。
- 其余：正常工作台。

HTTP 客户端必须带 cookie：

- `apiClient` 设 `withCredentials: true`
- `useSSE`、`useLlmLiveFeed` 等 `fetch` 设 `credentials: "include"`
- 401 且门禁开启时，清会话并回到登录页；不要把“未登录”当成普通业务 toast 刷屏

登录页：用户名 + 密码，文案说明这是进入写作工作台。导航栏在已登录且门禁开启时提供退出。视觉按项目规则：输入框可以有边框，页面本身不用卡片套卡片。

## Compatibility

- 本机 `pnpm dev`：默认不要求门禁。
- 桌面端：默认不要求门禁，不改启动流程。
- Docker：API 镜像 `NODE_ENV=production`，默认要求门禁；未配账号密码则拒绝业务访问，健康检查仍通过。
- 现有按路由挂的 `authMiddleware` 可保留为同一实现，全局挂载后重复调用必须幂等。
- 不迁移数据库。

## Rollback

去掉或清空 `SITE_AUTH_REQUIRED` / 凭证相关 env，并回退代码后，行为回到当前免登录。会话 cookie 无服务端存储，回退无需清表。

## Risks

- 只挡前端、漏挡 API：用全局 `/api` 中间件，并用测试覆盖短剧/导演/实况流等漏挂路径。
- 桌面端被误判为必须登录：门禁默认排除 `AI_NOVEL_RUNTIME=desktop`。
- 登录后 SSE 仍 401：所有 `fetch` 补 `credentials: "include"`。
- HTTP 部署误加 `Secure` cookie：仅 HTTPS 时开启 Secure。
- 未配置却 fail-open：production 非桌面默认 `required=true`，未配置返回 503。
