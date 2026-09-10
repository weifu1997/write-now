const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePipelineChapterScope,
  selectPipelineChapters,
} = require("../dist/services/novel/production/pipelineChapterSelection.js");

test("quality-debt pipeline scope only keeps chapters with open local quality debt", () => {
  const chapters = [
    {
      id: "ch-1",
      content: "已保存正文",
      riskFlags: JSON.stringify({
        qualityLoop: {
          terminalAction: "defer_and_continue",
          recommendedAction: "patch_repair",
          pauseReason: "节奏略散",
        },
      }),
    },
    {
      id: "ch-2",
      content: "已完成正文",
      riskFlags: JSON.stringify({
        qualityLoop: {
          overallStatus: "valid",
          recommendedAction: "continue",
        },
      }),
    },
    {
      id: "ch-3",
      content: "需要重规划",
      riskFlags: JSON.stringify({
        qualityLoop: {
          recommendedAction: "replan",
          rootCauseCode: "replan_required",
        },
      }),
    },
  ];

  assert.equal(resolvePipelineChapterScope("quality_debt"), "quality_debt");
  assert.deepEqual(
    selectPipelineChapters(chapters, "quality_debt").map((chapter) => chapter.id),
    ["ch-1"],
  );
  assert.deepEqual(
    selectPipelineChapters(chapters, "writable").map((chapter) => chapter.id),
    ["ch-1", "ch-2", "ch-3"],
  );
});
