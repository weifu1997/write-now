const test = require("node:test");
const assert = require("node:assert/strict");

const { ImageGenerationService } = require("../dist/services/image/ImageGenerationService.js");
const { RecoveryTaskService } = require("../dist/services/task/RecoveryTaskService.js");

function withUnhandledRejectionCapture(callback) {
  return new Promise((resolve, reject) => {
    const rejections = [];
    const onRejection = (reason) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    const finish = (error) => {
      process.off("unhandledRejection", onRejection);
      if (error) {
        reject(error);
      } else {
        resolve(rejections);
      }
    };
    Promise.resolve()
      .then(callback)
      .then(() => setTimeout(() => finish(), 20))
      .catch(finish);
  });
}

test("image task queue keeps draining after a task execution throws", async () => {
  const service = new ImageGenerationService();
  const processed = [];
  const rejections = await withUnhandledRejectionCapture(async () => {
    service.executeTask = async (taskId) => {
      processed.push(taskId);
      if (taskId === "task-1") {
        throw new Error("transient sqlite busy");
      }
    };
    service.enqueueTask("task-1");
    service.enqueueTask("task-2");
  });

  assert.deepEqual(
    [...processed].sort(),
    ["task-1", "task-2"],
    `首个任务抛错后队列必须继续处理剩余任务，实际处理了 ${JSON.stringify(processed)}`,
  );
  assert.equal(
    rejections.length,
    0,
    `enqueueTask 使用 void 调用 processQueue，任务抛错会变成未处理的 Promise 拒绝（进程默认退出）`,
  );
  assert.equal(service.queue.length, 0, "队列不应残留未处理任务");
});

test("recovery initialization retries after a failed attempt instead of caching the rejection", async () => {
  let attempts = 0;
  const service = new RecoveryTaskService(
    undefined,
    undefined,
    undefined,
    undefined,
    {
      markPendingBookAnalysesForManualRecovery: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
      },
      markPendingImageTasksForManualRecovery: async () => {},
      markPendingAutoDirectorTasksForManualRecovery: async () => {},
      markPendingPipelineJobsForManualRecovery: async () => {},
      markPendingStyleTasksForManualRecovery: async () => {},
    },
  );

  await assert.rejects(
    () => service.initializePendingRecoveries(),
    /SQLITE_BUSY/,
    "首次初始化失败应向调用方抛出",
  );

  await service.initializePendingRecoveries();
  assert.equal(attempts, 2, "失败后再次初始化应重新执行，而不是永远返回缓存的失败 Promise");
  await service.waitUntilReady();
});
