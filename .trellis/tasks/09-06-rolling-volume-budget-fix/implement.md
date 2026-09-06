# 执行计划

## 前置

- [x] 分支：从 `beta` 切出 `feature/rolling-volume-budget`（纯服务端修复，走 feature → beta）。
- [x] 任务工件齐备（prd.md / design.md / implement.md）。

## 步骤

1. [ ] `server/src/services/novel/volume/volumeChapterBudgetAllocation.ts`：新增 `resolveVolumePlannedChapterBudget`（导出，含中文注释说明滚动生产口径；遵循文件既有代码风格）。
2. [ ] `server/src/services/novel/volume/volumeGenerationHelpers.ts`：如该文件以 `export * from` 或显式再导出方式暴露 budget 模块，确认新函数可达（现有 `allocateChapterBudgets` 即从此再导出）。
3. [ ] `server/src/services/novel/volume/volumeChapterListGeneration.ts:339` 附近：`fallbackTargetChapterCount` 改用新函数。
4. [ ] `server/src/services/novel/volume/volumeBeatSheetGeneration.ts`：`resolveBeatSheetTargetChapterCount` 内部 fallback 改用新函数（签名不变）。
5. [ ] 新增 `server/tests/volumeRollingChapterBudget.test.js`（require dist 产物，风格对齐 `volumeGenerationOrchestrator.test.js`）：
   - 案例 A：150 预算、[38,38,37,4]、跨度 37 → accepted（端到端口径，直接调 `resolveTargetChapterCount` + 新函数复算 fallback）。
   - 案例 B：`resolveBeatSheetTargetChapterCount` 在上述口径下返回 ≥37。
   - 案例 C：第 2 卷板跨度 76 → `resolveTargetChapterCount` 拒绝（防御不回退）。
   - 案例 D：第 1 卷 weighted=49 场景，新函数返回 49（已完成卷口径不变）。
6. [ ] 验证：`pnpm --filter @write-now/server test`（含 shared/server build 与全部 node tests）；确认既有 `volumeChapterListChunking.test.js`、`volumeGenerationOrchestrator.test.js` 通过。
7. [ ] wiki：更新 `docs/wiki/workflows/lazy-chapter-planning.md`（或 `volume-planning.md`，以现有内容归属为准），记录"规划期加权口径 vs 滚动生产规划尺度"双口径规则与本次失效模式。
8. [ ] release notes：用 readme-release-updater 技能更新 `docs/releases/release-notes.md` 与 `README.md ## 最新更新`（用户视角：全书自动执行在收官卷不再误报节奏板异常并暂停）。
9. [ ] 提交（仅本任务文件），合入 `beta`，删除 feature 分支；明确告知用户需重启 dev server 并从小说页恢复暂停任务。

## 验证命令

```bash
pnpm --filter @write-now/server test
```

## 回滚点

- 步骤 1-4 任一步失败可单独还原；整体回滚 = revert 单个 feature commit。
