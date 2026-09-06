const test = require("node:test");
const assert = require("node:assert/strict");

const {
  allocateChapterBudgets,
  resolveVolumePlannedChapterBudget,
} = require("../dist/services/novel/volume/volumeChapterBudgetAllocation.js");
const {
  resolveTargetChapterCount,
} = require("../dist/services/novel/volume/volumeBeatSheetChapterBudget.js");
const {
  resolveBeatSheetTargetChapterCount,
} = require("../dist/services/novel/volume/volumeBeatSheetGeneration.js");

function createVolume(id, chapterCount) {
  return {
    id,
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      id: `${id}-chapter-${index + 1}`,
    })),
  };
}

test("rolling tail volume keeps its beat sheet span trusted instead of collapsing to progress", () => {
  const existingVolumes = [
    createVolume("volume-1", 38),
    createVolume("volume-2", 38),
    createVolume("volume-3", 37),
    createVolume("volume-4", 4),
  ];
  const chapterBudget = 150;
  const chapterBudgets = allocateChapterBudgets({
    volumeCount: 4,
    chapterBudget,
    existingVolumes,
  });
  assert.deepEqual(chapterBudgets, [49, 49, 47, 5]);

  const plannedBudget = resolveVolumePlannedChapterBudget({
    chapterBudget,
    chapterBudgets,
    targetVolumeIndex: 3,
    volumeCount: 4,
  });
  assert.equal(plannedBudget, 37);

  const resolved = resolveTargetChapterCount({
    budgetedChapterCount: Math.max(existingVolumes[3].chapters.length, plannedBudget),
    beatSheetRequiredChapterCount: 37,
  });
  assert.equal(resolved.beatSheetCountAccepted, true);
  assert.equal(resolved.targetChapterCount, 37);
});

test("rolling tail volume beat sheet regeneration targets the planned scale, not progress", () => {
  const targetChapterCount = resolveBeatSheetTargetChapterCount({
    targetVolumeChapterCount: 4,
    targetVolumeIndex: 3,
    volumeCount: 4,
    chapterBudget: 150,
    chapterBudgets: [49, 49, 47, 5],
  });
  assert.equal(targetChapterCount, 37);
});

test("whole-book absolute numbering in a beat sheet is still rejected", () => {
  const plannedBudget = resolveVolumePlannedChapterBudget({
    chapterBudget: 150,
    chapterBudgets: [49, 49, 47, 5],
    targetVolumeIndex: 1,
    volumeCount: 4,
  });
  assert.equal(plannedBudget, 49);

  const resolved = resolveTargetChapterCount({
    budgetedChapterCount: Math.max(38, plannedBudget),
    beatSheetRequiredChapterCount: 76,
  });
  assert.equal(resolved.beatSheetCountAccepted, false);
});

test("completed volume planned budget stays on the weighted allocation", () => {
  const plannedBudget = resolveVolumePlannedChapterBudget({
    chapterBudget: 150,
    chapterBudgets: [49, 49, 47, 5],
    targetVolumeIndex: 0,
    volumeCount: 4,
  });
  assert.equal(plannedBudget, 49);
});

test("skeleton-extended future volumes keep the in-progress volume trusted", () => {
  const existingVolumes = [
    createVolume("volume-1", 38),
    createVolume("volume-2", 38),
    createVolume("volume-3", 37),
    createVolume("volume-4", 4),
    createVolume("volume-5", 0),
    createVolume("volume-6", 0),
  ];
  const chapterBudgets = allocateChapterBudgets({
    volumeCount: 6,
    chapterBudget: 150,
    existingVolumes,
  });
  assert.deepEqual(chapterBudgets, [25, 25, 25, 25, 25, 25]);

  const plannedBudget = resolveVolumePlannedChapterBudget({
    chapterBudget: 150,
    chapterBudgets,
    targetVolumeIndex: 3,
    volumeCount: 6,
  });
  assert.equal(plannedBudget, 25);

  const resolved = resolveTargetChapterCount({
    budgetedChapterCount: Math.max(existingVolumes[3].chapters.length, plannedBudget),
    beatSheetRequiredChapterCount: 25,
  });
  assert.equal(resolved.beatSheetCountAccepted, true);
});
