# 章节计划代价与意外字段 — 执行清单

## 分支与提交

- 从 `beta`（含前序子任务合并结果）拉 `feature/chapter-plan-cost-complication`。
- 提交前按 README Release Notes Workflow 更新发布说明；本任务有明确用户可见影响（章节计划新增代价/意外引导）。

## 阶段 1：schema 与序列化

- [ ] `shared/types/novel/readerExperience.ts`：宽松版与生成版均加 optional 两字段（节奏判断在提示词层，schema 不强制）。
- [ ] `chapterDetailSchemas.ts` 校验跟随；确认 `normalizeChapterScenePlan` / `serializeChapterScenePlan` round-trip 不丢字段。
- [ ] 单测：round-trip（新数据含字段、旧数据无字段、字段缺省不报错）。
- 验证：`pnpm -C server test`（定向）+ typecheck。

## 阶段 2：生成链路提示词

- [ ] `volumeChapterTaskSheetPrompt` 字段清单加两字段 + 语义定义 + 节奏判断与反机械引导（推进章有代价、转折章有意外、缓冲章可缺省、类型轮换、幅度分级）；版本升级。
- [ ] `planner.chapter.plan` v1→v2：字段说明鼓励产出（可选）。
- [ ] 注册校验通过。

## 阶段 3：消费与约束贯通

- [ ] `chapterLayeredContext.buildCompatibleReaderExperienceContract` 兜底映射（无字段返回 undefined，不造空值）。
- [ ] `chapterContextBlocks` reader_experience 渲染两字段（非空才渲染）。
- [ ] `novel.chapter.writer` 核心约束 1a 扩展（版本 +1，与范文锚点任务协调版本号）：字段存在时正文可见兑现，代价须有具体事件承载。
- [ ] `novel.review.chapter` 审查重点扩展（版本 +1）。
- [ ] 注册校验 + typecheck。

## 阶段 4：回归与收尾

- [ ] 存量书回归：旧任务单 → 分层上下文 → writer 全链路无报错（可用现有服务层测试或本地起服务冒烟）。
- [ ] 种子章节前后对比（按父任务统一参数留档）：任务单按节奏含字段、兑现自然、审查可指出机械插入（父任务跨子验收项）。
- [ ] wiki 更新：reader experience 合同新字段契约与兼容规则（docs/wiki/workflows/ 章节生产链相关页）。
- [ ] 阶段提交；合并进 `beta` 集成验证。

## 回滚点

- 阶段 1-2（生成侧）与阶段 3（消费侧）可独立回退；无迁移无数据回滚。
- 若 beta 集成发现字段质量差（凑字段编造重大意外），先收紧提示词语义与示例，而不是回退 schema。
