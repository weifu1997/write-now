# 修复导演进度风险徽标语义(需复核/缺少规划资源)

## Goal

最小修复两处导演进度徽标语义问题,消除"看起来像出错、实际是正常演进"的误导性警告。快照刷新机制明确不在本次范围。

## Background(诊断结论)

- 「N 项需复核」来自 `inventory.staleArtifacts.length`(`DirectorEventProjectionService.buildVisibleRiskBadges`)。stale 资产的来源之一是伏笔台账 `PayoffLedgerItem.currentStatus === "failed"` 被映射为资产 `stale`(`DirectorWorkspaceQualityArtifactInventory.pushQualityFoundationArtifacts`)。而 `failed` 目前只有一个写入方:`PayoffLedgerSyncService` 的 `source_superseded` 路径——书级旧承诺被新阶段回报替换后的正常淘汰,风险信号 severity=low、stale=true,并非内容失败。
- 「缺少规划资源」来自 `inventory.missingArtifactTypes.length > 0`。预期产物规则会把 `chapter_draft`(有章节计划且 0 章正文时)也算进去,正文类产物缺失被冠以"规划资源"文案,且分析快照停在规划阶段,章节执行期间不刷新,徽标长期滞留。

## Requirements

1. 伏笔台账 → 资产状态映射:`currentStatus === "failed"` 的 `PayoffLedgerItem` 对应 `reader_promise` 资产使用 `superseded` 状态(枚举已存在),不再使用 `stale`。
   - 前置确认:`failed` 的写入方只有 `source_superseded` 路径;若发现其他写入方,需在本任务内重新评估映射粒度。
   - 对账影响确认:`summarizeDirectorArtifactLedger` 中 `superseded` 不计入 present types;需确认 book 级 reader_promise 资产始终存在(BookContract 派生),`reader_promise` 类型不会因该改动被误判缺失。
2. 「缺少规划资源」徽标仅当缺失类型中包含规划类产物时出现(复用 `PLANNING_ARTIFACT_TYPES` 概念);正文/产出类产物(如 `chapter_draft`、`audit_report`)缺失不再触发该徽标。
   - 检查 `DirectorBookAutomationProjectionModel` 等其他投影路径是否存在同语义徽标,保持一致。
3. 不改工作区分析的刷新时机、不改 AI 决策链路、不做数据回写脚本(已落库的 stale 行会在下一次对账时自然收敛为 superseded)。

## Acceptance Criteria

- [ ] `source_superseded` 淘汰的伏笔对应的 reader_promise 资产状态为 `superseded`,不再计入 `staleArtifacts`,「N 项需复核」不再出现。
- [ ] 仅缺失 `chapter_draft` 等正文类产物时,「缺少规划资源」徽标不出现;缺失规划类产物(如 book_contract、story_macro、chapter_task_sheet)时仍出现。
- [ ] 相关单测(`directorEventProjection.test.js` 等引用徽标文案的用例)更新并通过;server typecheck 通过。
- [ ] 用户旧数据(本例 2 条 stale 行)在下一次工作区分析后收敛,无需手工 SQL。
- [ ] 只提交本任务相关文件;工作区既有未提交改动(Postgres 迁移对账等)不受影响。

## Out of Scope

- 章节执行期间的工作区分析刷新机制。
- 徽标之外的文案重写(如「N 类产物待补齐」摘要句)。
- 伏笔台账状态机本身的调整。
