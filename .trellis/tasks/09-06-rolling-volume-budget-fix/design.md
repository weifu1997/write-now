# 技术设计：滚动生产感知的目标卷可信章数

## 根因模型

两个消费方在"拆章 / 节奏板"生成前都要回答：**本卷按规划应有多少章（可信尺度）**。
当前答案来自 `allocateChapterBudgets`（`volumeChapterBudgetAllocation.ts`）：把全书预算按各卷"已有章节数"加权分配。该口径只在规划期成立；滚动生产期，"已有章节数"是**进度**而非**规划**，导致在产卷（尤其收官卷）的分摊塌缩到当前进度值。

而节奏板是在更早时点（通常该卷还不足 3 章、走均分分支）按 `全书预算/卷数` 的尺度生成的。同一张板子，生成时尺度 ≈37，校验时尺度塌缩到 ≈5，于是自洽的板子被判为"跨度异常"。

## 方案：在两个消费方引入"规划尺度"下限

新增纯函数（放在 `volumeChapterBudgetAllocation.ts`，与现有预算函数同属一个责任模块）：

```ts
export function resolveVolumePlannedChapterBudget(input: {
  chapterBudget: number;      // deriveChapterBudget 的结果（全书尺度）
  chapterBudgets: number[];   // allocateChapterBudgets 的结果（加权口径）
  targetVolumeIndex: number;
  volumeCount: number;
}): number {
  const weightedBudget = input.chapterBudgets[input.targetVolumeIndex];
  const evenShareBudget = Math.max(
    3,
    Math.floor(Math.max(input.chapterBudget, 0) / Math.max(input.volumeCount, 1)),
  );
  return Math.max(weightedBudget ?? 0, evenShareBudget);
}
```

语义：目标卷的可信章数 = max(加权分摊, 全书均分)。全书均分正是节奏板生成时（`resolveBeatSheetTargetChapterCount` 的均分分支 / `buildEvenChapterBudgets` 的 base）所用尺度，因此校验尺度与生成尺度自洽；而加权分摊在有实际章节分布时通常 ≥ 均分，保留它可以不抬高任何既有卷的口径。

### 行为矩阵（预算 150）

| 场景 | 加权 | 均分 | 修复前 | 修复后 |
|---|---|---|---|---|
| 收官卷 [38,38,37,**4**]，板跨度 37 | 5 | 37 | 5 → 误报抛错 | **37 → 放行** |
| 骨架扩展后 6 卷 [38,38,37,4,0,0]，板跨度 25 | 25（均分分支） | 25 | 25 → 临界抛错 | 25 → 放行 |
| 防御：第 2 卷板写整书章号 76 | 49 | 37 | 49 → 拒绝 | 49 → 仍拒绝 |
| 已完成卷第 1 卷整卷重生成 | 49 | 37 | 49 | 49（不变） |

### 消费方接线（两处，均不改变其它输入）

1. `volumeChapterListGeneration.ts`（拆章）：

```ts
const fallbackTargetChapterCount = resolveVolumePlannedChapterBudget({
  chapterBudget,
  chapterBudgets,
  targetVolumeIndex: targetIndex,
  volumeCount: Math.max(document.volumes.length, 1),
});
```

替换原 `chapterBudgets[targetIndex] ?? Math.max(3, Math.round(chapterBudget / volumes))`。
注意原代码用 `Math.round`、新均分用 `Math.floor`（与 `buildEvenChapterBudgets` 的 base 口径一致），差值 ≤1，只影响边界放行与否，不产生收缩。

2. `volumeBeatSheetGeneration.ts`（节奏板）：`resolveBeatSheetTargetChapterCount` 内部把同样的组合作为 `fallbackTargetChapterCount`。该函数签名不变（已有 chapterBudget / chapterBudgets / volumeCount 入参），orchestrator 的再导出与现有测试调用保持兼容。

### 修复后案例的完整数值流

`deriveChapterBudget` = max(150, 117 已写, 12) = 150 → `resolveVolumePlannedChapterBudget` = max(加权 5, 均分 37) = 37 → `budgetedTargetChapterCount` = max(已有 4, 37) = 37 → `resolveTargetChapterCount`：maxTrusted = 37+10 = 47 ≥ 37 → accepted，target = 37 → `validateBeatSheetChapterCoverage`（target 37 ≥ 20 触发）：required 37 ∈ [34,40]、连续覆盖到 37、合计 37 → 全部通过。随后 `buildBeatGenerationPlans` 按板内每拍期望章数（合计 37）续建，`resolveFullVolumeResumeState` 从第 2 拍续跑，路线窗口按 single_beat 逐拍补齐至 113+37=150 章完书。

## 边界与残余风险

- 用户中途下调 estimatedChapterCount 至低于已写进度：`deriveChapterBudget` 以已写章数兜底，均分随之收缩；跨度超出收缩后尺度的板子仍会被拒（此时"重生成节奏板"的缩水是符合用户声明的预算的，语义成立）。
- 已完成卷整卷重生成标题的覆盖率门限偏紧（修复前即存在，如第 1 卷 weighted 49 vs 板 38 ±8%）：本任务不改动，行为与修复前一致，作为独立问题跟踪。
- 纯计算口径修复，无数据迁移；已在生产中的暂停任务无需数据修复，重启服务后从小说页恢复即可续跑。

## 验证设计

- 新增 `server/tests/volumeRollingChapterBudget.test.js`（node:test，针对 dist 产物）覆盖 PRD 四条口径。
- `pnpm --filter @write-now/server test`（shared build + server build + node tests）。
- 回归面：`volumeChapterListChunking.test.js`、`volumeGenerationOrchestrator.test.js` 必须原样通过。

## 回滚

单 commit、纯服务端两文件一测试文件；回滚 = revert 该 commit。
