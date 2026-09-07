# 章节计划代价与意外字段 — 技术设计

## 数据与契约

### schema 变更（shared/types/novel/readerExperience.ts）

- 宽松版 `readerExperienceContractSchema`：追加 `expectedCost: z.string().optional()`、`complication: z.string().optional()`（旧数据解析零破坏）。
- 生成校验版 `generatedReaderExperienceContractSchema`：两字段保持 optional，与宽松版一致——是否产出由规划 AI 按节奏判断（见下），schema 不做每章强制。
- 字段语义在提示词中定义清楚：
  - `expectedCost`：本章进展要付出的代价/损失/妥协，必须是可被正文呈现的具体事项（信息暴露、承诺束缚、资源消耗、关系受损、机会放弃……），不得是纯情绪。
  - `complication`：超出角色既有计划的意外变量或副作用，必须改变后续行动条件，不得是计划本身的复述。
  - 节奏判断与反机械引导进提示词（不进 schema）：推进章应有代价、转折章应有意外、缓冲章可缺省；提示词明确「不得每章机械齐活」，并要求代价类型轮换（信息/关系/资源/机会）、意外幅度分级，避免连续章节出现同型同幅的模板模式。

### 传递链（探查确认的既有管线，无需迁移）

生成：`volumeChapterTaskSheetPrompt`（server/src/prompting/prompts/novel/volume/chapterDetail.prompts.ts，字段清单 line 227-276 区域）+ `chapterDetailSchemas.ts` 校验 → `normalizeChapterScenePlan({scenes, readerExperience})` → `serializeChapterScenePlan` → `Chapter.sceneCards/taskSheet` 与 `VolumeChapterPlan` 的 String JSON 列。

消费：`chapterLayeredContext.ts:186-188` `parseChapterScenePlan` → `buildCompatibleReaderExperienceContract`（line 335）→ `chapterContextBlocks.ts:290-314` `reader_experience` 渲染。

### 兜底与渲染

- `buildCompatibleReaderExperienceContract` 补默认值映射：无字段时返回 undefined，渲染层跳过对应行（不得输出「无」「待定」空区块）。
- `plannerSchemas.ts` 为 passthrough，planner 侧无需 schema 改动；`planner.chapter.plan` 提示词（v1→v2）在字段说明中鼓励产出两字段，任务单生成阶段兜底必产出。

## 提示词变更（各自版本升级，注册校验）

| 资产 | 变更 | 版本 |
| --- | --- | --- |
| `planner.chapter.plan` | 字段说明鼓励产出 expectedCost/complication | v1→v2 |
| `volumeChapterTaskSheetPrompt`（chapterDetail.prompts.ts） | 字段清单加入两字段及语义定义、生成要求 | 现版本+1 |
| `novel.chapter.writer` | 核心约束 1a 扩展：字段存在时正文必须可见兑现代价与意外，代价须有具体事件承载 | 视范文锚点任务合并情况 v7 或 v8 |
| `novel.review.chapter` | 审查重点加「代价/意外是否可见兑现且有机衔接」，机械模板化插入同样属 issue；字段缺省的缓冲章不算缺陷 | 现版本+1（若与审查打通任务撞版本，合并时重排） |

版本协调规则：四个子任务都可能动 writer/review 资产，按实施顺序（审查打通 → 词表 → 范文锚点 → 本任务）依次 +1，合并冲突时以后一任务的版本号为准并重跑注册校验。

## 兼容性与回滚

- 旧任务单（JSON 无新字段）：宽松 schema 解析通过，渲染跳过，writer/审查按「字段不存在不强制」处理——writer 约束措辞必须是「存在时必须兑现」，不得写成无条件要求。
- 旧快照重放（状态重建逐章删建链路）：sceneCards JSON 列内容原样保留，解析兼容已验证。
- 无 Prisma 迁移，回滚 = revert 分支；已生成的新任务单在旧代码下解析兼容（宽松 schema optional）。

## 权衡记录

- **为什么挂在 readerExperience 而不是 scene 级**：代价/意外是章级叙事属性（读者可感知的净变化的一部分），scene 级会碎片化且加重任务单 token 负担。
- **为什么不加「未解决残留」字段**：endingHook 已承担向前拉扯职能，第三字段语义重叠、提示词负担增加、审查口径难分。
- **为什么从「生成版强制非空」改为「optional + 节奏判断」**：初版为把「反顺滑」变成默认行为，在生成 schema 强制每章双字段。外部评审指出这会诱发机械兑现——每章固定插入一个代价加一个意外，本身就成了新的结构模板化 AI 味。改为字段 optional、产出与幅度由规划 AI 按节奏判断、审查同时检查兑现质量与机械感。「新手不会手动补计划」的担忧不受影响：计划本就由 AI 生成，用户无需填字段。
- **为什么字段兑现验收依赖审查而非仅靠字段**：字段写入计划不等于正文兑现，「可见兑现」必须由审校引用 reader_experience 检查正文，这条验收天然是 AI 判断，不做成确定性校验。

## 评审修订记录

- 2026-09-06：采纳外部评审意见，放弃「生成 schema 强制每章双字段非空」的初版设计，改为 optional + 规划 AI 节奏判断 + 审查检查机械感，避免诱发「每章一个代价加一个意外」的结构模板化。
