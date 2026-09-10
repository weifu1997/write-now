# 站点登录门禁

## 背景

产品按本机和桌面单实例设计：小说、模型密钥和设置都在同一份数据库里。Docker 可以把整栈暴露到服务器端口，但原先没有登录，公网任何人都能进入工作台。

这里需要的是挡住未授权访问，不是多用户账号系统。桌面端打包进程也会把 `NODE_ENV` 设为 `production`，因此不能只靠这个变量判断必须登录。

## 决策

采用单实例站点门禁：一份部署共用全部数据，登录只证明被允许进入当前实例。凭证走启动期环境变量，不进设置面板，不新增用户表。

## 当前规则

- Docker / `NODE_ENV=production` 且不是桌面运行时，默认要求门禁。
- `AI_NOVEL_RUNTIME=desktop` 时默认不要求门禁，保持本机应用免登录。
- 本机 `pnpm dev` 默认不要求门禁。可用 `SITE_AUTH_REQUIRED=true` 加账号密码做本地验证。
- 要求门禁但未配置 `SITE_AUTH_USERNAME` 或 `SITE_AUTH_PASSWORD` 时，除健康检查、登录状态和自动导演频道回调外拒绝访问。
- 业务接口由 `createApp()` 对 `/api` 全局挂载 `authMiddleware` 拦截，不能只挡前端页面。
- 会话使用 HttpOnly cookie，默认 7 天；HTTPS 才加 Secure。
- 钉钉/企微频道回调继续使用既有通道令牌，不要求浏览器登录 cookie。
- compose 和示例配置不得写入可直接使用的默认密码。

## 示例

推荐做法：

- 服务器启动前设置 `SITE_AUTH_USERNAME` 和 `SITE_AUTH_PASSWORD`。
- 前端在服务健康检查通过后再读取 `/api/auth/status`，未登录只渲染登录页，不挂载工作台数据请求。
- axios 和流式 `fetch` 都带 cookie。

禁止或不推荐的做法：

- 用 `NODE_ENV=production` 单独判断必须登录，误伤桌面端。
- 只在部分路由挂鉴权，漏掉短剧、漫画、市场雷达、自动导演或 LLM 实况流。
- 把站点口令放进设置面板或数据库用户表。

## 失败模式

- 公开路径必须先规范化再判断，禁止用原始 URL 前缀放行 `/api/health/../novels` 这类路径。
- 打开页面能进工作台、直接请求 API 也能拿到数据：先查全局 `/api` 中间件是否生效，再查 cookie 是否随请求发送。
- 桌面端启动后要求登录：查 `AI_NOVEL_RUNTIME` 是否为 `desktop`，以及是否被 `SITE_AUTH_REQUIRED=true` 覆盖。
- 登录后流式生成失败：查对应 `fetch` 是否带 `credentials: "include"`。
- Docker 启动后提示未配置访问账号：查 compose 是否读到用户名和密码，而不是把健康检查失败当成登录问题。

## 相关模块

- `server/src/platform/auth/`
- `server/src/middleware/auth.ts`
- `client/src/components/layout/SiteAuthGate.tsx`
- `infra/docker-compose.yml`
- `docs/deploy/docker.md`

## 来源文档

- 配置项归属与可见性规范：`./configuration-conventions.md`
- Docker 部署指南：`../../deploy/docker.md`
