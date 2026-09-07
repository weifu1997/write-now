# 执行计划：收官投影尾节点超时改走可恢复 gate

> 上下文顺序：本文件 → `prd.md` → `design.md`。改动集中在 orchestrator 投影 seam + 一处测试；
> server 纯编排改动。实施前先读 design「待实现期实证确认」三条。

## 步骤

- [x] 1. 建 feature 分支（base = 含 `17ee7ccd`（终态可续跑幂等）的当前集成线；用
      `git log --oneline -3` 确认其在场后：`git checkout -b feature/director-finalize-wait-retry`）。
- [x] 2. `runtime/novelDirectorRuntimeOrchestrator.ts` `waitForProjectionFacts`（:474-513）：
      返回类型改为 `Promise<{ artifacts: DirectorArtifactRef[]; factsReady: boolean }>`；
      background 模块在 while 出口取 `factsReady = Boolean(completion?.completed)`；
      非 background / 非 executable 提前返回 `{ artifacts, factsReady: true }`。
      仅调用点 :454 需适配。
- [x] 3. 投影循环（:453-468）：在 `runStepModule` 前插 gate——`!factsReady && isExecutable &&
      BACKGROUND_ARTIFACT_PROJECTION_STEP_IDS.has(adapter.id)` 时，re-inspect 一次 completion；
      仍不齐则：有 `defaultWaitingState` 先 `workflowService.markTaskWaitingApproval(...)`
      （payload 与 readiness 分支同构，:333-355），再 `stateCommitter.markRuntimeWaitingGate(...)`，
      抛 `DirectorRuntimeGateError`（消息含"异步投影事实尚未落库，续跑可收口"）。
      factsReady 为真时原路径不动。
- [x] 4. 回归测试（`server/tests/novelDirectorRuntimeOrchestrator.test.js`，镜像既有 :286
      "delayed state commit facts"）：
      - (a) `inspectCompletion` 恒不齐 + `projectionFactWaitTimeoutMs:20` → `runChapterExecutionNode`
        reject `DirectorRuntimeGateError`，`runtimeCalls` 无 `chapter_state_commit_node` 记录；
      - (b) 同一模块置为"第二次运行时已齐" → 续跑 `runChapterExecutionNode` 后尾节点通过、producedArtifacts
        正常（既有路径不回归）。
      跑：`node --test tests/novelDirectorRuntimeOrchestrator.test.js` → 7 pass / 0 fail / 6 预存 skip，
      两条新测试绿、既有 delayed-facts happy path 不回归。
- [x] 5. 实证 design「待实证 1/2」：结论=**现有续跑机制即可恢复，无需补映射**。
      `chapter_state_commit` fact-only 模块无自带 defaultWaitingState（仅 contract-sync 模块 :616 有），
      故 gate 只走 `markRuntimeWaitingGate`（DB status=waiting_approval + currentItemLabel=reason），
      checkpointType 保持 `chapter_batch_ready`、currentItemKey 保持 `chapter_execution`。
      client `resolveDirectorContinueMode`：waiting/gate 任务命中 `chapter_batch_ready` →
      `auto_execute_range`（非 `quality_repair` 分支，不回 skip），server 侧重跑章节批；此时 facts 已
      approved，尾段节点通过 → workflow_completed。此即 15:42→15:57 实证续跑同机制，一次续跑收口，
      无红色 failed。live 端到端仍由步骤 8 用户验收兜底。
- [x] 6. 整包 server 测试：`pnpm --filter @write-now/server test` → 通过。
      本任务涉及的 orchestrator/编排器测试全绿（含 2 条新回归）；既有 2 处无关失败在
      `tests/tools.test.js`（2026-06 源）与 `tests/worldContextGateway.test.js`（2026-08 源），
      未触碰相关文件。
- [x] 7. 部署：`docker compose -f infra/docker-compose.yml up -d --build api`；容器内已通过
      `grep -n factsReady` 验证新代码在场（lines 321, 327, 381, 396），健康检查通过。
- [x] 8. 验收（用户参与）：novel `cmtol3vlq006d01ns88nkjzdd` 续跑收官。
      实测结果：针对收官失败任务 `cmtpzitzy02cy01pjdoee9flj`（曾连续两次报
      `chapter.state.commit facts are not complete yet.` 打成 failed）发起续跑命令，
      新编排器尾段门禁与事实校验顺利通过，任务状态已正式变为 **`succeeded`**，
      `currentItemLabel` 为 **`全书自动执行完成`**，`checkpointType` 为 **`workflow_completed`**
      （`finishedAt: 2026-09-06 18:52:31.002`），未再出现任何红色 failed。验收通过！

## 验证命令

```bash
node --test tests/novelDirectorRuntimeOrchestrator.test.js
pnpm --filter @write-now/server test
# 部署（infra 目录）
docker compose -f infra/docker-compose.yml up -d --build ai-novel-api
docker logs -f ai-novel-api-1 | grep -E "director.background|chapter_state_commit|node_failed"
```

## 回滚

server 侧纯编排改动，回滚=丢弃/`git revert` feature 分支提交后重建 api 镜像；无 schema/数据迁移。
任务状态若已停在 waiting/gate，回滚后对该小说续跑一次即可人工收口（facts 已全 approved，数据自愈）。
