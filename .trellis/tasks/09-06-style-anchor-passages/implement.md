# 范文锚点回流与生成注入 — 执行清单

## 分支与提交

- 从 `beta` 拉 `feature/style-anchor-passages`；按阶段提交（表+服务 → 端点+客户端 → 生成注入 → 提示词）。
- 提交前按 README Release Notes Workflow 检查用户可见影响并更新 `docs/releases/release-notes.md` 与 README。

## 阶段 1：资产与服务

- [ ] `server/src/prisma/schema.prisma` + `schema.sqlite.prisma` 新增 `StyleAnchorPassage`；新增双迁移（幂等、日期递增、禁止复制 sqlite SQL 到 postgres 链）。
- [ ] 迁移链健康校验：`prisma migrate diff --from-config-datasource --to-schema src/prisma/schema.prisma --exit-code`（Postgres）；SQLite 链同法。
- [ ] `server/src/services/styleEngine/StyleAnchorPassageService.ts`：create（hash 去重、800 字截断、单书上限如 200 条）、listForGeneration（1-2 段、最近+来源权重）、delete、listForManage。
- [ ] 单测：去重、截断、上限、listForGeneration 空库/异常降级。
- 验证：`pnpm -C server test`（定向）+ `pnpm -C server typecheck`。

## 阶段 2：端点与客户端回流

- [ ] `server/src/modules/novel/production/http/` 新增 style-anchors 路由（POST/DELETE），tenant/归属校验与兄弟路由一致。
- [ ] `client/src/api/novel/` 新增对应 API 封装。
- [ ] `ChapterEditorShell.acceptMutation`：采纳成功后 fire-and-forget 回流（source=adopted，取 candidate 内容与 targetRange 场景信息）；失败静默。
- [ ] 章节编辑器选中区域加「标记为范文」一键入口（source=manual）；UI copy 遵守 UI Copy Rules（用户视角、无实现口吻）；视觉遵守低边框规则。
- [ ] 范文查看/删除最小入口（编辑器或写法设置内，避免新开大页面）。
- 验证：typecheck（client + server）；UI 验收留给用户。

## 阶段 3：生成注入

- [ ] `shared/types/chapterRuntime.ts`：`chapterWriteContextSchema` 与 `generationContextPackageSchema` 加 optional `styleAnchorPassages`（默认 []）。
- [ ] `GenerationContextAssembler.build()`：Promise.all 内调用 listForGeneration，catch 返回 []（非阻塞）。
- [ ] `chapterLayeredContext.buildChapterWriteContext` 透传；`chapterContextPolicies.normalizeChapterWriteContext` 默认 []。
- [ ] `chapterContextBlocks.buildChapterWriterContextBlocks` 新增 `style_anchor_passages` 块（非空才创建；不进 WRITER_FORBIDDEN_GROUPS）；`contextGroupLabels.ts` 加「范文锚点」。
- [ ] 单测：装配降级（服务抛错 → 包内空数组 → 无区块）。
- 验证：`pnpm -C server typecheck` + 定向单测。

## 阶段 4：提示词

- [ ] `novel.chapter.writer` v6→v7：contextRequirements 加组（priority ~60，dropOrder 尾部，非 required）；【风格与续写约束】追加范文锚点小节（锚风格不锚内容 + 防照抄实体）。
- [ ] prompting 注册校验（id/taskType 不变、version 升级）；`advancedTemplate.requiredContextGroups` 不加新组。
- 验证：注册校验脚本/测试 + typecheck。

## 回滚点

- 每阶段独立可回退；阶段 3-4 任一失败可单独 revert，范文采集（阶段 1-2）可独立存活。

## 收尾

- [ ] wiki 更新：`docs/wiki/workflows/` 或 `rag/` 新增范文锚点契约页（数据流、非阻塞降级、选择策略、后续语义检索增强留白）。
- [ ] 按 AGENTS.md 完成阶段提交；合并进 `beta` 集成验证。
