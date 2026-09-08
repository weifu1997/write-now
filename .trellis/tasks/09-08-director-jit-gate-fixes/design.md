# Design：JIT 门控与执行收口修复

## 边界

| 模块 | 职责 |
|------|------|
| `novelDirectorStructuredOutlineRecovery` | 游标真相源；需认识 JIT/skip detail |
| `directorStructuredOutlineStepFactory` | 完成判据与 recover 对齐游标，去掉单点补丁 |
| `novelDirectorAutoExecutionScopeRuntime` | 懒规划预检：有章节行即可，合同交 JIT |
| `DirectorCoreStepModuleRuntime` / Step runner | fact step 已完成则短路 |
| `directorExecutionStepModules` + RuntimeOrchestrator | 审校债不误杀；sync 判据收紧 |
| `novelDirectorAutoExecutionRuntime` | replan 暂停打正确 checkpoint |
| catalog / prompts / 文案 | 产物与文案对齐 |

## 方案摘要

### H1 游标

给 `resolveStructuredOutlineRecoveryCursor` 增加 `skipChapterDetail`（由 `full_book_autopilot` / `allowPartialChapterListReady` 调用方传入）。为 true 且 chapter list 已就绪时：跳过 detail 扫描，直接 `chapter_sync`。Fact summary / factory / takeover 共用该游标。

### H2 预检

`allowLazyChapterPlanning` 时：不再因 `!hasDirectorSyncedChapterExecutionContext` 抛硬错误。章节缺失仍可按现有 lazy 规则放宽；完整合同仍由 JIT 在写章前补齐。错误文案仅用于非 lazy 路径。

### H3 重跑

`createStructuredOutlineFactModule` 的 execute：若 `inspectCompletion.completed` 已为 true，直接 return（no-op）。可选：phase 支持 `stopAfterStep`，但最小修复优先短路。

### H4 审校债

二选一（优先 A）：
- A. 将 `chapter_quality_review` 纳入软门禁 / 或 validate 在「有正文 + 缺审校」时视为可恢复 gate / 记债完成，不抛普通 Error。
- B. 缺审校且有可用正文时，`inspectCompletion` 视为 completed + `reviewDeferred` 证据（与 `autoReview=false` 对称）。

默认 completion-first：选 B 更直接，避免假等待。

### H5 replan checkpoint

`job.pendingManualRecovery` 时：若 payload/error/notice 表明 `replan_required` / `PIPELINE_REPLAN_REQUIRED` / `stop_for_replan`，则 `checkpointType: "replan_required"`；否则保持 `chapter_batch_ready`。

### 中低

- M6：完成条件改为「本批 drafted 后已有对应 sync 证据或明确 no-op」；无 drafted 时可 pending；有 drafted 无新 artifact 时软门禁而非假完成。
- M7：catalog reads/writes 改为 `volume_beat_sheet` / `volume_chapter_list` / `chapter_task_sheet` 等真实类型。
- M8：autopilot 下标题多样性改为记录债或触发既有 title repair，不 throw 出 phase。
- M9：guidance 改为 JIT 语义；或把 `detailAhead` 接到 route window。
- M10：明确 `quality_repair` flow 只用 `chapter_repair` 节点；废弃/别名说明。
- M11：`buildInput` 在 `pendingManualRecovery` 时也设 `resumePendingManualRecovery`。
- M12：lease/stale 路径保留质量人工暂停。
- L：删乱码函数、改文案、加注释。

## 风险

- 游标语义变化影响旧恢复测试 → 用显式 `skipChapterDetail` 保持非 JIT 行为。
- 审校完成判据放宽可能漏掉真失败 → 仅在有可用正文时放宽，无正文仍失败。
- catalog 改 writes 影响 artifact 索引 → 同步更新 collectWrittenArtifacts 映射。
