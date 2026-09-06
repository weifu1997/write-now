const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chapterWriterPrompt,
} = require("../dist/prompting/prompts/novel/chapterWriter.prompts.js");
const {
  chapterReviewPrompt,
} = require("../dist/prompting/prompts/novel/review.prompts.js");
const {
  buildChapterWriterContextBlocks,
} = require("../dist/prompting/prompts/novel/context/chapterContextBlocks.js");
const {
  normalizeChapterWriteContext,
} = require("../dist/prompting/prompts/novel/context/chapterContextPolicies.js");
const {
  normalizeReaderExperienceContract,
} = require("../../shared/dist/types/novel/readerExperience.js");

const READER_EXPERIENCE_WITH_COST = {
  readerQuestion: "主角能否抓住反击窗口？",
  promisedReward: "夺回维修通道控制权",
  rewardLevel: "partial",
  protagonistWant: "拿回主动权",
  primaryResistance: "敌方封锁通道",
  keyTurn: "交叉验证锁定漏洞",
  emotionalShift: "从受压到反击",
  informationReveal: "封锁存在缺口",
  netChange: "主角获得反压支点",
  expectedCost: "暴露了内部线人的存在",
  complication: "女二的情报来源被敌方察觉",
  inheritedHookResponsibilities: [],
  endingHook: "敌方开始排查内鬼",
};

function buildPlainWriteContext(readerExperience) {
  return {
    bookContract: {},
    productionFoundationPrompt: "",
    macroConstraints: null,
    volumeWindow: null,
    narrativeProgressHint: null,
    chapterMission: {
      chapterId: "chapter-4",
      chapterOrder: 4,
      title: "第4章 反击",
      objective: "推进反击",
      expectation: "反击落地",
      hookTarget: "留下新钩子",
      mustAdvance: [],
      mustPreserve: [],
      riskNotes: [],
      planRole: "turn",
      targetWordCount: 2000,
    },
    nextAction: "write_chapter",
    chapterStateGoal: null,
    protectedSecrets: [],
    payoffDirectives: [],
    obligationContract: {},
    chapterBoundary: null,
    lengthBudget: null,
    scenePlan: null,
    participants: [],
    characterHardFacts: [],
    characterBehaviorGuides: [],
    activeRelationStages: [],
    pendingCandidateGuards: [],
    localStateSummary: "",
    openConflictSummaries: [],
    ledgerPendingItems: [],
    ledgerUrgentItems: [],
    ledgerOverdueItems: [],
    ledgerSummary: null,
    timelineContext: null,
    characterResourceContext: null,
    recentChapterSummaries: [],
    previousChapterTail: null,
    openingAntiRepeatHint: "",
    styleContract: null,
    styleConstraints: [],
    continuationConstraints: [],
    ragFacts: [],
    completedMilestones: [],
    recentScenePatterns: [],
    styleAnchorPassages: [],
    readerExperience,
  };
}

function renderWriterSystemText() {
  const [systemMessage] = chapterWriterPrompt.render(
    { novelTitle: "测试小说", chapterOrder: 4, chapterTitle: "第 4 章 反击" },
    { blocks: [], slots: undefined },
  );
  return systemMessage.content;
}

function renderReviewSystemText() {
  const [systemMessage] = chapterReviewPrompt.render(
    { novelTitle: "测试小说", chapterTitle: "第 4 章 反击", content: "他推开门。", ragContext: "" },
    { blocks: [] },
  );
  return systemMessage.content;
}

test("reader experience round-trips cost and complication fields", () => {
  const normalized = normalizeReaderExperienceContract(READER_EXPERIENCE_WITH_COST);
  assert.equal(normalized.expectedCost, "暴露了内部线人的存在");
  assert.equal(normalized.complication, "女二的情报来源被敌方察觉");
});

test("legacy reader experience data without new fields normalizes to empty strings", () => {
  const legacy = {
    readerQuestion: "能否反压？",
    promisedReward: "夺回通道",
    rewardLevel: "partial",
    protagonistWant: "主动权",
    primaryResistance: "封锁",
    keyTurn: "发现缺口",
    emotionalShift: "受压到反击",
    informationReveal: "缺口存在",
    netChange: "获得支点",
    inheritedHookResponsibilities: [],
    endingHook: "反扑开始",
  };
  const normalized = normalizeReaderExperienceContract(legacy);
  assert.equal(normalized.expectedCost, "");
  assert.equal(normalized.complication, "");
});

test("reader_experience block renders cost and complication only when present", () => {
  const withCost = buildChapterWriterContextBlocks(buildPlainWriteContext(READER_EXPERIENCE_WITH_COST));
  const block = withCost.find((item) => item.id === "reader_experience");
  assert.ok(block);
  assert.match(block.content, /本章代价（正文须以具体事件呈现，不得只写心理活动）：暴露了内部线人的存在/);
  assert.match(block.content, /本章意外（超出角色既有计划、会改变后续行动的变量）：女二的情报来源被敌方察觉/);

  const withoutCost = buildChapterWriterContextBlocks(buildPlainWriteContext({ ...READER_EXPERIENCE_WITH_COST, expectedCost: "", complication: "" }));
  const plainBlock = withoutCost.find((item) => item.id === "reader_experience");
  assert.ok(plainBlock);
  assert.ok(!plainBlock.content.includes("本章代价"));
  assert.ok(!plainBlock.content.includes("本章意外"));
});

test("compatible fallback leaves cost and complication empty instead of inventing values", () => {
  const normalized = normalizeChapterWriteContext(buildPlainWriteContext({}));
  assert.equal(normalized.readerExperience.expectedCost, "");
  assert.equal(normalized.readerExperience.complication, "");
});

test("writer v8 requires visible fulfillment of cost and complication when present", () => {
  assert.equal(chapterWriterPrompt.version, "v8");
  const systemText = renderWriterSystemText();
  assert.ok(systemText.includes("1a-1. reader_experience 给出本章代价（expectedCost）或意外（complication）时"));
  assert.ok(systemText.includes("两者都缺省的缓冲章不强行插入"));
});

test("review v4 checks organic fulfillment and tolerates buffer chapters", () => {
  assert.equal(chapterReviewPrompt.version, "v4");
  const systemText = renderReviewSystemText();
  assert.ok(systemText.includes("代价与意外兑现"));
  assert.ok(systemText.includes("两者缺省的缓冲章不算缺陷"));
});
