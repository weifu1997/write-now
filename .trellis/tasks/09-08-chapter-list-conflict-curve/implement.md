# 拆章冲突强度曲线 — 实施

## Ordered Checklist

1. `volumeGenerationSchemas.ts`：拆章 item schema 增加 `conflictLevel` 0–100。
2. `chapterList.prompts.ts`：允许并要求该字段；按当前 `beatKey` 说明本拍应处于相对低压/加压/高潮/回落，禁止整拍差值过小。
3. 拆章落库：把生成的 `conflictLevel` 写入 `VolumeChapterPlan`，source=`ai`，经 `resolveMergedConflictLevel` 保留 user。
4. 删除 `chapterExecutionContractGeneration.ts` 的 `conflictLevel ?? 3`；无值保持 null 或走生成，不用 3。
5. 搜索全库 `conflictLevel ?? 3` 与测试夹具里把 3 当默认强度的路径，能改则改，测试夹具若表示“有值”可改成 30–80 的真实量纲。
6. `buildConflictLevelCurveContext` 已存在，确保拆章后细化必带该块。
7. 写作上下文：本章 `conflictLevel` + 相对上一章 rise/fall/flat，作为可选节奏提示，不替代任务单。
8. 前端曲线已读该字段，一般不用改 UI；确认 null 显示为待定而不是 0。
9. 测试：schema、锚定保留、不再出现默认 3；如有拆章生成测试，断言强度被持久化。
10. 更新 `docs/plans/tension-curve-plan.md` 或 wiki：拆章即产生曲线，默认 3 为缺陷。

## Validation

- `node --test server/tests/volumeGenerationSchemas.test.js server/tests/tensionCurveAnchoring.test.js`
- 相关 volume/chapter list 测试若因 schema 失败则一并修。
- UI 由用户在节奏/拆章页看新拆卷曲线。

## Risky Files

- `server/src/prompting/prompts/novel/volume/chapterList.prompts.ts`（硬编码三字段）
- `server/src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts`
- 大量测试夹具使用 `conflictLevel: 3`

## Explicitly Not Doing

- 不分析已写正文情绪。
- 不自动改已保存正文。
