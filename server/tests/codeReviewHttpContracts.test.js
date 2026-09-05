const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const { createHmac } = require("node:crypto");

const { listQuerySchema } = require("../dist/routes/autoDirectorFollowUps.js");
const { verifyWeComMarkdownSignature } = require("../dist/routes/autoDirectorChannelCallbacks.js");
const { errorHandler, AppError } = require("../dist/middleware/errorHandler.js");
const { validate } = require("../dist/middleware/validate.js");
const { signWeComMarkdownCallback } = require("../dist/services/task/autoDirectorFollowUps/wecomMarkdownCallback.js");
const { z } = require("zod");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

test("follow-up list schema maps supportsBatch=false to false", () => {
  const parsed = listQuerySchema.parse({ supportsBatch: "false" });
  assert.equal(parsed.supportsBatch, false, "supportsBatch=false 不应被布尔强制转换成 true");
  const parsedTrue = listQuerySchema.parse({ supportsBatch: "true" });
  assert.equal(parsedTrue.supportsBatch, true);
  // 幂等：validate 中间件把解析结果写回 req.query 后，路由内的二次 parse
  // 拿到的是布尔值，schema 对两种形态必须都能解析。
  const reparsed = listQuerySchema.parse({ section: "pending", ...parsed });
  assert.equal(reparsed.supportsBatch, false);
  // 其余任意取值仍然拒绝（旧的 z.coerce.boolean 会把 "0"/"false" 以外的值也放行为 true）
  assert.throws(() => listQuerySchema.parse({ supportsBatch: "0" }));
});

test("wecom markdown signature rejects an unconfigured (empty) callback token", () => {
  const input = {
    callbackId: "cb-1",
    eventId: "ev-1",
    taskId: "task-1",
    actionCode: "continue_auto_execution",
    signature: signWeComMarkdownCallback(
      { callbackId: "cb-1", eventId: "ev-1", taskId: "task-1", actionCode: "continue_auto_execution" },
      "",
    ),
    callbackToken: "",
  };
  assert.throws(
    () => verifyWeComMarkdownSignature(input),
    (error) => error instanceof AppError && error.statusCode === 403,
    "空 token 时任何人都能伪造签名，必须拒绝",
  );
});

test("wecom markdown signature still accepts a configured token with a valid signature", () => {
  const callbackToken = "secret-token";
  const input = {
    callbackId: "cb-1",
    eventId: "ev-1",
    taskId: "task-1",
    actionCode: "continue_auto_execution",
    signature: signWeComMarkdownCallback(
      { callbackId: "cb-1", eventId: "ev-1", taskId: "task-1", actionCode: "continue_auto_execution" },
      callbackToken,
    ),
    callbackToken,
  };
  assert.doesNotThrow(() => verifyWeComMarkdownSignature(input));
});

test("wecom markdown signature rejects a forged signature when a token is configured", () => {
  const forged = createHmac("sha256", "attacker-key").update("payload").digest("hex");
  const input = {
    callbackId: "cb-1",
    eventId: "ev-1",
    taskId: "task-1",
    actionCode: "continue_auto_execution",
    signature: forged,
    callbackToken: "secret-token",
  };
  assert.throws(
    () => verifyWeComMarkdownSignature(input),
    (error) => error instanceof AppError && error.statusCode === 403,
  );
});

test("malformed JSON body returns 400 instead of 500", async () => {
  const app = express();
  app.post("/echo", express.json({ limit: "1mb" }), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    assert.equal(response.status, 400, "body-parser 的 JSON 解析错误应映射为 400");
    const payload = await response.json();
    assert.equal(payload.success, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unsupported request charset returns 415 instead of 500", async () => {
  const app = express();
  app.post("/echo", express.json({ limit: "1mb" }), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=gbk" },
      body: JSON.stringify({ ok: true }),
    });
    assert.equal(response.status, 415, "body-parser 的不支持的字符集错误应映射为 415");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("error handler does not throw when response headers were already sent", async () => {
  const app = express();
  let handlerError = null;
  app.get("/stream", (req, res) => {
    res.status(200).setHeader("content-type", "text/event-stream");
    res.flushHeaders?.();
    res.write("data: partial\n\n");
    // 模拟流中途出错（例如上游读流失败）后进入错误处理。
    try {
      errorHandler(new Error("upstream stream failed"), req, res, () => {});
    } catch (error) {
      handlerError = error;
    }
    if (!res.writableEnded) {
      res.end();
    }
  });
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/stream`);
    await response.text();
    assert.equal(response.status, 200);
    assert.equal(
      handlerError,
      null,
      `错误处理器在 headers 已发送后不应再尝试 res.status().json()：${handlerError}`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("validate middleware writes parsed query values back for handlers", async () => {
  const app = express();
  const querySchema = z.object({
    flag: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  });
  app.get("/probe", validate({ query: querySchema }), (req, res) => {
    res.json({ flag: req.query.flag, type: typeof req.query.flag, extra: req.query.extra ?? null });
  });
  app.use(errorHandler);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/probe?flag=false&extra=keep`);
    const payload = await response.json();
    assert.equal(payload.flag, false, "处理器应读到转换后的布尔值 false");
    assert.equal(payload.type, "boolean");
    assert.equal(payload.extra, "keep", "schema 之外的 query 参数应保持原样");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
