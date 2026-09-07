const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DirectorEventProjectionService,
} = require("../dist/services/novel/director/runtime/DirectorEventProjectionService.js");

function buildSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    runId: "task-1",
    novelId: "novel-1",
    entrypoint: "confirm",
    policy: {
      mode: "run_until_gate",
      mayOverwriteUserContent: false,
      allowExpensiveReview: false,
      modelTier: "balanced",
      updatedAt: "2026-04-28T00:00:00.000Z",
    },
    steps: [],
    events: [],
    artifacts: [],
    updatedAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

function buildFactSummary(overrides = {}) {
  return {
    allStepsCompleted: false,
    completedStepCount: 180,
    totalStepCount: 240,
    hasNovelProject: true,
    hasStoryMacro: true,
    hasBookContract: true,
    characterCount: 3,
    hasVolumeStrategy: true,
    volumeCount: 3,
    outlineFacts: {
      beatSheetReady: true,
      chapterListReady: true,
      chapterDetailReady: true,
      plannedChapterCount: 24,
      selectedChapterCount: 24,
      completedDetailSteps: 24,
      totalDetailSteps: 24,
      syncedChapterCount: 24,
    },
    chapterExecutionFacts: {
      totalChapters: 24,
      draftedChapterCount: 0,
      reviewedChapterCount: 0,
      approvedChapterCount: 0,
      committedChapterCount: 0,
      completedChapters: 0,
      needsRepairChapters: 0,
      ratio: 0,
    },
    repairFacts: {
      draftedChapterCount: 0,
      reviewedChapterCount: 0,
      committedChapterCount: 0,
      needsRepairChapters: 0,
      payoffArtifactCount: 0,
      characterResourceArtifactCount: 0,
    },
    steps: [],
    ...overrides,
  };
}

test("progress denominator uses fact summary total when the snapshot window is truncated", () => {
  const service = new DirectorEventProjectionService();
  const snapshot = buildSnapshot({
    steps: [
      { idempotencyKey: "s1", nodeKey: "a", label: "A", status: "succeeded" },
    ],
  });

  const projection = service.buildSnapshotProjection(snapshot, {
    factSummary: buildFactSummary(),
  });
  assert.ok(
    projection.progressSummary.includes("180/240 个步骤完成"),
    `长任务进度应使用全量步数分母，实际：${projection.progressSummary}`,
  );
});

test("progress falls back to snapshot counts without fact summary", () => {
  const service = new DirectorEventProjectionService();
  const snapshot = buildSnapshot({
    steps: [
      { idempotencyKey: "s1", nodeKey: "a", label: "A", status: "succeeded" },
      { idempotencyKey: "s2", nodeKey: "b", label: "B", status: "failed" },
    ],
  });

  const projection = service.buildSnapshotProjection(snapshot);
  assert.ok(projection.progressSummary.includes("1/2 个步骤完成"));
  assert.ok(projection.progressSummary.includes("1 个步骤失败"));
});

test("quality debt count dedupes repeated defer events for the same chapter", () => {
  const service = new DirectorEventProjectionService();
  const baseEvent = {
    type: "continue_with_risk",
    taskId: "task-1",
    novelId: "novel-1",
    nodeKey: "planner.replan",
    summary: "章节质量债已登记并继续推进。",
    severity: "medium",
  };
  const snapshot = buildSnapshot({
    policy: {
      mode: "auto_safe_scope",
      mayOverwriteUserContent: false,
      allowExpensiveReview: false,
      modelTier: "balanced",
      updatedAt: "2026-04-28T00:00:00.000Z",
    },
    events: [
      { ...baseEvent, eventId: "e1", affectedScope: "chapter_order:6", metadata: { chapterOrder: 6 }, occurredAt: "2026-04-28T00:00:02.000Z" },
      { ...baseEvent, eventId: "e2", affectedScope: "chapter_order:6", metadata: { chapterOrder: 6 }, occurredAt: "2026-04-28T00:00:03.000Z", summary: "第 6 章重试后再次登记质量债。" },
      { ...baseEvent, eventId: "e3", affectedScope: "chapter_order:9", metadata: { chapterOrder: 9 }, occurredAt: "2026-04-28T00:00:04.000Z", summary: "第 9 章登记质量债。" },
      { ...baseEvent, eventId: "e4", occurredAt: "2026-04-28T00:00:05.000Z", summary: "无法归属章节的质量债。" },
    ],
  });

  const projection = service.buildSnapshotProjection(snapshot);
  assert.deepEqual(projection.qualityDebtSummary.deferredChapterOrders, [6, 9]);
  assert.equal(
    projection.qualityDebtSummary.deferredChapterCount,
    3,
    "同一章的重复事件只计一次，无法归属章节的事件单独计数",
  );
});
