const test = require("node:test");
const assert = require("node:assert/strict");

const { chapterWriterPrompt } = require("../dist/prompting/prompts/novel/chapterWriter.prompts.js");
const {
  buildChapterWriterContextBlocks,
} = require("../dist/prompting/prompts/novel/context/chapterContextBlocks.js");
const {
  normalizeChapterWriteContext,
} = require("../dist/prompting/prompts/novel/context/chapterContextPolicies.js");

const ANCHORS = [
  { order: 2, title: "旧巷", text: "他数到第三声，门才开。", source: "adopted", forbiddenEntities: [] },
  {
    order: null,
    title: null,
    text: "雨停在屋檐下，没人先说话。",
    source: "source_book",
    forbiddenEntities: ["曹国栋", "北境"],
  },
];

function buildPlainWriteContext(styleAnchorPassages) {
  return {
    bookContract: {},
    productionFoundationPrompt: "",
    macroConstraints: null,
    volumeWindow: null,
    narrativeProgressHint: null,
    chapterMission: {
      chapterId: "chapter-3",
      chapterOrder: 3,
      title: "第3章 反击",
      objective: "推进反击",
      expectation: "反击落地",
      hookTarget: "留下新钩子",
      mustAdvance: [],
      mustPreserve: [],
      riskNotes: [],
      planRole: "advance",
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
    styleAnchorPassages,
  };
}

function renderWriterSystemText() {
  const [systemMessage] = chapterWriterPrompt.render(
    {
      novelTitle: "测试小说",
      chapterOrder: 3,
      chapterTitle: "第 3 章 反击",
    },
    { blocks: [], slots: undefined },
  );
  return systemMessage.content;
}

test("writer v8 carries style anchor guidance in system prompt", () => {
  assert.equal(chapterWriterPrompt.version, "v8");
  const systemText = renderWriterSystemText();
  assert.ok(systemText.includes("范文锚点"));
  assert.ok(systemText.includes("禁止照抄其中的具体情节、人物、地名、组织名"));
});

test("normalizeChapterWriteContext defaults style anchor passages to empty array", () => {
  const normalized = normalizeChapterWriteContext(buildPlainWriteContext(undefined));
  assert.deepEqual(normalized.styleAnchorPassages, []);
});

test("style anchor passages render as a dedicated block only when present", () => {
  const withAnchors = buildChapterWriterContextBlocks(buildPlainWriteContext(ANCHORS));
  const anchorBlock = withAnchors.find((block) => block.id === "style_anchor_passages");
  assert.ok(anchorBlock, "style_anchor_passages block should exist when passages are present");
  assert.equal(anchorBlock.group, "style_anchor_passages");
  assert.equal(anchorBlock.priority, 60);
  assert.match(anchorBlock.content, /范文1（第2章 旧巷）/);
  assert.match(anchorBlock.content, /范文2（拆书源文本样本）/);
  assert.match(anchorBlock.content, /禁止照抄范文中的具体情节/);
  assert.match(anchorBlock.content, /曹国栋、北境/);

  const withoutAnchors = buildChapterWriterContextBlocks(buildPlainWriteContext([]));
  assert.ok(
    !withoutAnchors.some((block) => block.id === "style_anchor_passages"),
    "style_anchor_passages block should be dropped when there are no passages",
  );
});
