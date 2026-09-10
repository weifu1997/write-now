# 逾期伏笔从单章质量债解耦

## Goal

长篇自动写完后，章节完成态只反映本章正文是否可阅读、是否已定稿。已经超过兑现窗口的全书伏笔（`payoff_overdue`）留在 Payoff Ledger，不再把后文章节打成「待优化 / 留存风险」，也不再要求单章 patch 去核销。

## Background

自动导演用 `defer_and_continue` 保证 150 章吞吐，这层底座保留。当前缺陷是：Payoff Ledger 的 `overdue` 被合成 `payoff_overdue`（severity=`high`）后进入当前章 audit，驱动 `hasBlockingIssues`、章节 `pass=false`、一次 patch、以及章节 `qualityLoop` 质量债。第 3 章合同窗口的承诺会在第 74 章变成「留存风险」。

本任务只做第一刀：切断 `payoff_overdue` 这条错误边。全书结账、批量清债、新的书级承诺面板不在本刀。

## Confirmed Facts

### 存量债落在哪里

- 唯一持久化来源是 `Chapter.riskFlags.qualityLoop`，不是 `QualityReport` / `AuditReport` 数量。
- 简易书架把 `readChapterQualityDebtDetails()` 非空投影成整章 `quality_debt`（琥珀色「已保存 · 待优化」），优先级高于 `completed`。
- 专业工作台把 `chapter_retention_contract` 失败信号翻译成「留存风险」。
- 本环境 `server/dev.db` 当前 0 本小说、0 条伏笔、0 章。下面的分类来自写入合同，不是这台机器上的行计数。

### 新债怎么写进去

1. `buildSyntheticPayoffIssues()` 把窗口已过的账项合成 `payoff_overdue`（severity=`high`）。
2. `buildRuntimePackage()` 把它并入 `audit.openIssues`；`high/critical` 计入 `hasBlockingIssues`。
3. `runPipelineChapterWithRuntime()` 只要 `hasBlockingIssues` 就 `pass=false`，最多一次 patch，失败则 `defer_and_continue`。
4. `toReviewIssues()` 丢掉原始 `code`，只保留 `category=pacing`。`buildRetentionSignal()` 把 pacing/coherence/logic 高严重度记成 `chapter_retention_contract`，前端显示「留存风险」。
5. 归因里的 `firstFailureIssueCodes` / `secondFailureIssueCodes` 仍保留原始 `payoff_overdue`。
6. 第二条注入边：`AuditService` 合并 `buildSyntheticAuditReports()` 后，人工复审也会把逾期打成章节质量债。

### 存量债三类，识别能力不同

| 类型 | 如何识别 | 第一刀能否处理 |
|---|---|---|
| **仅 `payoff_overdue`** | 归因 / 信号 code 去掉空值后只剩 `payoff_overdue` | 读路径隐藏待优化，不改正文、不改 `riskFlags` |
| **混杂债** | 同时有 `payoff_overdue` 和任何其他 code（含 `payoff_missing_progress`、`prose_*`、`LENGTH_*`） | 不能整章关闭；切断新写入后，剩余问题仍显示待优化 |
| **无归因旧债** | 只有 `terminalAction=defer_and_continue` 和「留存风险」文案，没有原始 issue code | **不能**凭文案猜测清掉 |

因此第一刀禁止批量改写历史 `riskFlags`。只允许：停止新污染；对「未解决 code 全部是 `payoff_overdue`」的记录做读路径收敛。

### 相邻信号（本刀不拆）

- `payoff_missing_progress`：窗口内该推进，仍可能是本章义务。合成项是 `medium`，单独不会把 `hasBlockingIssues` 打成 true。验收闸门打出的同名 code 也仍属单章问题。
- `payoff_paid_without_setup` / `payoff_regressed`：本章写错兑现，仍属单章缺陷。
- `GenerationDecisionEngine` 见到 `overduePayoffs` 仍返回 `replan`，与现行「逾期不得单独停全书」合同冲突。其后还有一条当前不可达的 `stage_review + overdue → hold_for_review`；删掉 `replan` 后不得让这条暂停路径复活。

## Requirements

- R1. 账本合成的 `payoff_overdue` 不得进入 `hasBlockingIssues`，不得单独让章节 `pass=false`。
- R2. `payoff_overdue` 不得进入 patch_repair 的 blocking issue codes，不得驱动 `chapter_retention_contract` / 「留存风险」。
- R3. 仅因 `payoff_overdue` 失败的章节，不得再写入章节级 `qualityLoop` 待优化；正文可用时按已完成定稿。人工复审同样不得仅因逾期重新打上待优化。
- R4. 逾期伏笔仍可出现在写作/审校的账本上下文（`ledgerOverdueItems`）里，作为全书承诺压力，但不能改变本章完成态。
- R5. `GenerationDecisionEngine` 不得仅因 `overduePayoffs` 返回 `replan` 或 `hold_for_review`。逾期-only 继续写当前章。
- R6. 读路径：若存量债未解决 code 全部是 `payoff_overdue`，章节列表不得再显示「待优化」；混杂债和无归因旧债保持原样。
- R7. 不迁移、不批量改写历史 `riskFlags`，不覆盖用户正文。
- R8. 本刀不把 `payoff_missing_progress` 移出单章质检。

## Acceptance Criteria

- [ ] AC1. 给定第 3 章窗口已逾期、第 74 章正文满足本章细纲且无其他阻塞问题：第 74 章 `pass=true`（或等价定稿），`chapterStatus=completed`，不出现章节 `quality_debt`。
- [ ] AC2. 同上条件下，runtime 的 `hasBlockingIssues` 为 false；patch 不被 `payoff_overdue` 触发；质量环信号没有 `chapter_retention_contract` 失败。
- [ ] AC3. 第 74 章若同时有 `prose_*` 等高严重度局部问题：局部问题仍可记债并显示待优化；原因/code 不再把全书逾期说成「本章留存风险」。
- [ ] AC4. 仅 `overduePayoffs` 非空、无其他停机信号时，`decideNextAction()` 返回 `write_chapter`，不返回 `replan` 或 `hold_for_review`。
- [ ] AC5. 存量 `qualityLoop` 未解决 code 只有 `payoff_overdue` 时，书架/工作台投影为已完成，不显示琥珀色待优化。
- [ ] AC6. 无归因、或混有包括 `payoff_missing_progress` 在内的其他 code 的存量债，投影行为与改前一致。
- [ ] AC7. 聚焦测试覆盖 runtime 解耦、决策引擎、质量债读路径、质量环信号；不跑全量套件。

## Out of Scope

- 全书收官结账、伏笔批量核销、后文 `paid_off` 回写前文章节 `riskFlags`。
- 新建「未兑现承诺」产品面板。
- 启发式清理无归因「留存风险」。
- 把 `payoff_missing_progress`、`payoff_paid_without_setup`、`payoff_regressed` 移出单章质检。
- 改变 `defer_and_continue` 对真正单章问题（字数、AI 腔、本章 must-hit）的保底策略。

## Technical Notes

- 关键边：`payoffLedgerShared.buildSyntheticPayoffIssues` → `chapterRuntimePackageBuilders.buildRuntimePackage` 与 `AuditService` 合成报告 → `chapterRuntimePipeline` pass 判定 / 人工复审 → `ChapterQualityClosure` / `qualityLoop` → `readChapterQualityDebtDetails` → 简易书架 `quality_debt`。
- `ReviewIssue` 无 `code` 字段。质量环必须在仍持有 code 的 runtime/audit 层过滤 `payoff_overdue`，不能等压成 pacing 文案后再猜。
- 读路径收敛必须落在 `readChapterQualityDebtDetails()`，让简易书架、专业工作台和章节编辑器共用。
