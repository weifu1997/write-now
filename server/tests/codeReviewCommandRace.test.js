const test = require("node:test");
const assert = require("node:assert/strict");

const { DirectorCommandService } = require("../dist/services/novel/director/commands/DirectorCommandService.js");
const { DirectorCommandExecutor } = require("../dist/services/novel/director/commands/DirectorCommandExecutor.js");
const { prisma } = require("../dist/db/prisma.js");

test("concurrent identical commands produce a single active command", async () => {
  const service = new DirectorCommandService({
    getTaskById: async () => ({
      id: "task-cmd-race",
      lane: "auto_director",
      novelId: "novel-1",
      updatedAt: new Date(Date.now() + readCalls),
    }),
  });
  let readCalls = 0;
  service.recoverStaleLeases = async () => 0;

  const originals = [];
  const stub = (target, key, implementation) => {
    originals.push([target, key, target[key]]);
    target[key] = implementation;
  };

  const activeCommands = [];
  let createCalls = 0;
  try {
    stub(prisma.directorRunCommand, "findFirst", async ({ where }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const types = typeof where.commandType === "string"
        ? [where.commandType]
        : where.commandType.in;
      return activeCommands.find((command) => command.taskId === where.taskId
        && types.includes(command.commandType)
        && where.status.in.includes(command.status)) ?? null;
    });
    stub(prisma.directorRunCommand, "create", async ({ data }) => {
      createCalls += 1;
      const command = { id: `cmd-${createCalls}`, status: "queued", ...data };
      activeCommands.push(command);
      return command;
    });
    stub(prisma.novelWorkflowTask, "updateMany", async () => ({ count: 1 }));

    // 两次请求读到不同的 task.updatedAt（第一次入队会更新任务行），
    // 修复前会生成两个不同幂等键、各自创建成功 → 两个活跃命令。
    const [first, second] = await Promise.all([
      service.enqueueExecutionCommand({ taskId: "task-cmd-race", commandType: "generate_candidates", payload: {} }),
      service.enqueueExecutionCommand({ taskId: "task-cmd-race", commandType: "generate_candidates", payload: {} }),
    ]);

    assert.equal(createCalls, 1, `并发相同命令只应创建一次，实际创建 ${createCalls} 次`);
    assert.equal(first.commandId ?? first.id, second.commandId ?? second.id, "并发调用应复用同一个活跃命令");
  } finally {
    for (const [target, key, value] of originals) {
      target[key] = value;
    }
  }
});

test("concurrent command results both survive seed payload merge", async () => {
  const executor = new DirectorCommandExecutor({});
  const originals = [];
  const stub = (target, key, implementation) => {
    originals.push([target, key, target[key]]);
    target[key] = implementation;
  };

  // 用串行化的事务桩模拟数据库事务（SQLite 单写者语义）
  let currentSeedPayload = {};
  const txStub = {
    novelWorkflowTask: {
      findUnique: async () => ({
        seedPayloadJson: JSON.stringify(currentSeedPayload),
      }),
      update: async ({ data }) => {
        currentSeedPayload = JSON.parse(data.seedPayloadJson);
        return {};
      },
    },
  };
  let txChain = Promise.resolve();
  try {
    stub(prisma, "$transaction", (fn) => {
      const run = txChain.then(() => fn(txStub));
      txChain = run.then(() => undefined, () => undefined);
      return run;
    });

    await Promise.all([
      executor.recordCommandResult("task-merge", "cmd-a", { ok: true }),
      executor.recordCommandResult("task-merge", "cmd-b", { ok: true }),
    ]);

    const results = currentSeedPayload.directorCommandResults ?? {};
    assert.ok(results["cmd-a"], "cmd-a 的执行结果不应被 cmd-b 覆盖丢失");
    assert.ok(results["cmd-b"], "cmd-b 的执行结果不应被 cmd-a 覆盖丢失");
  } finally {
    for (const [target, key, value] of originals) {
      target[key] = value;
    }
  }
});
