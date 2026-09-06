const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../dist/db/prisma.js");

const {
  DirectorRuntimeStore,
} = require("../dist/services/novel/director/runtime/DirectorRuntimeStore.js");

const TASK_ID = "task-store-concurrency";
const NOVEL_ID = "novel-store-concurrency";

function makeEventRow(eventId, occurredAtMs) {
  return {
    id: eventId,
    taskId: TASK_ID,
    novelId: NOVEL_ID,
    nodeKey: "test_node",
    artifactId: null,
    artifactType: null,
    summary: `事件 ${eventId}`,
    affectedScope: null,
    severity: "info",
    occurredAt: new Date(occurredAtMs),
    metadataJson: null,
  };
}

function makeStepRow(idempotencyKey, status, updatedAtMs) {
  return {
    idempotencyKey,
    nodeKey: "test_node",
    label: "测试步骤",
    status,
    targetType: "novel",
    targetId: NOVEL_ID,
    startedAt: new Date(updatedAtMs),
    finishedAt: null,
    error: null,
    producedArtifactsJson: null,
    policyDecisionJson: null,
    updatedAt: new Date(updatedAtMs),
  };
}

test("concurrent snapshot mutations on the same task do not overwrite each other", async () => {
  // 内存态持久化层：steps/events/artifacts 表 + run 行
  const stepRows = new Map();
  const eventRows = new Map();
  const artifactRows = [];
  let runRow = null;
  let occurredAt = Date.now();

  const originals = [];
  const stub = (target, key, implementation) => {
    originals.push([target, key, target[key]]);
    target[key] = implementation;
  };

  stub(prisma.novelWorkflowTask, "findUnique", async () => ({
    id: TASK_ID,
    novelId: NOVEL_ID,
    seedPayloadJson: JSON.stringify({}),
  }));
  stub(prisma.directorRun, "findUnique", async () => {
    if (!runRow) {
      return null;
    }
    return {
      ...runRow,
      steps: [...stepRows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      events: [...eventRows.values()].sort((a, b) => b.occurredAt - a.occurredAt),
      artifacts: artifactRows,
    };
  });
  stub(prisma.directorRun, "upsert", async ({ create, update }) => {
    if (!runRow) {
      runRow = { ...create, updatedAt: new Date(), lastWorkspaceAnalysisJson: null };
    } else {
      Object.assign(runRow, update, { updatedAt: new Date() });
    }
    return runRow;
  });
  stub(prisma.directorStepRun, "upsert", async ({ where, create, update }) => {
    const existing = stepRows.get(where.idempotencyKey);
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const row = { ...create };
    stepRows.set(where.idempotencyKey, row);
    return row;
  });
  stub(prisma.directorEvent, "upsert", async ({ where, create }) => {
    const row = {
      ...create,
      occurredAt: new Date(++occurredAt),
      metadataJson: create.metadataJson ?? null,
    };
    eventRows.set(where.id, row);
    return row;
  });
  stub(prisma.directorEvent, "create", async ({ data }) => {
    const row = { ...data, occurredAt: new Date(++occurredAt) };
    eventRows.set(data.id, row);
    return row;
  });
  stub(prisma.directorArtifact, "upsert", async ({ where, create }) => {
    let row = artifactRows.find((item) => item.id === where.id);
    if (!row) {
      row = { ...create, updatedAt: new Date(), dependencies: [] };
      artifactRows.push(row);
    }
    return row;
  });
  stub(prisma.directorArtifactDependency, "deleteMany", async () => ({ count: 0 }));
  stub(prisma.directorArtifactDependency, "upsert", async () => ({}));

  try {
    // 两个独立实例并发变更同一任务：若串行化生效，第二次变更会读到
    // 第一次写入的事件并追加 batch-2；否则两者都基于空基线各写 batch-1。
    const storeA = new DirectorRuntimeStore();
    const storeB = new DirectorRuntimeStore();
    const makeMutator = () => (snapshot) => ({
      ...snapshot,
      runId: snapshot.runId ?? TASK_ID,
      novelId: NOVEL_ID,
      entrypoint: snapshot.entrypoint ?? "test",
      events: [
        ...snapshot.events,
        {
          eventId: `batch-${snapshot.events.length + 1}`,
          type: "step_succeeded",
          taskId: TASK_ID,
          novelId: NOVEL_ID,
          summary: `批次 ${snapshot.events.length + 1}`,
          occurredAt: new Date().toISOString(),
        },
      ],
    });

    await Promise.all([
      storeA.mutateSnapshot(TASK_ID, makeMutator()),
      storeB.mutateSnapshot(TASK_ID, makeMutator()),
    ]);

    const eventIds = [...eventRows.keys()].sort();
    assert.deepEqual(
      eventIds,
      ["batch-1", "batch-2"],
      `并发变更应串行累加事件，实际持久化事件：${JSON.stringify(eventIds)}`,
    );
  } finally {
    for (const [target, key, value] of originals) {
      target[key] = value;
    }
  }
});
