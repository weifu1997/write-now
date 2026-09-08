# Implement

## Phase A — 高优先级复现测试 + 修复

1. 扩展/新增测试：
   - `novelWorkflowStructuredOutlineProgress.test.js`：JIT skip detail → cursor = chapter_sync
   - `novelDirectorAutoExecutionRuntime.test.js` 或 scope 测试：lazy 缺轻量种子不抛「完整细化」
   - fact step 短路：已完成 beat_sheet 再 execute 不触发完整 phase（可用 mock）
   - quality review：有 draft 无 review 不 fatal（模块 validate / orchestrator）
   - pendingManualRecovery + replan → checkpointType replan_required
2. 实现 H1–H5。
3. 跑对应 `node --test` 至绿。

## Phase B — 中优先级

4. M6–M12 测试 + 修复。
5. 跑相关测试。

## Phase C — 低优先级与收尾

6. 死代码/文案/注释。
7. wiki：若游标/预检/checkpoint 契约稳定，更新 `docs/wiki/workflows/lazy-chapter-planning.md` 与 auto-director runtime 相关页。
8. release notes（用户可见行为）+ 阶段提交。

## 验证命令

```bash
pnpm --filter @write-now/server exec node --test \
  tests/novelWorkflowStructuredOutlineProgress.test.js \
  tests/novelDirectorAutoExecutionRuntime.test.js \
  tests/novelDirectorAutoExecution.test.js
# 以及本任务新增/改动的测试文件
```
