# 生成小说去AI味：正样本锚定与审查打通

## Goal

降低本系统生成小说的「AI 味」。现有防线集中在句子层禁令（反 AI 规则目录、CHAPTER_PROSE_QUALITY_RULES、生成后写法检测与自动改写），本任务树补上三个缺口：

1. **正样本缺口**：风格指导全是抽象文字，没有「写得好」的具体范文供模仿。
2. **审查缺口**：章节审校（novel.review.chapter）拿不到 resolved 后的反 AI 规则目录，voice/repetition 打分与修文定向脱节。
3. **情节层缺口**：章节计划天然「太顺」——胜利无代价、冲突当场解决、无残留悬念，这是句子层修复解决不了的深层 AI 味。

## Background

- 现状链路：`novel.chapter.writer` v6（写作）→ `PostGenerationStyleReviewRunner`（生成后写法检测/自动改写）→ `novel.review.chapter`（审校）→ `novel.review.repair`（修文）。
- 写法引擎：`server/src/services/styleEngine/`（StyleDetectionService、StyleRewriteService、StyleRuntimeResolver、defaults.ts、AntiAiRuleService 等），反 AI 规则分 forbidden/risk/encourage 三类，带 detectPatterns + promptInstruction + rewriteSuggestion。
- 用户确认的讨论结论（2026-09-06 会话）：按「审查打通 → 词表养护 → 范文锚点 → 计划字段」顺序实施，四项全做。

## Requirements（任务地图）

| 子任务 | 交付物 | 优先级 |
| --- | --- | --- |
| `09-06-review-anti-ai-wiring` | 审校提示词接收反 AI 规则 directive，issue 引用规则名与证据句 | P0，最先做 |
| `09-06-style-vocab-curation` | 默认 risk 类高频 AI 腔规则补充；opening_constraints 附近章开头句样本；改写方向多样性治理（防「万能小动作」新模板腔） | P1 |
| `09-06-style-anchor-passages` | 范文段落资产 + 采纳回流 + RAG 检索注入 + writer 范文锚点区块 | P1，价值最大 |
| `09-06-chapter-plan-cost-complication` | 章节计划新增代价/意外/残留字段并贯通写作与审查约束 | P2，动契约最后做 |

实施顺序即上表顺序。每个子任务独立 feature 分支、独立验证、逐个进 beta。

## 跨子任务约束

- **AI-first**：只扩 prompt 资产、schema、上下文组；不新增关键词路由或非 AI 兜底。字面快扫维持现有「确定性预过滤 + AI 深检」定位。
- **Prompt Governance**：所有提示词改动走 `server/src/prompting/` 注册体系，升级版本号，不内联。
- **非阻塞**：写法检测与范文锚点失败不得阻塞章节生产主链路（完成优先）；降级路径必须有。
- **兼容性**：新增 schema 字段全部 optional，旧任务快照、旧书数据零破坏。
- **上下文预算**：新增上下文组必须进 contextPolicy 的 preferredGroups/dropOrder 管理，不得挤掉 required 组。
- **新手优先**：范文采集依赖用户「采纳/标记」动作，必须低认知负担（编辑器内一键），不新增用户必做的流程步骤；范文锚点必须有新书冷启动降级，不依赖用户动作才有内容。
- **评测对照**：种子章节前后对比固定模型与采样参数；模型/参数差异不计入提示词改动效果，迭代时把换模型、调参留作独立对照变量。

## Acceptance Criteria（跨子验收）

- [ ] 四个子任务全部通过各自验收并归档。
- [ ] 开工前固定 2-3 个种子章节与统一生成参数（含模型与采样），改动前后各留档生成一次；四个子任务全部完成后盲评对比，结论回写各子任务收尾。
- [ ] 同一组种子章节在改动前后的对比中：审校 issue 能引用具体反 AI 规则名；写作上下文出现范文锚点区块；章节任务单按节奏含代价/意外字段且兑现自然（无机械每章齐活模式）。
- [ ] 范文锚点链路在无范文、检索失败、RAG 异常时静默降级，章节生成不失败。
- [ ] 存量书籍（无新字段、无范文）回归生成链路无报错。
- [ ] 相关 wiki 更新：styleEngine 反 AI 规则机制、章节生产链路的范文锚点与计划字段契约。

## Out of Scope

- 不引入新的独立「AI 味检测」后台任务或定时任务。
- 不改写已完成章节的存量内容。
- 不做跨书共享范文市场（范文仅本书作用域）。
- 不动写法资产（style profile）的提取与净化机制本身。
