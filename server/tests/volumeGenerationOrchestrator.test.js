const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveFixedRecommendedVolumeCount,
  resolveBeatSheetTargetChapterCount,
} = require("../dist/services/novel/volume/volumeGenerationOrchestrator.js");
const {
  isCompactBookFinaleBeat,
  isBookFinaleBeat,
  isClosingVolume,
} = require("../dist/services/novel/volume/volumeChapterListGeneration.js");
const {
  allocateChapterBudgets,
} = require("../dist/services/novel/volume/volumeGenerationHelpers.js");

function createVolume(id, chapterCount) {
  return {
    id,
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      id: `${id}-chapter-${index + 1}`,
    })),
  };
}

test("chapter budgets ignore incomplete prefix-only generated chapters", () => {
  const budgets = allocateChapterBudgets({
    volumeCount: 8,
    chapterBudget: 430,
    existingVolumes: [
      createVolume("volume-1", 53),
      createVolume("volume-2", 0),
      createVolume("volume-3", 0),
      createVolume("volume-4", 0),
      createVolume("volume-5", 0),
      createVolume("volume-6", 0),
      createVolume("volume-7", 0),
      createVolume("volume-8", 0),
    ],
  });

  assert.equal(budgets.reduce((sum, count) => sum + count, 0), 430);
  assert.ok(budgets[1] >= 40, `expected second volume budget to stay usable, got ${budgets[1]}`);
  assert.ok(budgets[1] <= 60, `expected second volume budget near an even split, got ${budgets[1]}`);
});

test("volume strategy fixed count respects explicit user count before existing draft count", () => {
  assert.equal(resolveFixedRecommendedVolumeCount({
    userPreferredVolumeCount: 6,
    respectedExistingVolumeCount: 3,
  }), 6);
});

test("volume strategy fixed count locks respected existing draft count", () => {
  assert.equal(resolveFixedRecommendedVolumeCount({
    userPreferredVolumeCount: null,
    respectedExistingVolumeCount: 2,
  }), 2);
});

test("volume strategy fixed count stays open without user or existing draft count", () => {
  assert.equal(resolveFixedRecommendedVolumeCount({
    userPreferredVolumeCount: null,
    respectedExistingVolumeCount: null,
  }), null);
});

test("beat sheet target chapter count is not shrunk by partial seed chapters", () => {
  const targetChapterCount = resolveBeatSheetTargetChapterCount({
    targetVolumeChapterCount: 10,
    targetVolumeIndex: 0,
    volumeCount: 8,
    chapterBudget: 430,
    chapterBudgets: [54, 54, 54, 54, 54, 54, 53, 53],
  });

  assert.equal(targetChapterCount, 54);
});

test("beat sheet target chapter count still preserves a larger existing volume", () => {
  const targetChapterCount = resolveBeatSheetTargetChapterCount({
    targetVolumeChapterCount: 70,
    targetVolumeIndex: 0,
    volumeCount: 8,
    chapterBudget: 430,
    chapterBudgets: [54, 54, 54, 54, 54, 54, 53, 53],
  });

  assert.equal(targetChapterCount, 70);
});

test("compact-book finale detection uses the whole-book chapter order across volumes", () => {
  const completionProfile = {
    mode: "compact_book",
    endingRequiredBy: 30,
  };
  const chapterBudgets = [10, 10, 10];

  assert.equal(isCompactBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 0,
    chapterBudgets,
    beatChapterEndOrder: 10,
  }), false);
  assert.equal(isCompactBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 1,
    chapterBudgets,
    beatChapterEndOrder: 10,
  }), false);
  assert.equal(isCompactBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 2,
    chapterBudgets,
    beatChapterEndOrder: 10,
  }), true);
});

test("serial target-span finale uses whole-book order and does not treat a mid-volume local order as finale", () => {
  const completionProfile = {
    mode: "serial_book",
    targetChapterCount: 150,
    maxChapterCount: 150,
    promiseScope: "first_30_chapters",
    structure: "serial_staged",
    endingRequiredBy: 150,
  };
  const chapterBudgets = [40, 40, 40, 30];

  assert.equal(isBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 0,
    chapterBudgets,
    beatChapterEndOrder: 40,
  }), false);
  assert.equal(isBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 3,
    chapterBudgets,
    beatChapterEndOrder: 10,
  }), false);
  assert.equal(isBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 3,
    chapterBudgets,
    beatChapterEndOrder: 30,
  }), true);
  assert.equal(isCompactBookFinaleBeat({
    completionProfile,
    targetVolumeIndex: 3,
    chapterBudgets,
    beatChapterEndOrder: 30,
  }), false);
  assert.equal(isClosingVolume({
    completionProfile,
    targetVolumeIndex: 2,
    volumeCount: 4,
    chapterBudgets,
  }), false);
  assert.equal(isClosingVolume({
    completionProfile,
    targetVolumeIndex: 3,
    volumeCount: 4,
    chapterBudgets,
  }), true);
});

test("61-chapter serial last beat is finale while compact 60 stays compact-only", () => {
  const serial = {
    mode: "serial_book",
    endingRequiredBy: 61,
  };
  const compact = {
    mode: "compact_book",
    endingRequiredBy: 60,
  };
  assert.equal(isBookFinaleBeat({
    completionProfile: serial,
    targetVolumeIndex: 1,
    chapterBudgets: [30, 31],
    beatChapterEndOrder: 31,
  }), true);
  assert.equal(isBookFinaleBeat({
    completionProfile: serial,
    targetVolumeIndex: 1,
    chapterBudgets: [30, 31],
    beatChapterEndOrder: 20,
  }), false);
  assert.equal(isCompactBookFinaleBeat({
    completionProfile: compact,
    targetVolumeIndex: 2,
    chapterBudgets: [20, 20, 20],
    beatChapterEndOrder: 20,
  }), true);
});
