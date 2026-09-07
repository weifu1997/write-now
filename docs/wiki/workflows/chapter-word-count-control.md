# 章节字数控制链

## 背景

章节写作对篇幅只有"低于下限自动续写"这一侧的保护（`writer_extend`），超过上限一侧没有任何收束手段。写作图与验收层长期存在一个未闭合的功能环：验收修复环（`getRepairModeHint`）早已预留 `LENGTH_OVER_HARD_MAX → compress_chapter_for_length` 的整章压缩入口，但全库没有任何生产者真正抛出这个 code，属于"修复环已预留压缩提示、上游却无生产者"的断链。副作用是：部分模型（如 minimax-m3 顶满输出 token）能把单章写到八千到一万字，畅通无阻地入库并通过验收。

## 决策

字数控制采用"写作期自动收束优先、验收期确定性判定兜底"的两层设计，并把预算区间拆成三档使用：

- softMax 与 hardMax 之间：只靠 Prompt 软约束，不升级为修复项（避免把软区间内的章节反复拉去重写）。
- 超过 hardMax（= 目标 × 1.25，契约已定义）：先由写作图在 onDone 阶段自动压缩一次；压缩失败则保留原稿，交给验收层确定性判定。
- 低于 softMin：沿用既有续写兜底。

阈值只用 hardMax 这一个确定性数字，来源是 shared 的 `resolveLengthBudgetContract`，不新增契约字段。

## 当前规则

- 写作图守卫（根因收束）：`ChapterWritingGraph` 在初稿稳定后走"先压缩、后补写"的区间守卫。超 hardMax 时最多调用一次压缩（`mode: condense` / `stage: writer_condense` / `triggerReason: length_condense`），接受条件是压缩结果非空且严格变短；接受后仍低于 softMin 则走既有续写。压缩失败、为空或未变短一律保留原稿放行，交给验收层——单章最多一次压缩调用，禁止无界循环。
- 压缩的 LLM 任务是"删减收束"，不是重写：禁止新增情节/角色/设定、禁止改变事件顺序与结局；必须保留 mustAdvance、义务兑现、payoff 触达、关键转折与结尾钩子；优先删除重复复读、碎片对话、无信息量描写；输出压缩后的完整正文，不得输出概述或对比说明。
- 验收层确定性护栏：正文实际字数 > hardMax 时，无论模型验收结论如何，都在 `normalizeAssessment` 里向队首注入 `LENGTH_OVER_HARD_MAX` blockingIssue 与整章压缩 repairDirective（措辞含"超出/压回区间"，保证修复成功后二次验收能被既有 reconcile 逻辑豁免）。注入 code → 审计 openIssues → `getRepairModeHint` 命中 `compress_chapter_for_length`，由既有 patch 修复环执行；修复后仍超长按既有 defer_and_continue 记质量债，不阻塞全书（非阻塞规则）。
- Prompt writer 资产维护 `condense` 模式（v9）：draft/continue 分支的渲染语义不变；context 契约允许 `current_draft_full` 整稿组参与，保证压缩任务拿到的是完整正文。
- 影响范围：章节正文 writer（`novel.chapter.writer`）、验收评估、章节 patch 修复环。shared 契约结构不变。

## 示例

- 章节目标 2800 字，hardMax 3500：草稿 4000 字 → onDone 触发一次压缩，接受压缩稿后仍低于 softMin 再走续写补齐。
- 弱服从模型压缩后仍 3800 字 → 压缩稿被接受路径以"未严格变短/空"之外的判断落入验收；验收注入 `LENGTH_OVER_HARD_MAX`，进入 patch 修复环继续压缩，最终仍超限则记为质量债放行。
- 压缩模型输出空串或与原文等长 → 视为失败，保留原稿，交验收层判定，避免"越压越糟"。

## 失败模式

- 曾出现的最典型断链：修复环有 `compress_chapter_for_length` 提示，但没有生产者抛出 `LENGTH_OVER_HARD_MAX`，导致超长章节永远走不进压缩修复。排查时先确认"该 code 是否有生产者"，再确认命中路径（AuditIssue → openIssues → getRepairModeHint）。
- 压缩提示若放在 issues/directives 队尾，会被下游 `slice(0, 5)/slice(0, 4)` 截掉而失效；护栏注入必须放到队首。
- 若修复指令措辞不含"超出"等标记词，修复成功后的二次验收可能被 reconcile 逻辑再次判为超长，造成重复修复。
- 不要用"再提高 maxTokens / 放开模型输出上限"来掩盖弱服从模型超长：那只是把问题推给更长的篇幅，字数控制必须落在压缩收束与确定性判定上。
- 不要把 softMax～hardMax 之间的软区间内容升级为修复项：会触发大量不必要的整章重写成本。

## 相关模块

- `server/src/services/novel/chapterWritingGraph.ts`（写作期区间守卫 + condense 调用）
- `server/src/services/novel/runtime/ChapterAcceptanceAssessmentService.ts`（验收确定性超长判定）
- `server/src/prompting/prompts/novel/chapterWriter.prompts.ts` + `server/src/prompting/registry/promptAssetLoaderEntries.ts`（writer v9 condense 模式）
- `shared/types/chapterRuntime.ts`、`shared/types/chapterLengthControl.ts`（长度预算契约 `softMin/softMax/hardMax`）
- 修复环 `compress_chapter_for_length` 的既有消费方（章节 patch repair）

## 来源文档

- 章节生产链路：`../workflows/chapter-production-chain.md`
- 长度预算契约定义：`shared/types/chapterLengthControl.ts`
