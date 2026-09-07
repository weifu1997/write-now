# 导演跟进历史收起 — 设计

## Architecture And Boundaries

关闭历史项 = 把该导演任务标进现有 `taskCenterArchive`，不是新的取消状态机，也不是任务中心按钮。

```
跟进详情「收起这条记录」
  -> archiveTask("novel_workflow", directorTaskId)
  -> follow-up findMany id notIn archivedIds
  -> overview / list / sidebar 同步消失
```

角标改用待处理计数，不再用 `totalCount`。

## Data Flow

1. 投影层增加 `dismissible: boolean`（或动作码 `dismiss_history`）。可收起：`cancelled`（非恢复中）、`succeeded`、`runtime_replaced`、`auto_approval_completed`、用户明确不再处理的 `failed`（同时保留重试）。不可收起：`queued`/`running`/`waiting_approval`/`pendingManualRecovery`。
2. 跟进动作执行器增加归档调用，复用 `TaskCenterService.archiveTask`。不走运行记录页。
3. `getOverview()` 增加 `actionableCount`（名称以实现为准）：`needs_validation` + 失败/人工恢复 + 等待确认/重规划/候选确认。`replaced`、自动通过、已归档、纯历史取消不计。
4. `Sidebar` 使用 `actionableCount`；为 0 不显示红点。`totalCount` 仍可供跟进页展示“全部记录”。
5. 自动通过记录：默认不进角标；若仍出现在列表，提供同等“不再显示”（按 record id 排除或随任务归档一起消失）。

## Compatibility

- 小说工作区已有归档按钮，语义对齐为“从跟进和任务列表收起提醒”。
- 归档不删除 workflow 行，不改变已保存小说。
- 失败项归档后与现有“从任务列表移除”相同：列表不可见，数据仍在。

## Trade-offs

| 选项 | 结果 | 选择 |
| --- | --- | --- |
| 跟进页再取消一次任务 | 取消项已经 cancelled，无效 | 不选 |
| 新 dismiss 表 | 与归档双源 | 不选 |
| 复用 taskCenterArchive | 跟进查询已排除 | 选 |
| 角标=totalCount | 历史永远红 | 不选 |

## Product Copy

- 按钮：「收起这条记录」
- 说明：「不再出现在导演跟进和角标里。不会删除小说，也不会改已保存章节。」
- 禁止“现在不再显示历史问题”这类改动叙述。
