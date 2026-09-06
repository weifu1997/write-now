# 快扫词表养护与跨章复读信号

## Goal

补两个小缺口：(1) 默认反 AI 规则目录缺少一批中文 AI 高频腔调表达（如「一丝」「不禁」「空气仿佛凝固」「嘴角勾起」），字面快扫与 LLM 深检召回不足；(2) 跨章表达复读（每章都以「夜色沉沉」式环境句开头）需要以显式规避样本的形式进入写作约束。

## 现状事实（2026-09-06 探查确认）

- `GenerationContextAssembler.buildOpeningConstraintHint`（server/src/services/novel/runtime/GenerationContextAssembler.ts:695）已取近 3 章（`OPENING_COMPARE_LIMIT`）开头各 220 字符（`OPENING_SLICE_LENGTH`）生成 `openingAntiRepeatHint`，但渲染方式偏笼统；`recentScenePatterns`（场景模式黑名单数据）在 `chapterLayeredContext.ts:391` 恒为空数组，当前没有持久化来源。
- 本任务的跨章复读信号以「把已有开头样本渲染成显式规避样本」为主，不新建检测任务。

## Requirements

### 默认 risk 规则补充

- `server/src/services/styleEngine/defaults.ts` 新增约 4-6 条 risk 类默认规则，覆盖高频 AI 腔表达；type=risk（提醒规避，允许特定语境自然出现，避免误伤）；每条带具体 promptInstruction 与 rewriteSuggestion，severity 适中。
- 跟随现有默认目录合并逻辑生效：不覆盖、不污染用户自定义规则；用户已显式处理同一风险的，以用户配置为准。
- 规则文案遵守 UI Copy Rules（用户可读、从写作效果出发，不写实现注释口吻）。

### 跨章复读信号

- 强化 `opening_constraints` 区块：把已有的近 3 章开头样本以「上一章/近几章这样开头 + 规避指引（不得复用相同开场表达模式）」的显式形式渲染，使写作模型可直接对照规避。
- 数据不足（新书、章节数不足）时区块自然缩略，不报错、不占额外预算。
- 样本注入随现有 opening_constraints 组的优先级与 dropOrder 走，不改上下文组拓扑。

### 改写方向多样性治理

- 复核 encourage 类默认规则与各 rewriteSuggestion：凡把「改成动作/环境反应」当万能答案的，补充多样化替换方向（对话、感官细节、决策变化、删而不换、结构压缩），明确避免把正文往「无意义小动作」的新模板腔收。
- `styleRewritePrompt`（style.prompts.ts）与章节编辑器 rewriteCandidates 提示词加多样性约束：同一篇的多处命中/多个改写候选不得都收敛到「删解释、加动作」同一模子。

## Acceptance Criteria

- [ ] 新增 risk 规则出现在默认目录，StyleDetectionService 深检可命中；含高频腔样文的检测结果引用新规则。
- [ ] 用户自定义规则的书不被新增默认规则覆盖。
- [ ] 多章书籍的生成上下文中，opening_constraints 区块以规避样本形式呈现近章开头句；新书不出现空区块。
- [ ] encourage 类规则与改写建议不再单向往「小动作」方向；同一样文的改写输出呈现至少两种不同替换策略。
- [ ] typecheck 与相关单测通过。

## Out of Scope

- 不新增独立检测任务或定时任务。
- 不把 risk 词升级为 forbidden。
- 不改 StyleDetectionService 快扫预过滤机制本身。
- 不为场景模式黑名单新建持久化模型（恒空数组现状维持，留待后续有真实数据源再启用）。
- 不做全文级重复检测（只覆盖开头表达复读这一最高频场景）。
