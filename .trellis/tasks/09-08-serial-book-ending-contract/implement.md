# 连载目标跨度收束 — 实施

## Ordered Checklist

1. 在 `volumeChapterListGeneration.ts` 把 `isCompactBookFinaleBeat` 提升为全书目标收官判定：`compact_book` 行为不变；`serial_book` 用前序卷预算 + 本拍结束章序对比 `endingRequiredBy`。
2. 拆章 prompt 继续消费 `isBookFinale`；确认连载收官拍走终章条款。
3. 卷骨架 prompt：最后一卷且目标章落在此卷时，`nextVolumeHook` 改为余味，不得开启必须续写新主线。连载非收官卷保持下一卷入口。
4. 节奏板 prompt：收官卷 `end_hook` 改为收束/余味，不再强制承接下一卷入口。
5. `buildCommonNovelContext` / `formatProjectContext` / `renderBookContractText`：连载收官写入目标跨度收束说明，替代“只保留下一阶段拉力”。
6. `buildNarrativeProgressHint`：接近 `estimatedChapterCount` 时与收官合同一致，禁止同时要求新开主线。
7. 章节执行合同生成对收官章：`endingState` 必须是本阶段稳定收束；`nextChapterEntryState` 允许余味，不得要求下一章承接新主线。
8. 测试：`volumeGenerationOrchestrator.test.js` 已覆盖紧凑全书终拍；补 150 章连载最后一拍为真、中段拍为假、卷内章序不得冒充全书章序。
9. 回归 `directorCompletionProfile.test.js`：61/150 仍为 `serial_book`。
10. 更新 `docs/wiki/workflows/auto-director-runtime.md` 与 `volume-planning.md`：连载目标章 = 可见小结局，不是紧凑全书完本。

## Validation

- `node --test server/tests/directorCompletionProfile.test.js server/tests/volumeGenerationOrchestrator.test.js`
- 若拆章 prompt 单测存在，一并跑章节列表相关测试。
- 不跑全量 build。UI 验收由用户看收官卷/最后一章规划与正文是否像小结局。

## Risky Files

- `server/src/prompting/prompts/novel/volume/chapterList.prompts.ts`
- `server/src/prompting/prompts/novel/volume/skeleton.prompts.ts`
- `server/src/prompting/prompts/novel/volume/beatSheet.prompts.ts`
- `server/src/prompting/prompts/novel/volume/shared.ts`
- `server/src/prompting/prompts/novel/chapterLayeredContext.ts`
- `shared/types/directorCompletion.ts`（默认不改阈值）

## Explicitly Not Doing

- 不调用 `compactBookEndingAuditPrompt` 拦截连载完成。
- 不回写已有第 150 章正文。
