const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createVolumeChapterListPrompt,
} = require("../dist/prompting/prompts/novel/volume/chapterList.prompts.js");

function buildChapter(title, summary, conflictLevel) {
  return {
    title,
    summary,
    beatKey: "target_beat",
    conflictLevel,
  };
}

test("chapter list postValidate rejects consecutive audit-engine chapters", () => {
  const prompt = createVolumeChapterListPrompt(3);
  assert.throws(
    () => prompt.postValidate({
      beatKey: "target_beat",
      beatLabel: "目标节奏段",
      chapterCount: 3,
      chapters: [
        buildChapter("度支穿账", "陆衡清查假账并扣押度支印令。", 30),
        buildChapter("承兑封门", "承兑台挤兑，查封坏账窗口继续加压。", 55),
        buildChapter("接管清算", "接管内库账册，完成清算催收。", 80),
      ],
    }),
    /同一套收网引擎/,
  );
});

test("chapter list postValidate accepts audit chapters when engines diversify", () => {
  const prompt = createVolumeChapterListPrompt(3);
  const output = prompt.postValidate({
    beatKey: "target_beat",
    beatLabel: "目标节奏段",
    chapterCount: 3,
    chapters: [
      buildChapter("度支穿账", "陆衡清查假账并扣押度支印令。", 30),
      buildChapter("当堂对质", "楚疏影公开对质长老，关系裂变逼出反制。", 58),
      buildChapter("误伤兑换", "误伤代价迫使双方交换人质，局面转向。", 82),
    ],
  });
  assert.equal(output.chapters.length, 3);
});
