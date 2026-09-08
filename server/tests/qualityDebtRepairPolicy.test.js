const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isQualityDebtRepairScope,
  resolveQualityDebtRepairMode,
  shouldSkipAutomaticRepair,
} = require("../dist/services/novel/production/qualityDebtRepairPolicy.js");

test("quality-debt scope is only the explicit repair batch", () => {
  assert.equal(isQualityDebtRepairScope("quality_debt"), true);
  assert.equal(isQualityDebtRepairScope("writable"), false);
  assert.equal(isQualityDebtRepairScope(undefined), false);
});

test("writable pause and manual review still skip automatic repair", () => {
  assert.equal(shouldSkipAutomaticRepair({
    chapterScope: "writable",
    autoRepair: true,
    repairMode: "light_repair",
    attempt: 0,
    repairAttemptBudget: 1,
    continuePolicy: "pause",
    acceptanceStatus: "needs_manual_review",
    repairability: "rewrite_needed",
  }), true);
});

test("quality-debt batch still repairs paused unreadable chapters", () => {
  assert.equal(shouldSkipAutomaticRepair({
    chapterScope: "quality_debt",
    autoRepair: true,
    repairMode: "light_repair",
    attempt: 0,
    repairAttemptBudget: 1,
    continuePolicy: "pause",
    acceptanceStatus: "needs_manual_review",
    repairability: "rewrite_needed",
  }), false);
});

test("quality-debt batch does not rewrite plan misalignment", () => {
  assert.equal(shouldSkipAutomaticRepair({
    chapterScope: "quality_debt",
    autoRepair: true,
    repairMode: "light_repair",
    attempt: 0,
    repairAttemptBudget: 1,
    continuePolicy: "pause",
    acceptanceStatus: "needs_manual_review",
    repairability: "plan_misalignment",
  }), true);
});

test("disabled repair and exhausted budget keep original skip rules", () => {
  assert.equal(shouldSkipAutomaticRepair({
    autoRepair: false,
    repairMode: "light_repair",
    attempt: 0,
    repairAttemptBudget: 1,
  }), true);
  assert.equal(shouldSkipAutomaticRepair({
    autoRepair: true,
    repairMode: "detect_only",
    attempt: 0,
    repairAttemptBudget: 1,
  }), true);
  assert.equal(shouldSkipAutomaticRepair({
    chapterScope: "quality_debt",
    autoRepair: true,
    repairMode: "light_repair",
    attempt: 1,
    repairAttemptBudget: 1,
    continuePolicy: "repair_once",
    acceptanceStatus: "repairable",
  }), true);
});

test("only the quality-debt batch upgrades to heavy repair from structured acceptance", () => {
  assert.equal(resolveQualityDebtRepairMode({
    chapterScope: "writable",
    requestedMode: "light_repair",
    repairability: "rewrite_needed",
    acceptanceStatus: "needs_manual_review",
    repairDirectives: [{ mode: "rewrite" }],
  }), "light_repair");

  assert.equal(resolveQualityDebtRepairMode({
    chapterScope: "quality_debt",
    requestedMode: "light_repair",
    repairability: "rewrite_needed",
    acceptanceStatus: "repairable",
  }), "heavy_repair");

  assert.equal(resolveQualityDebtRepairMode({
    chapterScope: "quality_debt",
    requestedMode: "light_repair",
    acceptanceStatus: "needs_manual_review",
  }), "heavy_repair");

  assert.equal(resolveQualityDebtRepairMode({
    chapterScope: "quality_debt",
    requestedMode: "light_repair",
    repairability: "patchable_obligation_gap",
    acceptanceStatus: "repairable",
    repairDirectives: [{ mode: "patch" }],
  }), "light_repair");

  assert.equal(resolveQualityDebtRepairMode({
    chapterScope: "quality_debt",
    requestedMode: "light_repair",
    repairability: "plan_misalignment",
    acceptanceStatus: "needs_manual_review",
  }), "light_repair");
});
