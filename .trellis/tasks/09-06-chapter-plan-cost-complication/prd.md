# 章节计划代价与意外字段

## Goal

AI 味最深的一层是情节「太顺」：胜利无代价、冲突当场解决、每章都干净地达成任务。本任务在章节计划的读者体验合同层新增「本章代价（expectedCost）」与「意外变量（complication）」字段，让计划阶段就强制引入摩擦，并贯通写作与审查约束，使情节结构本身摆脱 AI 式的顺滑。

## 现状事实（2026-09-06 探查确认）

- 读者体验合同 schema 在 `shared/types/novel/readerExperience.ts`（宽松版 `readerExperienceContractSchema` line 5-17、生成校验版 `generatedReaderExperienceContractSchema` line 19-31），内嵌为 `ChapterScenePlan.readerExperience`。
- 任务单结构化结果序列化为 JSON 存入 `Chapter.sceneCards/taskSheet` 与 `VolumeChapterPlan` 的 String JSON 列——**本任务不需要 Prisma 迁移**。
- 消费链路：`chapterLayeredContext.ts:186-188` `parseChapterScenePlan` → `buildCompatibleReaderExperienceContract`（line 335 兜底）→ `chapterContextBlocks.ts:290-314` 渲染 `reader_experience` 组；writer 核心约束 1a 已把 promisedReward/keyTurn/netChange 定为硬合同。
- `plannerSchemas.ts` 为 passthrough，对 planner 输出字段天然宽容。

## Requirements

### 字段设计

- `expectedCost`：本章进展需要付出的代价、损失或妥协（时间、资源、关系、信息暴露、承诺束缚等）。
- `complication`：本章出现的、超出角色既有计划之外的意外变量或副作用；允许与既有冲突相关但不得是计划的直接复述。
- 「未解决残留」不单设字段：其向前拉扯职能已由 `endingHook` 承担，避免语义重叠加重提示词负担。
- 两字段由规划 AI 按叙事节奏判断产出，不设「每章必填」的 schema 强制（宽松与生成校验 schema 均 optional）：推进章通常应有代价，转折章通常应有意外，缓冲章允许缺省；必须防止「每章一个代价 + 一个意外」的机械齐活——那是另一种结构模板化 AI 味。类型与幅度多样化由提示词引导（代价在信息/关系/资源/机会间轮换，意外可大可小）。

### 生成与贯通

- 章节任务单生成链路（`volumeChapterTaskSheetPrompt` 字段清单 + `chapterDetailSchemas.ts`）产出两字段；`normalizeChapterScenePlan` 序列化透传无丢失。
- `planner.chapter.plan` 提示词（v1→v2）在计划源头鼓励产出两字段（可选产出，任务单生成阶段兜底必产出）。
- `novel.chapter.writer` 核心约束 1a 扩展：字段存在时，正文必须让读者可见代价的付出与意外的发生；不得把代价写成纯心理活动，须有具体事件承载。
- `novel.review.chapter`（版本升级）审查重点增加：本章代价/意外是否在正文可见兑现且与情节有机衔接（而非模板化插入）；字段缺省的缓冲章不得被审查强判为缺陷。
- `reader_experience` 渲染块（chapterContextBlocks.ts:290-314）展示两字段；旧数据无字段时不渲染空行。

### 兼容性

- 全部改动向后兼容：旧任务单、旧快照、存量书解析与生成零破坏；无需数据库迁移。

## Acceptance Criteria

- [ ] 新生成的章节任务单按节奏包含两字段且兑现自然，连续多章无同幅度、同类型的机械模式；旧书旧任务单解析无报错、渲染无空区块。
- [ ] 含字段的章节生成后，正文可见代价/意外兑现；审查能在缺失时指出。
- [ ] `parseChapterScenePlan` → `buildCompatibleReaderExperienceContract` → 渲染 的 round-trip 单测通过（含旧数据无字段用例）。
- [ ] prompting 注册校验通过（涉及资产 version 各自升级）；typecheck 通过。
- [ ] 存量书回归：完整生成链路无报错。

## Out of Scope

- 不改 endingHook 语义，不新增「未解决残留」字段。
- 不改任务快照结构与持久化模型（沿用 String JSON 列）。
- 不动 payoff directives / obligation contract 体系（代价与意外是计划字段，不是伏笔合同）。
- 不做批量回填存量任务单。
