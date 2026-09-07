# 技术设计：`payoff_overdue` 退出单章 blocking / 质量债

## 行为缺口

现在：账本逾期被合成 `payoff_overdue`（high）→ 进入当前章 `openIssues` → `hasBlockingIssues=true` → 章节不通过 → 一次 patch → `defer_and_continue` → 整章「待优化 / 留存风险」。

目标：逾期留在 Payoff Ledger 与写作上下文；单章完成态、patch、质量债只看本章正文问题。`payoff_missing_progress` 保持现状。

## 责任边界

| 层 | 继续负责 | 本刀停止做的事 |
|---|---|---|
| Payoff Ledger | 追踪窗口、逾期、合成诊断 issue | 不要求后文章节核销 |
| 章节 runtime | 字数、AI 腔、本章义务、验收/修复 | 不把 `payoff_overdue` 当 blocking |
| 章节质量债 | 本章未清的局部问题 | 不因全书逾期挂黄标 |
| 生成决策 | 写下一章 / 修本章草稿 | 不因逾期返回 `replan` |

不新建产品面板，不改账本 schema，不批量写 `riskFlags`。

## 共享判定

在 `shared/types/chapterCreativeContract.ts`（已有内部 payoff marker）或紧邻共享模块导出：

```ts
export function isLedgerOverdueIssueCode(code: string | null | undefined): boolean {
  return (code ?? "").trim().toLowerCase() === "payoff_overdue";
}
```

只匹配精确 code `payoff_overdue`。不匹配 `payoff_missing_progress`、`payoff/payoff_overdue` 合同标记、或文案。所有消费层必须用这个函数，禁止各写一份字符串判断。

## 数据流

```
PayoffLedger overdue
  → buildSyntheticPayoffIssues (仍产出 payoff_overdue，供账本诊断)
  → A. buildRuntimePackage.openIssues
  → B. AuditService 合并 synthetic audit reports
        ↓
  过滤：isLedgerOverdueIssueCode 的 issue
        不计入 blockingIssueIds / hasBlockingIssues
        不进入 patch blockingIssueCodes / repair 问题列表
        不进入 toReviewIssues / qualityLoop retention 信号
        ↓
  章节 pass / 定稿 只看本章问题
  逾期仍在 context.ledgerOverdueItems 给 writer/reviewer
```

## 改动点

### 1. Runtime 解耦 — `chapterRuntimePackageBuilders.ts`

计算 `blockingIssueIds` 时排除 `isLedgerOverdueIssueCode`。

`blockingLedgerKeys` 只来自仍属章节阻塞的合成项（本刀后 `payoff_overdue` 不再进入）。逾期账项继续通过 `ledgerOverdueItems` 给 replan 决策；`replanDecision` 已把 overdue 收成 `continue_with_warning`，不要再把逾期 key 标成 blocking。

`withChapterRepairContext` 的 issue 列表同样排除逾期，避免 patch 被要求「兑现第 3 章合同」。

`openIssues` 可以保留逾期项作 runtime 诊断，但 `hasBlockingIssues` 不得因其为 true。

### 2. Pipeline 质量环 — `chapterRuntimePipeline.ts`

`toReviewIssues()` 跳过 `payoff_overdue`。否则 `pass=true` 仍会把 high pacing 写进 `qualityLoop`，`classifyChapterQualityLoopRisk` 在没有 `defer_and_continue` 时会把 `overallStatus=risk` 判成 **blocking**，比现在更差。

`extractIssueCodes` / 归因可以仍记录逾期 code（诊断用），但不得单独导致 `pass=false`。

### 3. 人工复审 — `AuditService.buildLegacyIssues` + `buildChapterQualityLoopAssessment`

`buildLegacyIssues` 跳过 `payoff_overdue`，避免无 code 的 pacing ReviewIssue 再次驱动留存风险。

`buildRollingWindowSignal` 忽略 report issue code 为 `payoff_overdue` 的项。

`buildRetentionSignal` 不直接看到 code；只要上游 ReviewIssue 已过滤，信号不会因逾期变红。

`novelCoreReviewService` 无需改终态语义：过滤后若只剩逾期，assessment 为 `continue`，不写 `defer_and_continue`。

### 4. 修复 payload — `chapterRepairRuntime.ts`

`resolveIssueCodes` 排除 `payoff_overdue`，避免 `blockingIssueCodes` 把全书逾期塞给 patch。

### 5. 生成决策 — `GenerationDecisionEngine.ts`

删除 `overduePayoffs.length > 0 → replan`。

同时删除（或保持不可达地去掉）后面的 `stage_review && overdue → hold_for_review`。删掉 replan 后若保留后者，stage_review 任务会因逾期暂停，等于换一种方式把全书债压到当前章。逾期-only 走 `write_chapter`。`urgentPayoffs` 且无本章目标时，现有 `advance_payoff` 不动。

### 6. 存量读路径 — `readChapterQualityDebtDetails()`

在判定为 `non_blocking_quality_debt` 之后：若 `issueCodes` 非空且每一项都是 `payoff_overdue`，返回 `null`。

空 `issueCodes`（无归因）返回原 details。含任何其他 code（包括 `payoff_missing_progress`）返回原 details。

简易书架、参考面板、章节编辑器都走这个函数，前端无需各写过滤。

不 `UPDATE Chapter.riskFlags`。

## 兼容与回滚

- 旧章带 `payoff_overdue` 归因：黄标消失，正文与 `riskFlags` 原文不变。
- 混杂债 / 无归因：行为与改前一致。
- 回滚：还原共享判定与上述过滤即可；无迁移。

## 风险

- 只改 `hasBlockingIssues`、不改 `toReviewIssues`：通过章会被打成 blocking 质量环。测试必须覆盖「仅逾期 → qualityLoop 不是债也不是 blocking」。
- 只改 runtime 合成、不改 `AuditService`：人工复审会重新挂黄标。
- 过滤过宽误伤 `payoff_missing_progress`：本刀禁止。

## Wiki

稳定合同变化，完成后更新：

- `docs/wiki/workflows/chapter-production-chain.md`
- `docs/wiki/workflows/payoff-ledger-contract.md`

写清：`payoff_overdue` 是账本风险，不是单章留存/待优化来源。
