# 技术设计：收官投影尾节点超时即 hard-fail → 改为可恢复等待（gate）

## 根因模型

收官跑完最后一批章节（150 全部正文写完）后，`runChapterExecutionNode` 进入投影尾段。对
`BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS` 模块逐个执行：

```
for (adapter of projectionAdapters):
  artifacts = waitForProjectionFacts(adapter)   // 轮询 inspectCompletion，至多 120s / 1.5s 间隔
  runStepModule(adapter, reuseCompletedStep=false)  // fact-only 节点，runner 恒空
```

缺陷链（对应 prd Background 时序）：

1. **等待确实执行、但在窗口内等不到**。chapter_state_commit 的 facts 依赖正文写完后异步落库的
   approved/StoryStateSnapshot/CanonicalStateVersion（`ChapterExecutionProgressInspector.ts:191-205`）。
   章 150 的异步提交在等待窗口结束后约 42s 才落库（15:57:52 vs 15:57:08 超时）→
   `waitForProjectionFacts` 轮询 120s 后以"仍 incomplete"退出。
2. **超时未与"完成"区分**。`waitForProjectionFacts`（`novelDirectorRuntimeOrchestrator.ts:474-513`）
   只在 `completion.completed || elapsed>=timeoutMs` 时返回，两种情况都只返回 artifacts，不标记超时。
3. **超时后照跑 fact-only 节点 → validateOutput 抛错**。循环无条件 `runStepModule`；
   `reuseCompletedStep=false`（background 模块恒真，:467）使 `inspectCompletion` 跳过（:310-311）→
   进入节点执行，runner 内 `validateOutput` 以 facts 未齐抛
   `chapter.state.commit facts are not complete yet.`（:379-383）。该抛错语义来自
   `createFactOnlyExecutionModule`（`directorExecutionStepModules.ts:529-585`，:557-564）。
4. **模块声明的 recover 无人消费**。fact-only 工厂无条件声明
   `recover:{recoverable:true, resumeFrom:<id>}`（:576-581），但 `module.recover` 唯一调用点是只读的
   `inspectWorkflowStepFacts`（`WorkflowStepModule.ts:391-405`）；错误处理路径从不读 recover。
5. **普通 Error 一路穿透到 markTaskFailed**。`DirectorNodeRunner.ts:163-176` catch→
   `recordStepFailed`(node_failed)→再抛；runExecutableStepModule 只吞 GateError；最终外层
   `NovelDirectorService.runScheduledBackgroundRun:266` catch——GateError/Cancel 才 `return`，
   否则 `markTaskFailed`。于是收官跑全了 150 章仍被打成红色 failed。

**既有 happy-path 测试即本缺陷的镜像**：`server/tests/novelDirectorRuntimeOrchestrator.test.js:286`
「waits for delayed state commit facts」用 `inspectCompletion` 第 3 次才 completed + 
`projectionFactWaitTimeoutMs:100`，验证"延迟落库在窗口内到达→节点通过"。缺陷只在"窗口内没到"分支。

## 方案：把"尾段事实未齐"建模为可恢复 gate，而非硬错误

在投影循环 seam 处（唯一一处、非全局），区分超时与完成：超时且 facts 仍不齐的 background
fact-only 节点**不再执行**（执行必然 validateOutput 抛错），改为走与 `runExecutableStepModule`
readiness 失败完全相同的 gate 路径：`markTaskWaitingApproval`（若模块有 defaultWaitingState）+
`stateCommitter.markRuntimeWaitingGate` + 抛 `DirectorRuntimeGateError`。外层 catch 见 GateError 即
`return`，任务不判负；等待事实落库后，用户「继续自动导演」（既有续跑/质量收尾路由）一次即收口——
与 17ee7ccd 的幂等可续跑、以及既有"失败后两次续跑最终成功"的实证路径一致，但不再出现 spurious failed。

### 改动 1：`waitForProjectionFacts` 返回是否"事实已齐"

签名改为返回 `Promise<{ artifacts: DirectorArtifactRef[]; factsReady: boolean }>`：

- 非 background / 非 executable 模块：`{ artifacts, factsReady: true }`（不适用等待，交由下游模块自判）。
- background 模块：while 循环出口处，`factsReady = Boolean(completion?.completed)`；
  超时且 incomplete → `factsReady:false`。循环内已在每次出口前做过一次 `inspectCompletion`，可直接取值。

唯一调用点是 `runChapterExecutionNode:454`，无其它影响面。

### 改动 2：投影循环对"等待超时 + facts 未齐"改走 gate

`novelDirectorRuntimeOrchestrator.ts` 投影循环（:453-468）：

```ts
const { artifacts, factsReady } = await this.waitForProjectionFacts({ module: adapter, ... });
if (
  !factsReady
  && isExecutableWorkflowStepModule(adapter)
  && BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS.has(adapter.id)
) {
  // 事实仍异步在途：执行该 fact-only 节点必然 validateOutput 抛错 → 直接判负。
  // 模块 recover 声明恒可恢复；把超时收敛为可恢复 gate，复用既有等待/续跑语义。
  const context: WorkflowStepExecutionContext = { ... };
  const completion = await adapter.inspectCompletion(context).catch(() => null);
  if (!completion?.completed) {
    const reason = `${adapter.id} 异步投影事实尚未落库，等待补齐后可续跑收口。`;
    if (adapter.defaultWaitingState) {
      await this.deps.workflowService.markTaskWaitingApproval(this.deps, /* taskId, novelId */ {
        stage: adapter.defaultWaitingState.stage,
        itemKey: adapter.defaultWaitingState.itemKey ?? adapter.nodeKey,
        itemLabel: adapter.defaultWaitingState.itemLabel ?? reason,
        progress: adapter.defaultWaitingState.progress,
        checkpointSummary: reason,
      });
    }
    await this.stateCommitter.markRuntimeWaitingGate({
      runtimeId: null, taskId: input.taskId, novelId: input.novelId, message: reason,
    });
    throw new DirectorRuntimeGateError(reason);
  }
}
await this.runStepModule({ ... });  // facts 已齐 → 原路径不变
```

- **facts 已齐的既有通过路径零改动**：`factsReady:true` 时直接进原 `runStepModule`，行为与现在一致
  （含既有「delayed state commit facts」测试：第 3 次 inspect 后 factsReady，节点照跑、validateOutput 通过）。
- gate 抛错在 `runChapterExecutionNode` 之后无 catch，会被外层 `runScheduledBackgroundRun:266` 吞掉
  → 任务停在 waiting/gate（复用既有 approval-gate 的 UI 与续跑路由），不再 `markTaskFailed`。
- 与 readiness 失败 gate 的差异仅是触发点：readiness 在跑节点前查上游就绪，这里是投影等待超时后 facts
  未齐。两者落在同一状态模型。

### 与尾段模块 recover 语义的对照

fact-only 工厂 `recover` 恒真已隐含"该模块可从可观察产物续跑"。方案没有新增一套 recover 消费逻辑，
而是把「等待超时」这个本就该走恢复的时点收敛到现有 GateError + waiting 语义上，行为面最小、与既有
approval/pause 完全同构。`payoff_ledger_sync` / `character_resource_sync`（同 background 集合）自动
同获覆盖，无需逐个改。

## 代码触点

| 文件 | 改动 |
|---|---|
| `server/src/services/novel/director/runtime/novelDirectorRuntimeOrchestrator.ts` | `waitForProjectionFacts` 返回 `{artifacts, factsReady}`（:474-513）；投影循环对超时且 facts 未齐的 background fact-only 模块走 `markRuntimeWaitingGate`+`DirectorRuntimeGateError`（:453-468） |
| `server/tests/novelDirectorRuntimeOrchestrator.test.js` | 新增回归：`inspectCompletion` 始终不齐（或超时窗口后才齐）→ 断言抛 `DirectorRuntimeGateError`、节点未执行（runtimeCalls 无 chapter_state_commit 记录）、既有 happy path 测试仍绿 |

预期不改：`directorExecutionStepModules.ts`、`DirectorNodeRunner.ts`、`ChapterExecutionProgressInspector.ts`、
`automation/novelDirectorAutoExecutionRuntime.ts`、`NovelDirectorService.ts`（外层 catch 已识别 GateError）。

## 待实现期实证确认（写死在 implement 步骤）

1. **gate 后任务的续跑路由**：gate 落在尾段 stage `quality_repair`，任务为 waiting/approval 态。需确认
   client `resolveDirectorContinueMode` 与 server ContinueRuntime 对"waiting + quality_repair 尾段"的
   续跑映射能把尾段重跑并走到 workflow_completed（参照既有 failed→skip_quality_repair 实证路径）。
   若映射把 waiting 态漏掉，补一条等价映射即可——预期不新增复杂分支。
2. **gate payload 与 readiness 失败路径同构**：核对尾段模块是否带 `defaultWaitingState`；不带时仅
   `markRuntimeWaitingGate` + 抛 gate（与现有 readiness 分支行为一致），不额外造任务状态。
3. **真实复现**：对 novel `cmtol3vlq006d01ns88nkjzdd` 续跑收官，观察 node 事件与任务终态——
   不再出现 `node_failed chapter_state_commit` → `markTaskFailed`；应收口到 workflow_completed
   （可能需一次续跑）。

## 备选与取舍（不采用）

- **只放大 `DEFAULT_PROJECTION_FACT_WAIT_TIMEOUT_MS`（120s→更长）**：仍是"单次阻塞等待 + 任意上限"；
  异步滞后超过新上限依旧照打 failed；后台 reservation 占用更久。不改。方案以"超时即可恢复"取代"把等待
  上限调到足够大"，严格更优。
- **超时后在原 run 内再等一轮**：facts 确定性会落，第二轮多数能赶上；但代价是后台占用的有界性难证。
  用"一次续跑收口"已满足 AC，且 user 续跑是既有习惯操作。可选增强，暂不做（防无限后台等待）。
- **泛化 recover 消费（validateOutput 失败一律查 module.recover）**：触及通用 runner 的失败语义，
  会影响所有非 background 模块的既有 hard-fail 行为（那些失败是真实缺陷，应保持判负）。不采用——只改
  background 投影 seam。

## 风险与兼容

- **facts 真不齐时不再 loudly failed，改停在 waiting**：若异步提交有真实缺陷导致 facts 永不落库，任务会
  停在可恢复等待而非红色失败。缓解：gate reason 明确列出不齐项（progress 本就显示 drafted/committed）；
  waiting/approval 态与既有门禁同构，用户可停止。可接受，且符合"收官不该误打 failed"的 Goal。
- **gate 后任务终态与 UI**：待实证项 1 处理；若续跑按钮在 waiting 态不出现，则实现需补最小 UI/路由映射。
  但按既有 approval-gate 的通用处理，大概率已支持（实证确认）。
- **数据/兼容**：server 纯编排改动，无 schema/数据迁移；rollback = revert feature 分支 + 重建 api 镜像。

## 验证路径

1. `pnpm --filter @write-now/server test`——新增回归 + 既有 orchestrator suite（含 delayed-facts happy path）。
2. 单测确定性验证（无需真实异步滞后）：`inspectCompletion` 恒不齐 + 小 `projectionFactWaitTimeoutMs` →
   抛 `DirectorRuntimeGateError`、尾节点未执行；随后把模块置为"已齐"续跑 → 尾节点通过。
3. 部署后在 novel `cmtol3vlq006d01ns88nkjzdd` 续跑收官，观察不再 `node_failed`/`markTaskFailed`，
   收口到 workflow_completed。
