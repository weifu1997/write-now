# 收官 chapter_state_commit 节点投影等待超时即判失败、不走声明的 recover 兜底

## Goal

修复全书收官（滚动生产 / 自动导演收官阶段）在最后一环 `chapter.state.commit`（提交章节连续性状态）
偶发/必然失败的问题：收官节点对"章节状态提交事实"（generationState=approved 或
StoryStateSnapshot/CanonicalStateVersion）做了至多 120s 的后台投影等待，但**等待超时后仍继续执行
fact-only 节点**，validateOutput 抛 `… facts are not complete yet.`，该普通 Error 一路穿透到外层
`markTaskFailed`，把整个 auto_director 任务打成 failed；模块声明的 `recover: recoverable=true`
（本可恢复等待/续跑）没有任何运行时错误处理消费它。

## Background（实测证据，novel cmtol3vlq006d01ns88nkjzdd，2026-09-06）

- 150 章全部写完（`pipelineStatus: succeeded`、`completedChapterCount:150`、`remainingChapterOrders:[]`），
  但 auto_director「全书自动执行完成」收官运行连续两次失败：
  - 15:42:15（run/task cmtpfprx40a6f01nsid05vtlk）
  - 15:57:10（run/task cmtpzitzy02cy01pjdoee9flj）
  两次 `lastError` 相同：`chapter.state.commit facts are not complete yet.`
- 事件时序（第二次）：
  - 15:55:02  `node_started chapter_execution`（收官入口：最后一批章节执行）
  - 15:57:10.104 `node_started chapter_state_commit`
  - 15:57:10.25  `node_failed  chapter_state_commit`
  - 15:57:52.499 最终章 150「仙班资负表」才落为 approved —— 比失败晚约 42 秒
- 机制判定（已读代码逐跳确认）：
  1. `runChapterExecutionNode` 在入口节点后逐个跑投影尾节点；对每个
     `BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS` 模块先 `waitForProjectionFacts` 轮询 `inspectCompletion`
     （至多 `DEFAULT_PROJECTION_FACT_WAIT_TIMEOUT_MS=120_000`，1.5s 间隔，
     `novelDirectorRuntimeOrchestrator.ts:474-513`）。本轮确实**等待了约 120s 后超时**——
     章 150 的异步 approved/snapshot 落库晚于等待窗口约 42s。
  2. 超时后 `waitForProjectionFacts` 不区分"完成/超时"，一律返回 artifacts；
     `runChapterExecutionNode` 继续 `runStepModule(chapter_state_commit)`（:453-468）。
     该 fact-only 模块 `reuseCompletedStep=false` 恒真，重新 `inspectCompletion`（:310-311）仍 incomplete
     → 进入节点执行 → runner 内 `validateOutput` 抛
     `chapter.state.commit facts are not complete yet.`（:379-383）。
  3. `validateOutput` 语义来自 `createFactOnlyExecutionModule`（`directorExecutionStepModules.ts:529-585`，
     抛错 :557-564）：非 manual 模式下一旦 facts 未齐即 invalid。同时该工厂无条件声明
     `recover: { recoverable: true, resumeFrom: <id> }`（:576-581），但 `module.recover` 的唯一消费点是
     `inspectWorkflowStepFacts`（`WorkflowStepModule.ts:384-405`，只用于事实检查），**错误处理不读它**。
  4. 节点失败：`DirectorNodeRunner.ts:163-176` catch → `recordStepFailed`（写 node_failed）→ 原样抛出。
  5. 该普通 Error 非 `DirectorRuntimeGateError`，穿透 runExecutableStepModule / runChapterExecutionNode /
     pipelineRuntime，被外层 `NovelDirectorService.runScheduledBackgroundRun`（:253-272）catch →
     `markTaskFailed`（attemptCount=0、pendingManualRecovery=false）。若它当时是 GateError，同一 catch
     会直接 `return`（:266），任务不会被判负。
- 代码事实（判定/依赖）：
  - `directorExecutionStepModules.ts:735-771` `chapter_state_commit` 要求
    `committedChapterCount >= draftedChapterCount`；descriptor `stage:"quality_repair"`（收官尾段阶段）。
  - committed 判定 `ChapterExecutionProgressInspector.ts:191-205`：`hasStateCommit || isApproved ||
    shouldContinueWithoutStateCommit` 才补 `"chapter_state_committed"`——依赖正文写完后异步落库的
    approved/snapshot，正文写完与事实可见之间存在异步窗口。
  - 尾段同工厂模块：`payoff_ledger_sync` / `character_resource_sync`（同 `BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS`，
    `directorExecutionStepModules.ts:29-33`）同型同险。

## Requirements

- 收官投影尾节点在依赖事实等待超时且仍不齐时，不得以普通 Error 把任务打成 failed；应转入可恢复的
  等待（沿用模块声明的 recover 语义 / GateError 路径），让事实落库后的人工或自动续跑能收口。
- 不改章节质量 / commit 语义本身与既有通过路径；只补"事实未齐时不应直接 hard fail"的编排兜底。
- 需覆盖尾段 fact-only 节点：`chapter_state_commit` 至少；核查同清单的 `payoff_ledger_sync` /
  `character_resource_sync` 是否同类风险并一并覆盖。
- 修复后不得破坏正常收官（facts 已齐时尾节点照常逐一通过 → workflow_completed）的路径。

## Acceptance Criteria

- [ ] 复现案例（novel cmtol3vlq006d01ns88nkjzdd）续跑/重跑收官不再因该节点失败；收官能走完
      chapter_state_commit → payoff_ledger_sync → character_resource_sync → quality_repair 收尾，
      或事实落库后经续跑一次收口（不出现红色 failed）。
- [ ] 单元/集成测试覆盖：投影等待超时且 facts 未齐时走"可恢复等待/重试"而非抛普通错误判负；
      facts 已齐的正常尾段路径行为不变。
- [ ] server 相关测试通过。

## Non-goals

- 不改章节质量/commit 语义本身；不做"数据自愈（150 章已全 approved）即视为修复"的替代。
- 不涉及 LLM JSON 结构化解析（由 json-parse-failure 任务处理；本任务只处理收官编排的等待/重试缺陷）。
- 不迁移数据；不整体重构收官/自动导演运行时，只动尾段编排 seam。
