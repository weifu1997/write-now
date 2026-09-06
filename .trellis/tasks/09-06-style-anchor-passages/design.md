# 范文锚点回流与生成注入 — 技术设计

## 现状事实（2026-09-06 探查确认）

- 章节编辑器候选**应用是纯客户端动作**：`client/src/pages/novels/components/chapterEditor/ChapterEditorShell.tsx` `acceptMutation`（约 line 283-302）合并文本后走 `PUT /api/novels/:id/chapters/:chapterId` → `NovelCoreCrudService.updateChapter`（novelCoreCrudService.ts:621）。服务端没有 apply 端点，被选中文本只存在于客户端 session。
- 生成上下文包由 `GenerationContextAssembler.build()` 构建（server/src/services/novel/runtime/GenerationContextAssembler.ts:663-685）；style 契约经 `StyleBindingService.resolveForGeneration` → `chapterLayeredContext.ts:386` → `chapterContextBlocks.ts:497-505` 渲染为 `style_contract` 组。
- 新上下文组的完整改动面（探查结论）：`shared/types/chapterRuntime.ts` schema → `GenerationContextAssembler` → `chapterLayeredContext.buildChapterWriteContext` → `chapterContextPolicies.normalizeChapterWriteContext` → `chapterContextBlocks.buildChapterWriterContextBlocks`（不得进 `WRITER_FORBIDDEN_GROUPS`，chapterContextBlocks.ts:22）→ `contextGroupLabels.ts` 中文标签。

## 方案决策

### D1 范文存储：独立轻量表，不进 RAG 索引链

**决策**：新增 Prisma 模型 `StyleAnchorPassage`（id、tenantId、novelId、sourceChapterId?、source `adopted|manual`、text、contentHash、createdAt，novelId+contentHash 唯一约束），配套 Postgres 与 SQLite 双迁移（日期递增、幂等、IF NOT EXISTS，见 docs/wiki/debugging/postgres-migration-chain.md）。

**备选否决**：复用 `KnowledgeDocument` + facet 标记——零迁移，但 (a) 知识文档列表 UI 会被范文污染，需额外过滤；(b) kind 语义被拉长；(c) `RagOwnerType` 枚举扩展同样需要迁移。独立表语义最清晰、改动面最小。

**检索策略（分层降级）**：`listForGeneration` 按优先级取 1-2 段、每段截断 800 字：① 用户确认范文（adopted/manual，pinned 优先、最近次之，纯 Prisma 查询）；② ①为空且本书写法资产来自拆书分析时，从拆书源知识文档检索代表性叙事段落作为初始锚点（源文本存于 `KnowledgeDocumentVersion.content`，复用 `HybridRetrievalService`，ownerTypes 限定 knowledge_document，且必须配对 D4 的实体护栏）；③ 仍为空则不注入。单书范文量级为几十条，①②都无需为范文自建向量链路；语义检索作为后续增强留白。用户确认样本的确定性选择属于上下文装配，不违反 AI-first 规则（该规则约束意图识别/路由等决策路径）。

### D2 采集回流：编辑器专用端点 + 客户端 fire-and-forget

**决策**：新增 `POST /api/novels/:id/chapters/:chapterId/style-anchors`（body: text、source、sourceRange?）与 `DELETE .../style-anchors/:id`，挂在 `server/src/modules/novel/production/http/`（与 novelChapterEditorRoutes 同级），tenant 归属与兄弟路由一致。客户端 `acceptMutation` 与手动标记按钮 fire-and-forget 调用，失败仅 console，不阻塞章节保存。

**备选否决**：在 `updateChapter` 请求体透传选中文本——污染通用章节更新 API；且手动标记场景没有章节保存动作可搭。

### D3 注入链路：新上下文组 `style_anchor_passages`

数据流：`StyleAnchorPassageService.listForGeneration` ← `GenerationContextAssembler.build()`（Promise.all 内，异常 catch 返回空数组保证非阻塞）→ `GenerationContextPackage.styleAnchorPassages`（`shared/types/chapterRuntime.ts` zod optional，默认 []，旧快照兼容）→ `chapterLayeredContext.buildChapterWriteContext` 透传 → `chapterContextPolicies.normalizeChapterWriteContext` 默认 [] → `chapterContextBlocks` 新增块（仅非空时创建）→ `contextGroupLabels` 标签「范文锚点」。

writer 资产 `novel.chapter.writer`：contextRequirements 中该组 priority 60 左右、进 dropOrder 尾部（不设 required）。

### D4 提示词：writer v6→v7

【风格与续写约束】区块追加范文锚点小节（有注入时渲染）：

- 参照范围限定：模仿范文的句式节奏、细节密度、对话留白方式；不得照搬范文的具体情节、人物、地名、组织名。
- 范文与 chapter_mission 冲突时以 mission 为准（范文只锚风格，不锚内容）。
- 初始锚点使用拆书源文本时，锚点区块必须同时携带 sanitize_for_generation 产出的 forbiddenEntities 清单与「只仿写法、禁用实体」指令，防止向源作品贴脸；用户确认范文（本书内容）无需实体清单。
- 版本升级走 registry（prompting 注册校验），`advancedTemplate.requiredContextGroups` 不加入新组（保持旧模板可编辑）。

## 兼容性与回滚

- 全链路 optional + 默认空数组：旧任务快照、旧书、无范文场景零影响。
- 非阻塞：assembler 内 catch-all 降级，范文链路任何失败不失败章节生成。
- 回滚：revert 分支即可；已建表与存量数据无害，无需数据回滚。迁移只用 CREATE TABLE / ADD COLUMN 类幂等语句，不做破坏性操作（符合数据保护规则）。

## 涉及模块边界

- `services/styleEngine/`：新增 `StyleAnchorPassageService`（归属写法引擎，与反 AI 规则同域）。
- `modules/novel/production/http/`：新路由文件，消费 facade。
- `services/novel/runtime/GenerationContextAssembler`：只做装配与降级，不含范文业务规则。
- `prompting/`：仅上下文组渲染与 writer 资产版本升级。
- 模块 README/边界说明：`services/styleEngine` 若有 README 则补充范文段落职责；无则在该任务 wiki 页中说明。

## 评审修订记录

- 2026-09-06：采纳外部评审意见，D3 检索策略升级为分层降级（用户范文 → 拆书源文本初始锚点 → 不注入），解决新手用户不主动标记导致范文库冷启动空置的问题；初始锚点与 forbiddenEntities 实体护栏强制绑定，防止向源作品贴脸。
