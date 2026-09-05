const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

// 在要求任何 dist 模块之前把数据库切到临时目录，
// 后续 require 会把 prisma 客户端建在这个临时库上。
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-review-ch-"));
process.env.AI_NOVEL_APP_DATA_DIR = tempDataDir;
process.env.AI_NOVEL_RUNTIME = "desktop";
delete process.env.DATABASE_URL;

const { ensureRuntimeDatabaseReady } = require("../dist/db/runtimeMigrations.js");

test("setup: runtime migration chain builds the sqlite schema", async () => {
  await ensureRuntimeDatabaseReady();
  assert.ok(fs.existsSync(path.join(tempDataDir, "data", "dev.db")));
});

test("getThreadState rejects with a 404 AppError for an unknown thread", async () => {
  const { creativeHubService } = require("../dist/creativeHub/CreativeHubService.js");
  await assert.rejects(
    () => creativeHubService.getThreadState("wf-review-missing-thread"),
    (error) => error.statusCode === 404,
    "线程不存在应映射为 404，而不是普通 500 错误",
  );
});

test("stream run for an unknown thread returns a clean 404 instead of a dead SSE stream", async () => {
  const { createApp } = require("../dist/app.js");
  const http = require("node:http");
  const app = createApp();
  const server = http.createServer(app);
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/creative-hub/threads/wf-review-missing-thread/runs/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assert.equal(response.status, 404, "未知线程的流式运行请求应在发送 SSE 头之前失败为 404");
    const contentType = response.headers.get("content-type") ?? "";
    assert.ok(contentType.includes("application/json"), `未知线程应返回 JSON 错误，实际 content-type: ${contentType}`);
    const payload = await response.json();
    assert.equal(payload.success, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("teardown: disconnect prisma so the test process can exit", async () => {
  const { prisma } = require("../dist/db/prisma.js");
  await prisma.$disconnect();
  const fs = require("node:fs");
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});
