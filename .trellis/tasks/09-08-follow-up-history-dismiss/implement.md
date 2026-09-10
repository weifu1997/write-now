# 导演跟进历史收起 — 实施

## Ordered Checklist

1. 共享类型：overview 增加待处理计数；跟进动作增加归档/收起码（若动作枚举必须扩展）。
2. `resolveAutoDirectorFollowUpReason` / 投影：历史项带收起动作；运行中/等待确认/人工恢复不带。
3. `AutoDirectorFollowUpActionExecutor`：收起调用 `archiveTask("novel_workflow", directorTaskId)`。自动通过记录按 record 排除，不归档仍在跑的任务。
4. `getOverview()`：计算 `actionableCount`；`totalCount` 保持全部可见项（不含已归档）。
5. `Sidebar.tsx`：红角标改读待处理计数。
6. 跟进详情：历史项渲染收起按钮和后果说明；不可收起项不显示。
7. 单测：overview 计数、归档后 list 为空、不可收起状态无该动作、sidebar 口径（可用投影单测，不必上浏览器）。
8. 用户文档 `docs/public/modules/director-follow-up.md`：说明历史记录可在跟进页收起，角标只表示还要处理的问题。运行记录仍只读。

## Validation

- `node --test server/tests/autoDirectorFollowUpService.test.js server/tests/autoDirectorFollowUpRoutes.test.js`
- 客户端 `followUpPresentation.test.mjs` 若计数展示变化则更新。
- UI 由用户在导演跟进收起一条历史后核对侧栏角标。

## Risky Files

- `client/src/components/layout/Sidebar.tsx`（角标语义）
- `shared/types/autoDirectorFollowUp.ts`（动作枚举）
- 跟进动作执行器不得误归档 running 任务

## Explicitly Not Doing

- 不在 `/tasks` 加按钮。
- 不做批量清空（除非实现中顺手且验收简单；默认单条）。
- 不改 `09-06-director-badge-semantics` 的进度风险徽标。
