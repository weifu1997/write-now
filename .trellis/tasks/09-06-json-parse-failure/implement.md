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
      - 复核（2026-09-07）：`node --test tests/structuredInvoke.test.js` → 22/22 全绿（含
        heals mid-string truncated JSON / resolveRepairMaxTokens / elevated maxTokens /
        finish_reason length truncated 四条）。
- [x] 6. 复核：commit 已完成 = `10765991 fix(llm): 修复结构化输出截断僵局，提升生成与修复预算并增强截断恢复`。
      注：整 suite `pnpm --filter @write-now/server test` 有 2 处与本任务无关的既有失败
      （`tests/tools.test.js` bookAnalysisTools zod 声明位置契约，源 commit 2026-06；
      `tests/worldContextGateway.test.js` 缺 openingOnly 断言，源 commit 2026-08）。
      均早于本任务、本任务未触碰相关文件，不在本任务验收范围内。
- [x] 7. 合入 beta：`6916caf5 Merge branch 'feature/structured-output-budget-fix' into beta`（已完成）。
- [x] 8. 部署：容器 `ai-novel-api-1` 镜像 2026-09-06 22:05 构建（晚于 22:03 merge），容器内
      `/app/server/dist` 已含 `resolveRepairMaxTokens` / `CHAPTER_EXECUTION_CONTRACT_MAX_TOKENS` 标记。
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
