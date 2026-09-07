const test = require("node:test");
const assert = require("node:assert/strict");

const { ragServices } = require("../dist/services/rag/index.js");
const { prisma } = require("../dist/db/prisma.js");

test("concurrent enqueue for the same owner creates a single queued job", async () => {
  // 从模块门面取单例：直接 require RagIndexService.js 会触发 rag 模块的循环导入链
  const service = ragServices.ragIndexService;
  const originalFindFirst = prisma.ragIndexJob.findFirst;
  const originalCreate = prisma.ragIndexJob.create;
  let findFirstCalls = 0;
  let createCalls = 0;
  const jobsByOwner = new Map();
  prisma.ragIndexJob.findFirst = async ({ where }) => {
    findFirstCalls += 1;
    // 延长检查窗口：修复前两个并发调用都会在这里通过检查然后各自创建
    await new Promise((resolve) => setTimeout(resolve, 20));
    return jobsByOwner.get(where.ownerId) ?? null;
  };
  prisma.ragIndexJob.create = async ({ data }) => {
    createCalls += 1;
    const job = { id: `job-${createCalls}`, ...data };
    jobsByOwner.set(data.ownerId, job);
    return job;
  };
  try {
    const [first, second] = await Promise.all([
      service.enqueueUpsert("novel", "novel-fix4"),
      service.enqueueUpsert("novel", "novel-fix4"),
    ]);
    assert.equal(createCalls, 1, `并发同 owner 入队只能创建一个任务，实际创建 ${createCalls} 个`);
    assert.equal(first.id, second.id, "并发调用应复用同一个任务");
    assert.equal(findFirstCalls, 2, "串行化后第二次调用会重新检查（发现已有任务）");

    // 不同 owner 不应被相互阻塞
    await service.enqueueUpsert("novel", "novel-fix4-other");
    assert.equal(createCalls, 2);
  } finally {
    prisma.ragIndexJob.findFirst = originalFindFirst;
    prisma.ragIndexJob.create = originalCreate;
  }
});
