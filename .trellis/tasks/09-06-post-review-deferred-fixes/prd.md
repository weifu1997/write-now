# PRD：完成审查遗留修复与环境治理

## 背景

2026-09-06 全库代码审查（提交 91bc7a15）修复了 21 个问题，另有 7 项已定位但未改动的问题与 3 项环境问题。用户明确要求按 1 → 4 → 3 → 2 → 5 → 6 → 7 顺序完成修复，并解决环境问题。

## 需求与验收标准

### 修复项（按实施顺序）

1. **导演事件投影计数器漂移**（`server/src/services/novel/director/runtime/DirectorEventProjectionService.ts`）
   - 进度文案分母使用 `totalSteps`（factSummary 全量步数），不再混用截断快照的 `steps.length`。
   - `buildQualityDebtSummary` 的 `deferredChapterCount` 按章节去重，与 `deferredChapterOrders` 口径一致。
   - 注意：该文件属于进行中任务 09-06-director-badge-semantics 的关联范围，本次只改计数算术，不碰徽标语义判断。
   - 验收：factSummary 存在时进度显示 x/totalSteps 正确；新增断言测试通过。

2. **RAG 任务并发去重**（`server/src/services/rag/RagIndexService.ts`）
   - `enqueueOwnerJob` 并发调用（`enqueueReindex` 的 `Promise.all`）不再产生重复 queued 任务。
   - 方案：进程内 per-owner 串行化（复用/新建轻量互斥），并评估部分唯一索引迁移的漂移风险后决定是否追加。
   - 验收：并发 enqueue 同一 owner 只产生一个 queued 任务（新增测试）。

3. **导演命令竞态**（`DirectorCommandExecutor.recordCommandResult`、`DirectorCommandService`）
   - `recordCommandResult` 的 seedPayloadJson 读-改-写收敛进事务（事务内重读合并）。
   - 幂等键去掉可变的 `task.updatedAt`（改为 `commandType:hashPayload`），并发重复命令撞既有唯一约束 `@@unique([taskId, commandType, idempotencyKey])` 后捕获 P2002 复用现有命令。
   - 验收：并发同命令只产生一个 queued 命令；既有命令测试全绿。

4. **DirectorRuntimeStore**（`server/src/services/novel/director/runtime/DirectorRuntimeStore.ts`）
   - `snapshotCache` 加容量上限与淘汰，不再无界增长。
   - `mutateSnapshot` 以刚读取的持久化快照为基线（缓存只做读加速），消除跨实例陈旧基线回退。
   - 快照变更经 per-task 串行域（优先复用仓库既有锁原语）。
   - 验收：并发 recordStepStarted 不丢事件；缓存有上限。

5. **StateService.rebuildState**（`server/src/services/state/StateService.ts`）
   - 从"先删全部快照再逐章重建"改为"逐章先删该章快照、立即重建"；单章失败保留已完成章节并把失败章节聚合到错误/任务记录。
   - 验收：第 N 章提取失败时，前 N-1 章快照仍在且错误信息指明失败章节（新增测试）。

6. **列表端点无界读取**
   - `server/src/routes/character.ts`：列表加 take 上限，防全表扫描。
   - `server/src/services/task/TaskCenterService.ts`：适配器取数窗口耗尽时向上游明确标注（响应增加可选截断标记），不再静默丢弃窗口外任务。
   - 归档 `notIn` 膨胀（需 archivedAt 迁移，7 张表联动）明确不在本任务范围，在 spec/报告中记录。

7. **低优先级四项**
   - `server/src/llm/anthropicClient.ts`：流式增加读空闲超时；迭代器 finally 中 `reader.cancel()`，早退不再泄漏连接。
   - `server/src/llm/structuredInvokeParser.ts`：`tryFixTruncatedJson` 应用修复时输出告警日志（含截断特征），行为不变。
   - `server/src/services/image/provider.ts`：multipart `/images/edits` 路径支持多张参考图（`image[]`），不再静默只发第一张；JSON 路径维持单张（接口限制）。
   - 关注中心/任务中心轮询：全部条目均为终态时停轮（与 Home.tsx 既有模式一致）。

### 环境问题

- E1：空 `server/dev.db` 建表（prisma migrate deploy，空库无数据风险，先复核文件为空库）→ 62 fast + 28 integration 失败应消失。
- E2：`server/scripts/run-tests.cjs` fast 分支改用 node:test 编程式 API 并在结束后显式退出，消除套件尾部挂起。
- E3：外部进程删除新建文件现象做尽力排查并记录结论。

## 约束

- 不改动 `09-06-director-badge-semantics` 的徽标语义判断逻辑（只做计数算术修正）。
- 迁移类改动优先选择无迁移方案（如进程内互斥、既有唯一约束复用）；确需迁移时评估 prisma 漂移风险。
- 每个修复项独立提交，提交前跑对应最小验证；发布说明按 readme-release-updater 流程在收尾统一更新。
