# Payoff Ledger 来源与同步合同

## Background

Payoff Ledger 负责跨章承诺、伏笔、推进窗口和兑现状态。它不是新的故事规划器，也不负责记录已经发生的所有事实；它将 Book Contract、Story Macro、卷开放回报、章节回报引用和正文观测等既有来源收敛成唯一账本。

如果书级承诺只进入章节写作上下文而没有进入 Payoff Ledger，系统会出现两套事实：writer 知道第 3/10/30 章要交付什么，但后续规划、审校和连续性读取无法稳定追踪这些承诺。

## Decision

Book Contract 的 `chapter3Payoff / chapter10Payoff / chapter30Payoff` 是 Payoff Ledger 的稳定书级来源。它们通过固定 `refId` 和目标窗口进入现有 AI 同步 Prompt：

| refId | 目标窗口 |
| --- | --- |
| `book_contract.chapter3Payoff` | 1–3 章 |
| `book_contract.chapter10Payoff` | 4–10 章 |
| `book_contract.chapter30Payoff` | 11–30 章 |

固定窗口是对 Book Contract 结构化字段的确定性投影。语义去重、账项合并、当前状态和兑现证据判断仍由注册 Prompt 的结构化 AI 输出负责。

## Current Rule

- 每个非空 Book Contract 阶段回报都必须在 AI 输出的某个账项中保留固定来源引用。
- Book Contract 来源使用现有 `major_payoff` 类型，`refId` 用于区分来源，不增加数据库枚举或迁移。
- 合并后的账项必须保持 `book` scope，且截止章不得晚于 Book Contract 的承诺章。
- AI 输出遗漏固定来源或放宽截止窗口时，`postValidate` 必须失败并进入 semantic retry；不得由代码静默伪造账项。
- Book Contract 保存时只比较三个阶段回报。格式化空白变化不触发同步，语义文本变化通过持久副作用队列触发同步。
- 同步任务使用现有 `NovelSideEffectJob` 的幂等、租约、重试和 dead 状态，不在保存请求中等待 LLM。
- 同步失败时保留上次成功账本和 stale 风险信号，不删除已有内容。
- AI 对账完成后必须执行 Book Contract 固定来源的生命周期收口。尚未终结、未被本轮输出复用且来源全部属于 `book_contract.*` 的旧账项，在来源被移除或被新账项接管时退出当前正文义务。
- 退出义务的旧账项复用 `failed / 已失效` 状态，并记录 `source_superseded` 风险原因。原始标题、来源引用和兑现证据必须保留；`paid_off` 永不退役，混合其他有效来源的账项保守保留。
- `source_superseded` 账项跳过 `sync_stale` 标记，并且后续重复同步不得反复改变其终态。它们不进入 pending、urgent、overdue 分类，也不生成开放 Payoff 冲突。

## Replan Gate

- Payoff 逾期是账本风险，不是单章留存失败，也不是全书计划失配的确定性证据。逾期距离、当前章窗口命中和当前章显式引用都不得单独升级为 `stop_for_replan`，不得进入章节 `hasBlockingIssues` / patch / `qualityLoop` 待优化。
- `nextAction=replan`、人工强制或章节验收确认 `plan_misalignment` 可以输出 `stop_for_replan`。高优先级章节审计只能输出 `local_patch_plan`。生成决策不得仅因 `overduePayoffs` 返回 `replan` 或 `hold_for_review`。
- 章节生成闸门不得把账本合成的 `payoff_overdue` 当成阻断审核项。全书自动推进和质量债自动修复遇到待审核状态提案时，只要没有真正的单章审计问题，就应继续审校/修复已保存正文，而不是暂停整批任务。
- 所有全局调用方必须以 `action === "stop_for_replan"` 为最终闸门。`recommended` 可以表达局部处理建议，但不能单独暂停章节批次、写入 `PIPELINE_REPLAN_REQUIRED` 或创建 `replan_required` failure classification。

## Ownership Boundaries

- Book Contract：定义整本书在关键早期节点向读者交付什么。
- Payoff Ledger：追踪这些承诺及其他伏笔的来源、窗口、推进和兑现状态。
- Reader Experience Contract：把当前章应承担的回报转换为正文可见的欲望、阻力、转折、净变化和钩子责任。
- Novel Fact Ledger：只记录正文验收或观测确认后已经发生的不可逆事实。
- Replan：只有结构化 AI/runtime 决策明确要求重排邻近章节时才进入。窗口内待推进（`payoff_missing_progress`）仍可作为本章义务；已经逾期的 `payoff_overdue` 留在账本，不记到后文章节质量债。

## Compatibility

本规则不增加数据库列。旧账本没有 Book Contract 来源引用时仍可读取，并会在下一次相关同步中由 AI 重新归并。旧 Prompt 调用缺少 `bookContractPayoffs` 输入时按空来源处理，避免历史预览或恢复路径崩溃。

## Failure Modes

- **Book Contract 已修改但账本不变**：检查 `book-contract:updated` 是否带有 `payoffChanged=true`，以及 `payoff.bookContractSync` 副作用任务状态。
- **同一承诺出现多个账项**：检查固定 `refId` 是否原样保留，以及账本身份归并是否复用未完成的同名项。
- **Book Contract 改写后旧承诺仍进入正文**：检查旧账项是否只有 `book_contract.*` 来源、AI 新输出是否接管固定 `refId`，以及旧账项是否收敛为带 `source_superseded` 的 `failed`。
- **AI 漏掉阶段承诺**：检查 Prompt 版本、Registry 版本和 `postValidate` 的固定来源覆盖校验。
- **保存 Book Contract 很慢**：同步不应在保存请求中直接调用 LLM；检查是否绕过持久副作用队列。
- **普通逾期阻断整本写作**：检查是否错误把局部 payoff 风险直接升级成全局 replan。
- **后文章节因早期窗口显示待优化**：检查 `payoff_overdue` 是否进入章节 blocking 或 `readChapterQualityDebtDetails`；仅逾期债应被读路径隐藏，混杂局部问题仍显示待优化。
- **质量债自动修复被逾期伏笔或待审核状态提案暂停**：检查生成闸门是否把 `payoff_overdue` 算进阻断项，以及质量债任务是否带上 `chapterScope=quality_debt` 后仍走 `hold_for_review`。
- **一键修复跑完仍有待跟进**：先看各章 `repairAttemptsUsed`。质量债批次同章最多 2 次（轻修后改写）。若是 0 且验收为 `needs_manual_review`，检查是否走了质量债入口；若已用满 2 次，属于完成优先的残余质量债，不是任务失败。不要把全书逾期伏笔当成单章补丁就能清掉的问题。
- **当前模型已在跑，书架仍显示旧的暂停原因**：检查简易书架是否按 `updatedAt` 取到了仍 `pendingManualRecovery` 的旧质量债任务。当前这次修复应以进行中或最新创建的任务为准；新任务启动后应接替旧的暂停记录。
- **局部审计触发全局停止**：检查调用方是否只判断 `recommended`，而没有同时要求 `action === "stop_for_replan"`。

## Related Modules

- `server/src/services/payoff/sources/bookContractPayoffSources.ts`
- `server/src/services/payoff/PayoffLedgerSyncService.ts`
- `server/src/services/payoff/domain/payoffLedgerSourceLifecycle.ts`
- `server/src/prompting/prompts/payoff/payoffLedgerSync.prompts.ts`
- `server/src/events/handlers/registerNovelEventHandlers.ts`
- `server/src/events/sideEffects/NovelSideEffectJobHandlers.ts`
- `server/src/services/novel/BookContractService.ts`

## Source Documents

- `docs/plans/payoff-ledger-foundation-phase-two.md`
- `docs/plans/payoff-ledger-safety-phase-three.md`
- `docs/wiki/workflows/reader-experience-contract.md`
- `docs/wiki/workflows/novel-fact-ledger.md`
