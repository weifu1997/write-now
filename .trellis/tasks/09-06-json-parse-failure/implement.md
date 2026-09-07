# 执行计划：结构化输出预算不足/修复预算复用的截断僵局

> 上下文顺序：本文件 → `prd.md` → `design.md`。改动全部在 server 侧，改完跑 server 测试，
> 重新构建 API 镜像后由用户在小说页重跑暂停章节验证。

## 步骤

- [x] 1. 建 feature 分支（基于 beta）：`git checkout -b feature/structured-output-budget-fix beta`
- [x] 2. `chapterExecutionContractGeneration.ts`：顶部加常量
      `const CHAPTER_EXECUTION_CONTRACT_MAX_TOKENS = 6_400;`（注释预算依据），`options.maxTokens` 改引常量。
- [x] 3. `structuredInvokeParser.ts`：
      - 新增导出纯函数 `resolveRepairMaxTokens({ maxTokens, profile })`（按 design §2）；
      - 两处 `repairWithLlm` 调用点 `...input` 后覆盖 `maxTokens: resolveRepairMaxTokens(...)`；
      - `tryFixTruncatedJson` 增加 `closeDanglingStringIfNeeded` 前置补引号。
- [x] 4. `structuredInvoke.ts`：`invokeStructuredAttempt` 流式循环捕获末 chunk
      `response_metadata.finish_reason / stop_reason`，归一 `finishReason`；`invoke_done`/`invoke_error`
      日志加入 `finishReason` 与 `truncated`（`length|max_tokens` 且解析失败时）。
- [x] 5. 单测（`server/tests/structuredInvoke.test.js`）：
      - 悬挂字符串截断输出经本地启发式直接解析（`maxRepairAttempts:0`，不触发 repair）；
      - repair 收到提升后的 maxTokens（stub `factory.getLLM` 捕获 options.maxTokens，断言 ≥ profile safe）；
      - （可测层）finish_reason 归一函数。运行：`pnpm --filter @write-now/server test`。
- [ ] 6. 复核：`trellis-check` / 类型检查通过，commit（server 侧改动，单 commit 归并）。
- [ ] 7. 合入 beta：`git checkout beta && git merge feature/...`（保留 feature 分支合入历史）。
- [ ] 8. 部署：按 `infra/docker-compose.yml` 重新构建 `ai-novel-api` 镜像并重启容器。
- [ ] 9. 验收（用户参与）：小说页恢复/重跑暂停章节的执行合同生成；日志确认该章 `invoke_done`
      后不再 `pause_for_manual`。若仍截断，查看新日志 `finishReason=length` 判断端点侧上限（退出条件见 prd Non-goals）。

## 验证命令

```bash
pnpm --filter @write-now/server test
# 部署（infra 目录）
docker compose -f infra/docker-compose.yml up -d --build ai-novel-api
docker logs -f ai-novel-api-1 | grep -E "chapter_execution_contract|structured.invoke"
```

## 回滚

server 侧纯改动，回滚=合入前 `git revert` 该 commit 或丢弃 feature 分支；代码改动不迁移数据。
