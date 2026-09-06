const test = require("node:test");
const assert = require("node:assert/strict");

const { StateService } = require("../dist/services/state/StateService.js");
const { AppError } = require("../dist/middleware/errorHandler.js");
const { prisma } = require("../dist/db/prisma.js");

test("rebuildState rebuilds chapter by chapter and preserves completed chapters on failure", async () => {
  const service = new StateService();
  const chapters = [
    { id: "chapter-1", content: "第一章内容", order: 1 },
    { id: "chapter-2", content: "第二章内容", order: 2 },
    { id: "chapter-3", content: "第三章内容", order: 3 },
  ];
  const deletedScopes = [];
  const rebuiltSnapshots = [];
  const originals = [];
  const stub = (target, key, implementation) => {
    originals.push([target, key, target[key]]);
    target[key] = implementation;
  };

  stub(prisma.chapter, "findMany", async () => chapters);
  stub(prisma.storyStateSnapshot, "deleteMany", async ({ where }) => {
    deletedScopes.push(where);
    return { count: 0 };
  });
  service.syncChapterState = async (novelId, chapterId) => {
    if (chapterId === "chapter-2") {
      throw new Error("LLM 提取超时");
    }
    const snapshot = { chapterId, summary: `第 ${chapterId} 章状态` };
    rebuiltSnapshots.push(snapshot);
    return snapshot;
  };

  try {
    await assert.rejects(
      () => service.rebuildState("novel-fix5"),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 502);
        assert.ok(error.message.includes("第2章"), `错误信息应指明失败章节：${error.message}`);
        assert.ok(error.message.includes("已完成章节的状态已保留"));
        return true;
      },
      "存在失败章节时应抛出聚合错误",
    );

    // 逐章删建：每章只删自己的快照，第 2、3 章的处理照常发生（第 3 章成功）
    assert.deepEqual(deletedScopes.map((scope) => scope.sourceChapterId), [
      "chapter-1",
      "chapter-2",
      "chapter-3",
    ]);
    // 第 2 章失败后第 3 章继续，成功的章节都已入库
    assert.deepEqual(
      rebuiltSnapshots.map((snapshot) => snapshot.chapterId),
      ["chapter-1", "chapter-3"],
    );
  } finally {
    for (const [target, key, value] of originals) {
      target[key] = value;
    }
  }
});

test("rebuildState returns all snapshots when every chapter succeeds", async () => {
  const service = new StateService();
  const chapters = [
    { id: "chapter-1", content: "第一章内容", order: 1 },
    { id: "chapter-2", content: "   ", order: 2 },
    { id: "chapter-3", content: "第三章内容", order: 3 },
  ];
  const originals = [];
  const stub = (target, key, implementation) => {
    originals.push([target, key, target[key]]);
    target[key] = implementation;
  };
  stub(prisma.chapter, "findMany", async () => chapters);
  stub(prisma.storyStateSnapshot, "deleteMany", async () => ({ count: 0 }));
  service.syncChapterState = async (novelId, chapterId) => ({ chapterId });

  try {
    const rebuilt = await service.rebuildState("novel-fix5-ok");
    assert.deepEqual(rebuilt.map((snapshot) => snapshot.chapterId), ["chapter-1", "chapter-3"], "空内容章节应跳过");
  } finally {
    for (const [target, key, value] of originals) {
      target[key] = value;
    }
  }
});
