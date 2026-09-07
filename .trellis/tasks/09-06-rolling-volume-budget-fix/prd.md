# 修复滚动生产收官卷预算塌缩导致的节奏板跨度误报

## Goal

全书自动执行（滚动生产）进入最后一卷时，拆章前的节奏板跨度校验会把"本卷当前只写到 N 章"误当成"本卷计划只有 N 章"，导致确定性误报"当前卷节奏板的章节跨度异常，建议先重生成节奏板，再继续生成章节标题。"并暂停管线（pendingManualRecovery）。修复后，滚动生产中的收官卷应能按其既有节奏板规划（与全书预算一致）继续拆章、写章直至完书，无需人工重生成节奏板。

## Background（实测证据）

- 案例：novel `cmtol3vlq006d01ns88nkjzdd`（estimatedChapterCount=150，4 卷），章节进度 38/38/37/4。
- 第 4 卷节奏板 8 拍，卷内跨度 1-37 章（生成时按全书预算均分 150/4≈37，规划本身正确）。
- 拆章校验（`volumeChapterListGeneration.ts:349`）使用的可信预算来自 `allocateChapterBudgets`：按各卷已有章节数加权 → 第 4 卷仅分得 round(150×4/117)=5 章，maxTrusted=11 < 37 → 抛错。
- 死锁：第 4 卷任何拆章调用都被该校验挡住，章节数永远涨不到能让校验放行的规模。
- 次生风险：按报错建议重生成节奏板，`resolveBeatSheetTargetChapterCount` 会用同样的塌缩预算（5），把收官卷压缩到约 5 章、全书提前约 30 章结束；`novelDirectorChapterTitleRepair.ts` 检测到该错误文案后会自动执行这个缩水。

## Requirements

- 拆章生成（`generateBeatChunkedChapterList`）与节奏板生成（`generateBeatSheet`）使用的"目标卷可信章数"必须感知滚动生产：不能让"已有章节数加权"的规划口径塌缩到当前进度值。
- 校验仍须保留防御能力：模型把整书绝对章号写进 `chapterSpanHint`（跨度远超本卷规划尺度）时仍应拒绝。
- 不改变已完成卷的既有行为（含回归风险控制）：前部卷的可信预算不得因本修复被抬高。
- 不修改持久化数据结构、不迁移数据；纯服务端计算口径修复。

## Acceptance Criteria

- [ ] 复现案例口径（预算 150、4 卷、已有 38/38/37/4、节奏板跨度到 37）：`resolveTargetChapterCount` 判定 `beatSheetCountAccepted=true`，不抛"章节跨度异常"。
- [ ] 第 4 卷节奏板重生成的目标章数为 37（而非 5），即 `resolveBeatSheetTargetChapterCount` 返回 ≥37。
- [ ] 防御不回退：第 2 卷节奏板若把跨度写到整书绝对章号（如 76），仍被拒绝。
- [ ] 已完成卷（如第 1 卷，weighted=49）的可信预算与修复前一致。
- [ ] 新增 node:test 单测覆盖上述四类口径；`pnpm --filter @write-now/server test` 通过（shared build + server build + node tests）。
- [ ] 在 feature 分支完成，合入 beta；UI 交互验收由用户执行（重启 dev server 后从小说页恢复暂停任务，确认第 4 卷继续拆章生产）。

## Non-goals

- 不修复"已完成卷整卷重生成标题时覆盖率门限偏紧"的独立问题（修复前即存在，行为保持不变，另行跟踪）。
- 不改动 `allocateChapterBudgets` 在规划期的加权语义本身。
- 不处理本次暂停任务中已存在的 2 章 needsRepair 质量债务。
