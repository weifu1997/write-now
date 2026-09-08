const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createVolumeChapterListPrompt,
} = require("../dist/prompting/prompts/novel/volume/chapterList.prompts.js");

function buildChapter(title, summary, conflictLevel, engineType) {
  return {
    title,
    summary,
    beatKey: "target_beat",
    conflictLevel,
    engineType,
  };
}

test("chapter list postValidate rejects consecutive identical engineType", () => {
  const prompt = createVolumeChapterListPrompt(3);
  assert.throws(
    () => prompt.postValidate({
      beatKey: "target_beat",
      beatLabel: "目标节奏段",
      chapterCount: 3,
      chapters: [
        buildChapter("夜探仓房", "主角决定潜入仓房查清失踪货单。", 30, "probe"),
        buildChapter("再探内库", "主角继续试探内库守卫并核对货单缺口。", 55, "probe"),
        buildChapter("三探密道", "主角再次选择深入密道确认货单去向。", 80, "probe"),
      ],
    }),
    /同一玩法引擎/,
  );
});

test("chapter list postValidate accepts chapters when engineType rotates", () => {
  const prompt = createVolumeChapterListPrompt(3);
  const output = prompt.postValidate({
    beatKey: "target_beat",
    beatLabel: "目标节奏段",
    chapterCount: 3,
    chapters: [
      buildChapter("夜探仓房", "主角决定潜入仓房查清失踪货单。", 30, "probe"),
      buildChapter("当堂对质", "主角公开对质管事，逼出反制与关系裂变。", 58, "confrontation"),
      buildChapter("交换人质", "双方交换人质承担代价，局面转向兑现。", 82, "bargain"),
    ],
  });
  assert.equal(output.chapters.length, 3);
  assert.deepEqual(
    output.chapters.map((chapter) => chapter.engineType),
    ["probe", "confrontation", "bargain"],
  );
});
