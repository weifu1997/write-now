# 拆章冲突强度曲线 — 设计

## Architecture And Boundaries

紧张度仍是 `VolumeChapterPlan.conflictLevel`（0–100）+ `conflictLevelSource`。本任务把**首次赋值**从章节细化提前到按拍拆章，并打通缺省、锚定和写作消费。

```
beat sheet 槽位
  -> chapter list prompt 输出 title/summary/beatKey/conflictLevel
  -> persist VolumeChapterPlan
  -> TensionCurvePanel
  -> chapter detail / execution contract（可微调 AI 点，不可覆盖 user）
  -> GenerationContextAssembler + writer context
```

不用标题关键词表生成分数。模型按节奏槽位结构化输出；确定性层只校验范围、锚定保留、整拍过平则语义重试。

## Data Flow

1. Schema：`generatedChapterBeatBlockItemSchema` 增加 `conflictLevel: z.number().int().min(0).max(100)`。
2. Prompt：删除“每章只能三个字段”；要求本拍内有升/降，高潮拍整体高于开卷拍。
3. 合并：现有 `resolveMergedConflictLevel()` 已保留 user 锚定；拆章落库必须走同一规则。
4. 缺省：删除 `conflictLevel ?? 3`。无值保持 `null`，曲线画断点。
5. 写作：在 `chapterWriteContext` / 分层上下文中解释本章强度及相对邻章升降。

## Compatibility

- 旧章缺 `conflictLevel` 仍可展示为待定；不强制回填正文。
- 用户手动拖过的点继续是硬约束。
- 参考线模板不写入数据。

## Trade-offs

| 选项 | 结果 | 选择 |
| --- | --- | --- |
| 拆章后再单独跑曲线模型 | 多一次 LLM，曲线仍可能与摘要脱节 | 不选 |
| 拆章同时输出强度 | 曲线与章节功能一起生成 | 选 |
| 规则按 beatKey 填固定分 | 违反 AI-first | 不选 |

## Failure Modes

- 模型仍输出全 50：语义重试一次，提示“本拍起伏不足”；失败则保留生成值并记质量提示，不停车。
- Schema 增加字段后旧测试/“不得新增字段”指令会导致结构化失败：prompt 与 schema 必须同改。
