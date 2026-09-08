const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectCurrentQualityDebtRepairJob,
} = require("../dist/modules/novel/setup/application/simpleCreationShelfProgress.js");

function job(overrides) {
  return {
    id: "job-default",
    status: "queued",
    pendingManualRecovery: false,
    createdAt: new Date("2026-09-08T00:00:00.000Z"),
    updatedAt: new Date("2026-09-08T00:00:00.000Z"),
    payload: JSON.stringify({ chapterScope: "quality_debt" }),
    ...overrides,
  };
}

test("current quality-debt repair prefers a live Gemini job over a later-updated paused DeepSeek job", () => {
  const selected = selectCurrentQualityDebtRepairJob([
    job({
      id: "deepseek-paused",
      status: "queued",
      pendingManualRecovery: true,
      createdAt: new Date("2026-09-08T00:47:00.000Z"),
      updatedAt: new Date("2026-09-08T06:56:17.000Z"),
      payload: JSON.stringify({
        chapterScope: "quality_debt",
        provider: "deepseek",
        model: "",
      }),
      error: "未配置 DeepSeek 的 API Key。",
    }),
    job({
      id: "gemini-running",
      status: "running",
      pendingManualRecovery: false,
      createdAt: new Date("2026-09-08T06:56:40.000Z"),
      updatedAt: new Date("2026-09-08T06:56:40.000Z"),
      payload: JSON.stringify({
        chapterScope: "quality_debt",
        provider: "custom_cpa",
        model: "gemini-3.8-flash-high",
      }),
    }),
  ]);

  assert.equal(selected?.id, "gemini-running");
});

test("current quality-debt repair keeps a completed run instead of an older paused attempt", () => {
  const selected = selectCurrentQualityDebtRepairJob([
    job({
      id: "paused-old",
      status: "queued",
      pendingManualRecovery: true,
      createdAt: new Date("2026-09-08T00:47:00.000Z"),
      updatedAt: new Date("2026-09-08T06:56:17.000Z"),
    }),
    job({
      id: "completed-new",
      status: "succeeded",
      createdAt: new Date("2026-09-08T04:33:51.000Z"),
      updatedAt: new Date("2026-09-08T06:42:51.000Z"),
    }),
  ]);

  assert.equal(selected?.id, "completed-new");
});

test("current quality-debt repair surfaces the newest paused attempt when nothing is live", () => {
  const selected = selectCurrentQualityDebtRepairJob([
    job({
      id: "paused-old",
      status: "queued",
      pendingManualRecovery: true,
      createdAt: new Date("2026-09-08T00:47:00.000Z"),
    }),
    job({
      id: "paused-new",
      status: "queued",
      pendingManualRecovery: true,
      createdAt: new Date("2026-09-08T00:54:00.000Z"),
    }),
  ]);

  assert.equal(selected?.id, "paused-new");
});
