# PRD：修复自动导演 JIT/执行门控与质量债误杀

## 背景

代码审查发现自动导演在 `full_book_autopilot`（懒规划 / JIT）与执行收口阶段存在多处门控不一致：恢复游标、执行预检、大纲 fact step 重跑、审校债误杀全局任务、重规划 checkpoint 标签错误；另有中低优先级的完成判据、catalog、标题硬失败、恢复接线与死代码问题。

## 目标

1. JIT 跳过预细化后，恢复游标 / 事实摘要 / 接管不再要求回到 `chapter_detail_bundle`。
2. 懒规划执行预检不因缺少完整 task sheet / 轻量种子误导用户或硬挡回大纲；执行前由 JIT 补合同。
3. 大纲三个 fact step 不重复整段重跑整个 structured outline phase。
4. 正文可用时的局部审校缺口记质量债或可恢复门禁，不得把全局导演任务打成 `failed`。
5. `stop_for_replan` 暂停必须对外表现为 `replan_required`，不能伪装成普通 `chapter_batch_ready`。
6. 同步修复中低项：sync 完成判据、catalog 产物、标题多样性硬失败、detailAhead 脱节、repair 双入口、resumePendingManualRecovery、worker stale 清暂停、乱码死代码与误导文案。

## 非目标

- 不重做整条章节生产链或 Prompt 大改。
- 不改变 completion-first 默认策略（局部债不阻断全书）。
- 不引入新的手动审批默认点。

## 验收标准

### 高

- [ ] H1：`full_book_autopilot` + 仅有章节列表、无 task sheet 时，`resolveStructuredOutlineRecoveryCursor` 进入 `chapter_sync`（或等价可执行态），不是 `chapter_detail_bundle`。
- [ ] H2：`allowLazyChapterPlanning=true` 且章节记录已存在但缺轻量种子时，执行范围解析不抛「缺少完整章节细化」；文案不再要求回到节奏/拆章补齐完整细化。
- [ ] H3：已完成的大纲 fact step 再次执行时不重复跑完整 phase（不重复 sync / `production_experience_required`）。
- [ ] H4：有可用正文但审校事实未齐时，导演收口不因 `chapter_quality_review` validate 失败而 `markTaskFailed`。
- [ ] H5：pipeline `pendingManualRecovery` 且原因为重规划时，`requeueTaskForRecovery` 使用 `checkpointType: "replan_required"`。

### 中

- [ ] M6：`payoff_ledger_sync` / `character_resource_sync` 完成判据不以「任意旧 artifact 存在」冒充本范围已同步。
- [ ] M7：catalog 中 beat/list/detail 的读写产物与真实产物对齐。
- [ ] M8：标题多样性问题在 autopilot 默认不硬停整本大纲（债/修复路径）。
- [ ] M9：`detailAhead` 要么接到 JIT/路线窗口，要么从对外 guidance/契约中移除误导承诺。
- [ ] M10：`chapter_repair` / `quality_repair` 职责边界清晰，避免 nodeKey 混用误导。
- [ ] M11：显式恢复路径与 draft `buildInput` 对 `pendingManualRecovery` 接线一致。
- [ ] M12：worker stale 恢复不得清掉质量策略导致的人工暂停（仅允许真正 runtime-stale 场景，需测试钉死）。

### 低

- [ ] L：删除乱码死代码；JIT 跳过文案不再说「细化已完成」；清理不可达三元；必要时澄清 `allowIncompleteExecutionContracts` 语义/命名注释。

## 约束

- 先写最小复现测试，红灯确认，再修。
- 在功能分支 `fix/09-08-director-jit-gate-fixes` 开发，经 `beta` 集成，不直接上 `main`。
- 破坏性数据操作禁止。
