const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderModelLimiter } = require("../dist/llm/requestLimiter.js");
const { NovelSideEffectWorker } = require("../dist/events/sideEffects/NovelSideEffectWorker.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("stream limiter holds the concurrency slot until the stream is fully consumed", async () => {
  const limiter = createProviderModelLimiter({
    provider: "openai",
    model: "gpt-test",
    concurrencyLimit: 1,
    requestIntervalMs: 0,
  });

  let openStreams = 0;
  let activeStreams = 0;
  let maxActiveStreams = 0;

  const openStream = async () => {
    openStreams += 1;
    return (async function* generate() {
      activeStreams += 1;
      maxActiveStreams = Math.max(maxActiveStreams, activeStreams);
      try {
        await sleep(30);
        yield "chunk-1";
        await sleep(30);
        yield "chunk-2";
      } finally {
        activeStreams -= 1;
      }
    })();
  };

  const consume = async () => {
    const stream = await limiter.runStream(openStream);
    for await (const chunk of stream) {
      void chunk;
    }
  };

  await Promise.all([consume(), consume(), consume()]);

  assert.equal(openStreams, 3, "三个消费方都应建立流");
  assert.equal(maxActiveStreams, 1, "并发限制为 1 时，三个流不允许同时在生成中");
});

test("stream limiter releases the slot on early break", async () => {
  const limiter = createProviderModelLimiter({
    provider: "openai",
    model: "gpt-test",
    concurrencyLimit: 1,
    requestIntervalMs: 0,
  });

  const stream = await limiter.runStream(async () => {
    return (async function* generate() {
      yield "a";
      yield "b";
      yield "c";
    })();
  });

  for await (const chunk of stream) {
    if (chunk === "a") {
      break; // 提前终止必须通过生成器 finally 释放槽位
    }
  }

  // 槽位已释放：下一个请求可以立即进入。
  const secondStream = await limiter.runStream(async () => {
    return (async function* generate() {
      yield "d";
    })();
  });
  const chunks = [];
  for await (const chunk of secondStream) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, ["d"]);
});

test("side-effect worker tick survives a lost lease without unhandled rejection", async () => {
  const job = {
    id: "job-1",
    jobType: "novel.pipelineSnapshot",
    payloadJson: "{}",
    payloadVersion: 1,
    leaseOwner: "worker-1",
    attempts: 1,
    maxAttempts: 5,
    runAfter: new Date(),
  };
  const jobService = {
    leaseNext: async () => job,
    markSucceeded: async () => {
      throw new Error("CAS failed: job no longer running");
    },
    markFailedOrDead: async () => {
      throw new Error("CAS failed: job no longer running");
    },
  };
  const handlers = {
    execute: async () => {},
  };

  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    const worker = new NovelSideEffectWorker(jobService, handlers);
    await worker.tick(); // 当前实现：markFailedOrDead 二次抛错会向外逃逸
    assert.equal(rejections.length, 0, "丢失租约时 tick 不应产生未处理拒绝（会导致进程退出）");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("side-effect worker tick swallows leaseNext failures", async () => {
  const jobService = {
    leaseNext: async () => {
      throw new Error("SQLITE_BUSY: database is locked");
    },
    markSucceeded: async () => {},
    markFailedOrDead: async () => {},
  };
  const worker = new NovelSideEffectWorker(jobService, { execute: async () => {} });
  await assert.doesNotReject(() => worker.tick());
});
