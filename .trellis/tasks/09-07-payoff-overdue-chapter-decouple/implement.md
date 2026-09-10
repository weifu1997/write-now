# 执行计划：第一刀只拆 `payoff_overdue`

> 上下文顺序：本文件 → `prd.md` → `design.md`。先共享判定，再 runtime/决策/读路径，最后聚焦测试。

## 步骤

- [x] 1. 共享函数 `isLedgerOverdueIssueCode`：只认精确 `payoff_overdue`。优先放在已有 payoff marker 附近（`shared/types/chapterCreativeContract.ts`），并保证 server/client/shared 测试都能引用。
- [x] 2. `chapterRuntimePackageBuilders.ts`：`blockingIssueIds` / `hasBlockingIssues` / `blockingLedgerKeys` / repair context issues 排除逾期 code。`openIssues` 可保留诊断项。
- [x] 3. `chapterRuntimePipeline.ts` `toReviewIssues` 跳过逾期；确认仅逾期时 `pass=true` 且不会因 pacing 文案进入质量债。
- [x] 4. `chapterRepairRuntime.ts` `resolveIssueCodes` 排除逾期。
- [x] 5. `AuditService.buildLegacyIssues` 与 `buildChapterQualityLoopAssessment` 的 rolling-window 报告忽略逾期 code，堵住人工复审回写。
- [x] 6. `GenerationDecisionEngine`：去掉 overdue → `replan`；不要让原先不可达的 overdue → `hold_for_review` 复活。逾期-only → `write_chapter`。
- [x] 7. `readChapterQualityDebtDetails`：未解决 code 非空且全部为 `payoff_overdue` 时返回 `null`；空 code / 混杂 code 不变。
- [x] 8. 测试：
      - runtime：仅逾期 → `hasBlockingIssues=false`；逾期+prose high → 仍 blocking。
      - quality loop：仅逾期 ReviewIssue/report 不产生 retention 失败；读路径仅逾期债 → `null`，混杂/`payoff_missing_progress`/无归因不变。
      - 决策引擎：overdue-only → `write_chapter`（替换现有「escalates to replan」用例）；`stage_review`+overdue 也不得 `hold_for_review`。
      - 账本：`buildSyntheticPayoffIssues` 仍产出 `payoff_overdue`（账本诊断保留）。
- [x] 9. 聚焦验证（见下方命令）。通过后再按仓库规则更新 wiki 与（若有用户可见变化）release notes。
- [ ] 10. 不改 `server/dev.db`，不写 SQL 清债。

## 验证命令

```bash
pnpm --filter @write-now/shared build
node --test server/tests/chapterRuntimePackageBuilders.test.js \
  server/tests/chapterRuntimePipeline.test.js \
  server/tests/chapterQualityLoop.test.js \
  server/tests/generationDecisionEngine.test.js \
  server/tests/payoffLedgerShared.test.js \
  server/tests/replanDecision.test.js
```

若 AuditService 有现成单测，补一条「synthetic overdue 不进入 legacy ReviewIssue」后一并跑。

不默认跑 `pnpm --filter @write-now/server test` 全量。UI 验收留给用户：已完成书里仅逾期的章节应收成绿色完成，混杂债仍黄。

## 回滚

无迁移。回滚即还原共享判定与过滤。历史 `riskFlags` 未改，回滚后仅逾期债会再次显示待优化。

## `task.py start` 前核对

- 第一刀只拆 `payoff_overdue`，不拆 `payoff_missing_progress`。
- 不批量 UPDATE `riskFlags`。
- 当前分支已有无关改动（`feature/director-finalize-wait-retry` 工作区）。实施本刀前应在干净 feature 分支上进行，或明确不把那些文件打进本任务提交。
