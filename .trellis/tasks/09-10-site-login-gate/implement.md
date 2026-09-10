# Implement：站点登录门禁

从 `beta` 拉功能分支 `feature/09-10-site-login-gate`，不要直接在 `beta` 上改。

## Checklist

1. 新增 `server/src/platform/auth/`：配置解析、会话 cookie、登录限流。覆盖桌面端 production 不得默认要求门禁。
2. 改写 `server/src/middleware/auth.ts`，并在 `createApp()` 对 `/api` 全局挂载；公开接口白名单按 design。
3. 增加登录/退出/状态路由，挂到 `/api/auth`。
4. 前端 `apiClient`、SSE、LLM 实况 `fetch` 带 cookie；401 回到登录页且不刷普通错误 toast。
5. 增加 `AuthGate`、`/login` 页、未配置提示页；登录页不进入 `AppLayout`。
6. 门禁开启且已登录时，导航提供退出。
7. `infra/docker-compose.yml`、`.env.example`、`docs/deploy/docker.md` 写明 `SITE_AUTH_USERNAME` / `SITE_AUTH_PASSWORD`，不放默认密码。
8. 后端测试：未配置 503、未登录 401、登录成功后可访问、健康检查匿名、桌面 runtime 默认免登录、漏挂路由也被挡。
9. 前端契约测试：存在登录路由、AuthGate、`withCredentials` / `credentials: "include"`。
10. wiki：新增站点门禁页，并挂到 `docs/wiki/README.md`。提交前按 release-notes 流程更新用户可见说明。

## Validation

```bash
pnpm --filter @write-now/server exec tsc -p tsconfig.json --noEmit
pnpm --filter @write-now/client exec tsc -p tsconfig.json --noEmit
pnpm --filter @write-now/server exec node --test tests/siteAuth*.test.js
pnpm --filter @write-now/client exec node --test tests/siteAuthContracts.test.js
```

UI 交互验收留给用户，不跑 Playwright/浏览器。

不默认重跑全量 `pnpm build`。若改到 compose/nginx 契约，再补最小部署文档核对。

## Risky files

- `server/src/app.ts`：全局中间件顺序，避免健康检查被挡。
- `client/src/api/client.ts` 与所有裸 `fetch`：漏带 cookie 会导致登录后流式功能失败。
- `desktop/src/runtime/server.ts`：已有 `AI_NOVEL_RUNTIME=desktop`，不要改成要求登录。
- `infra/docker-compose.yml`：不要写入可用的默认密码。

## Rollback

回退该分支或清空服务器上的站点凭证配置，并确认桌面端仍免登录。无数据库迁移。
