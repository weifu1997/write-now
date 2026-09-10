# 范文锚点（Style Anchor Passages）契约

## 背景

风格指导此前全部是抽象文字（节奏、信息密度、句式组织），模型对抽象指令的执行远弱于对具体文本的模仿。范文锚点把「写得好」的具体段落作为正样本注入生成上下文，并与既有反AI规则（负样本）形成互补：禁令防套路，范文锚个性。

## 决策

- **独立轻量存储**：`StyleAnchorPassage` 表（novelId + contentHash 唯一，单书上限 200），不进 RAG 索引链。理由：单书范文量级为几十条，无需向量检索；复用 `knowledge_document` 会污染知识文档 UI。后续若需要语义检索再增强，不改变表结构契约。
- **用户确认为唯一采集门槛**：范文只来自「采纳 AI 改写候选」（adopted）与「手动标记选中片段」（manual），不做 AI 自动评分采集。质量门槛由用户确认保证，符合新手优先（采集动作零认知负担，不新增必做步骤）。
- **非阻塞**：范文链路任何失败（服务异常、检索失败、无数据）都静默降级为不注入，绝不使章节生成失败。

## 当前规则与实现

### 数据流（生成注入）

`StyleAnchorPassageService.listForGeneration` ← `GenerationContextAssembler.build()`（catch 返回 `[]`）→ `GenerationContextPackage.styleAnchorPassages`（zod optional/default []，旧快照兼容）→ `chapterLayeredContext.buildChapterWriteContext` 透传 → `chapterContextPolicies.normalizeChapterWriteContext` 默认 [] → `chapterContextBlocks` 新增 `style_anchor_passages` 块（**非空才创建**，priority 60，dropOrder 尾部，不进 `WRITER_FORBIDDEN_GROUPS`，不挤 required 组）→ `contextGroupLabels` 标签「范文锚点」。

### 选择策略（分层降级）

1. 用户确认范文：`pinned` 优先、`createdAt` 最近次之，取 1-2 段（每段截断 800 字）。
2. 为空且本书绑定写法资产的 `sourceType === "book_analysis"` 时，经 `bookAnalysis.documentId` 从源知识文档检索代表性叙事段落（`HybridRetrievalService.retrieve`，`ownerTypes: ["knowledge_document"]`，`knowledgeDocumentIds` 限定源文档），作为初始锚点——解决新手用户不主动标记导致的冷启动空置。
3. 仍为空返回空数组，`style_anchor_passages` 块整体不出现。

### 防串味护栏

- 使用拆书源文本初始锚点（source_book）时，锚点区块**必须同时携带** `styleContext.sanitizedGenerationProfile.forbiddenEntities` 清单与「只仿写法、禁用实体」指令，防止向源作品贴脸——这是 `sanitize_for_generation` 防串味设计在锚点层的延伸。
- 用户确认范文（本书内容）不携带实体清单。
- writer v7 系统提示词锚定三条边界：模仿句式节奏/细节密度/对话留白；禁止照抄范文中的具体情节、人物、地名、组织名；范文与 chapter_mission 冲突时以 mission 为准。

### 采集与回流

- 服务端：`POST /novels/:id/chapters/:chapterId/style-anchors`（adopted/manual）+ `GET/DELETE /novels/:id/style-anchors`；经 `NovelApplicationServices` 门面到 `StyleAnchorPassageService`。
- 请求体 `text` 的 HTTP 上限按章节目标字数硬上限计算（`resolveChapterIntakeMaxChars`），不是固定 4000；入库与生成注入仍截断为 800 字范文片段。
- 客户端：`ChapterEditorShell.acceptMutation` 采纳成功后 fire-and-forget 回流（提交前截成 800 字，失败静默，不阻塞章节保存）；`SelectionAIFloatingToolbar` 提供「存为范文」一键标记；`ChapterEditorSidebar` 提供本书范文的查看与移除入口。
- 去重：`contentHash = sha256(trimmed text)`，同书同文幂等；创建时超上限淘汰最旧未固定条目。

## 失效模式

- 无范文、未绑定拆书写法、检索异常：锚点块静默缺省，属于预期降级而非故障；排查时先看 `GenerationContextPackage.styleAnchorPassages` 是否为空数组。
- 新默认行为依赖客户端回流：若用户禁用了编辑器脚本或走了旧客户端，adopted 回流不会发生，属于可接受退化。
- HTTP `text` 上限必须跟章节目标字数硬上限走（`resolveChapterIntakeMaxChars`，即目标字数的 1.25 倍，缺省按 20000 字目标得到 25000），不能写死 4000。采纳整章改写候选时正文经常落在 3500–4500 字，固定 4000 会在章节保存成功后弹出「请求参数校验失败 / text：不能超过 4000 个字符」，并被 axios 拦截器打成可见 toast。入库仍只保留 800 字范文片段；客户端提交前截断，adopted 回流失败保持静默。
- 章节篇幅的软/硬区间（0.85 / 1.15 / 1.25）属于生成与验收质量合同，不是范文采集的请求校验。超长章节应记质量债或走压缩，不得在范文入口用固定字符数拦下整章。
- `forbiddenEntities` 为空时（写法资产无源文本或净化未跑），source_book 锚点仍会注入但没有实体清单——此时应先检查写法资产净化链路，而不是删掉实体护栏逻辑。
- 删除小说时锚点随 `onDelete: Cascade` 级联清理；迁移 SQL 沿仓库惯例不写 FK，由 Prisma 关系声明保证语义。

## 相关模块

- `server/src/services/styleEngine/StyleAnchorPassageService.ts`
- `server/src/services/novel/runtime/GenerationContextAssembler.ts`
- `server/src/prompting/prompts/novel/context/chapterContextBlocks.ts`（`buildStyleAnchorPassagesText`）
- `server/src/modules/novel/production/http/novelStyleAnchorRoutes.ts`
- `client/src/pages/novels/components/chapterEditor/ChapterEditorShell.tsx`（采纳回流）
- `server/src/prompting/prompts/novel/chapterWriter.prompts.ts`（v7 锚点约束）

## 源文档

- 2026-09-06 去AI味任务树评审记录（范文冷启动分层与实体护栏为外部评审采纳项）
