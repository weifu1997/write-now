# 审查链路打通反AI规则目录

## Goal

章节审校（`novel.review.chapter`）目前只按 voice/repetition 维度泛化打分，拿不到 resolved 后的反 AI 规则目录；导致审校 issue 无法引用具体规则名，修文定向只能依赖生成后写法检测（`PostGenerationStyleReviewRunner`）兜底。本任务把反 AI 规则 directive 注入审校提示词，让审校 issue 直接引用规则名与正文证据句，使 `novel.review.repair` 收到的 issuesJson 天然可定向执行。

## Requirements

- `ChapterReviewPromptInput` 增加可选的反 AI 规则目录入参（命名 `antiAiDirectiveText`），由审校调用方通过 styleEngine 的 `AntiAiPolicyResolver.resolveEffectiveRules` + `buildAntiAiRuleCatalogText`（基于 resolved 反 AI 规则，已含 enabled 过滤）填充；调用方解析规则失败时静默降级为空。
- `novel.review.chapter` 提示词版本升级（v2→v3）：voice/repetition 审查重点中明确——命中反 AI 规则的问题必须引用规则名，evidence 必须指向正文具体句子；规则目录仅作检测参照，不得据此脑补正文没有的问题。
- 未绑定写法资产或无启用规则的书：入参为空，审校行为与现状一致，不注入空区块、不报错。
- 审校输出 schema（fullAuditOutputSchema）与修文链路（`novel.review.repair` 的 issuesJson 通道）不改结构；规则引用以 issue 文本承载。

## Acceptance Criteria

- [ ] 绑定了含启用反 AI 规则的书：审校 JSON 的 issue 文本中出现规则名与正文证据句。
- [ ] 未绑定写法资产的书：审校链路行为与改动前一致（回归）。
- [ ] prompting 注册校验通过（id/taskType 不变，version 升级），typecheck 通过。
- [ ] PostGenerationStyleReviewRunner 兜底行为不变（回归确认）。

## Out of Scope

- 不改修文提示词与 PostGenerationStyleReviewRunner。
- 不改 fullAuditOutputSchema 结构。
- 不改 StyleDetectionService 的快扫/深检逻辑。
