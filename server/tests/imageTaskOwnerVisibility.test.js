const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveImageTaskOwnerKey,
  selectLatestVisibleImageTasks,
} = require("../dist/services/task/imageTaskOwnerVisibility.js");

test("image task owner key groups novel covers by novel, not by retry id", () => {
  assert.equal(
    resolveImageTaskOwnerKey({
      id: "cover-1",
      sceneType: "novel_cover",
      novelId: "novel-a",
      updatedAt: new Date("2026-09-06T02:43:00.000Z"),
    }),
    "novel_cover:novel-a",
  );
  assert.equal(
    resolveImageTaskOwnerKey({
      id: "cover-2",
      sceneType: "novel_cover",
      novelId: "novel-a",
      updatedAt: new Date("2026-09-06T02:43:12.000Z"),
    }),
    "novel_cover:novel-a",
  );
});

test("latest visible image tasks keep one failed cover per novel", () => {
  const visible = selectLatestVisibleImageTasks([
    {
      id: "cover-old",
      sceneType: "novel_cover",
      novelId: "novel-a",
      status: "failed",
      updatedAt: new Date("2026-09-05T17:10:59.000Z"),
    },
    {
      id: "cover-latest",
      sceneType: "novel_cover",
      novelId: "novel-a",
      status: "failed",
      updatedAt: new Date("2026-09-06T02:43:12.000Z"),
    },
    {
      id: "cover-other",
      sceneType: "novel_cover",
      novelId: "novel-b",
      status: "failed",
      updatedAt: new Date("2026-09-06T01:00:00.000Z"),
    },
  ]);

  assert.deepEqual(
    visible.map((row) => row.id).sort(),
    ["cover-latest", "cover-other"],
  );
});
