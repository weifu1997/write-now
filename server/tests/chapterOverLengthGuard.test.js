const test = require("node:test");
const assert = require("node:assert/strict");

const promptRunner = require("../dist/prompting/core/promptRunner.js");
const promptContextResolution = require("../dist/prompting/context/promptContextResolution.js");
const { createContextBlock } = require("../dist/prompting/core/contextBudget.js");
const { selectContextBlocks } = require("../dist/prompting/core/contextSelection.js");
const { prisma } = require("../dist/db/prisma.js");
const { ChapterWritingGraph } = require("../dist/services/novel/chapterWritingGraph.js");

const TARGET = 2800;
const HARD_MAX = 3500;
const SOFT_MIN = 2380;

function buildWriteContext() {
  return {
    bookContract: {
      readingPromise: "",
      protagonistFantasy: "",
      coreSellingPoint: "",
      sellingPoint: "",
      chapter3Payoff: "",
      chapter10Payoff: "",
      chapter30Payoff: "",
      escalationLadder: "",
      relationshipMainline: "",
      activeMilestonePayoffs: [],
    },
    productionFoundationPrompt: null,
    macroConstraints: null,
    volumeWindow: null,
    narrativeProgressHint: null,
    nextAction: "write_chapter",
    chapterStateGoal: null,
    protectedSecrets: [],
    payoffDirectives: [],
    obligationContract: {
      mustHitNow: [],
      mustPreserve: [],
      requiredPayoffTouches: [],
      requiredCharacterAppearances: [],
      requiredGoalChanges: [],
      canDefer: [],
      forbiddenCrossings: [],
    },
    chapterBoundary: null,
    lengthBudget: {
      targetWordCount: TARGET,
      softMinWordCount: SOFT_MIN,
      softMaxWordCount: 3220,
      hardMaxWordCount: HARD_MAX,
    },
    scenePlan: null,
    readerExperience: null,
    participants: [],
    characterBehaviorGuides: [],
    characterHardFacts: [],
    activeRelationStages: [],
    pendingCandidateGuards: [],
    localStateSummary: "",
    openConflictSummaries: [],
    ledgerPendingItems: [],
    ledgerUrgentItems: [],
    ledgerOverdueItems: [],
    ledgerSummary: null,
    timelineContext: null,
    previousChapterTail: null,
    recentChapterSummaries: [],
    openingAntiRepeatHint: "",
    styleContract: null,
    styleConstraints: [],
    ragFacts: [],
    recentScenePatterns: [],
    continuationConstraints: [],
    styleAnchorPassages: [],
    characterResourceContext: null,
    completedMilestones: [],
    chapterMission: {
      chapterId: "chapter-1",
      chapterOrder: 1,
      title: "第一章",
      objective: "推进本章任务",
      expectation: "完成关键事件",
      taskSheet: null,
      targetWordCount: TARGET,
      planRole: null,
      hookTarget: null,
      mustAdvance: [],
      mustPreserve: [],
      riskNotes: [],
    },
  };
}

function buildContextPackage() {
  return {
    chapter: {
      id: "chapter-1",
      title: "第一章",
      order: 1,
      content: null,
      expectation: null,
      targetWordCount: TARGET,
      conflictLevel: null,
      revealLevel: null,
      mustAvoid: null,
      taskSheet: null,
      sceneCards: null,
      hook: null,
    },
    chapterWriteContext: buildWriteContext(),
    continuation: {
      enabled: false,
      sourceType: "none",
      sourceId: null,
      sourceTitle: null,
      systemRule: "",
      humanBlock: "",
      antiCopyCorpus: [],
    },
    ragContext: "",
  };
}

function createGraph(saved) {
  return new ChapterWritingGraph({
    enforceOpeningDiversity: async (_novelId, _order, _title, content) => ({
      content,
      rewritten: false,
      maxSimilarity: 0,
    }),
    saveDraftAndArtifacts: async (_novelId, _chapterId, content, generationState) => {
      saved.push({ content, generationState });
    },
    logInfo: () => {},
    logWarn: () => {},
  });
}

function stubPromptRunner({ draft, textOutputs, novelRow = null }) {
  const runTextCalls = [];
  const originalStreamTextPrompt = promptRunner.streamTextPrompt;
  const originalRunTextPrompt = promptRunner.runTextPrompt;
  const originalResolveBlocks = promptContextResolution.resolvePromptContextBlocksForAsset;
  const originalFindUnique = prisma.novel.findUnique;

  promptRunner.streamTextPrompt = async () => ({
    stream: (async function* generate() {
      yield { content: "" };
    })(),
    complete: Promise.resolve({ output: draft }),
  });
  promptRunner.runTextPrompt = async (input) => {
    runTextCalls.push(input);
    return { output: textOutputs[runTextCalls.length - 1] ?? "" };
  };
  promptContextResolution.resolvePromptContextBlocksForAsset = async (input) => ({
    blocks: input.fallbackBlocks ?? [],
    brokerResolution: { blocks: [], decisions: [] },
  });
  prisma.novel.findUnique = async () => novelRow;

  return {
    runTextCalls,
    restore() {
      promptRunner.streamTextPrompt = originalStreamTextPrompt;
      promptRunner.runTextPrompt = originalRunTextPrompt;
      promptContextResolution.resolvePromptContextBlocksForAsset = originalResolveBlocks;
      prisma.novel.findUnique = originalFindUnique;
    },
  };
}

async function runDraft(graph, contextPackage, fullContent) {
  const { stream, onDone } = await graph.createChapterStream({
    novelId: "novel-1",
    novelTitle: "测试小说",
    chapter: { id: "chapter-1", title: "第一章", order: 1, targetWordCount: TARGET },
    contextPackage,
    options: {},
  });
  for await (const _chunk of stream) {
    void _chunk;
  }
  await onDone(fullContent);
}

test("condenses over-length draft once and saves the condensed content", async () => {
  const draft = "长".repeat(4000);
  const condensed = "短".repeat(2800);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [condensed] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(saved.length, 1);
    assert.equal(saved[0].generationState, "drafted");
    assert.equal(saved[0].content, condensed);
    assert.equal(stub.runTextCalls.length, 1);
  } finally {
    stub.restore();
  }
});

test("over-length condense call uses condense mode and writer_condense stage", async () => {
  const draft = "长".repeat(4000);
  const condensed = "短".repeat(2800);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [condensed] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(stub.runTextCalls.length, 1);
    assert.equal(stub.runTextCalls[0].promptInput.mode, "condense");
    assert.equal(stub.runTextCalls[0].options.stage, "writer_condense");
    assert.equal(stub.runTextCalls[0].options.triggerReason, "length_condense");
    assert.equal(stub.runTextCalls[0].promptInput.targetWordCount, TARGET);
    assert.equal(stub.runTextCalls[0].promptInput.maxWordCount, 3220);
  } finally {
    stub.restore();
  }
});

test("keeps draft untouched when length stays within hard max", async () => {
  const draft = "正".repeat(3000);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(stub.runTextCalls.length, 0);
    assert.equal(saved[0].content, draft);
  } finally {
    stub.restore();
  }
});

test("falls back to original draft when condense output is empty", async () => {
  const draft = "长".repeat(4000);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [""] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(saved[0].content, draft);
  } finally {
    stub.restore();
  }
});

test("keeps original draft when condense output is not shorter", async () => {
  const draft = "长".repeat(4000);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: ["长".repeat(4200)] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(saved[0].content, draft);
  } finally {
    stub.restore();
  }
});

test("condense call keeps the full draft block and disables summarization", async () => {
  const draft = "长".repeat(4000);
  const condensed = "短".repeat(2800);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [condensed] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(stub.runTextCalls.length, 1);
    const draftBlock = stub.runTextCalls[0].contextBlocks.find((block) => block.id === "current_draft_full");
    assert.ok(draftBlock);
    assert.equal(draftBlock.allowSummary, false);
    assert.equal(draftBlock.required, true);
    assert.match(draftBlock.content, new RegExp(`Full draft \\(condense this\\):\\n${draft}`));
    assert.equal(stub.runTextCalls[0].asset.contextPolicy.maxTokensBudget, 8000);
    assert.ok(stub.runTextCalls[0].asset.contextPolicy.requiredGroups.includes("current_draft_full"));
  } finally {
    stub.restore();
  }
});

test("extends condensed draft when compression cuts below soft min", async () => {
  const draft = "长".repeat(4000);
  const overCondensed = "短".repeat(2000);
  const appended = "补".repeat(800);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [overCondensed, appended] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(stub.runTextCalls.length, 2);
    assert.equal(stub.runTextCalls[0].promptInput.mode, "condense");
    assert.equal(stub.runTextCalls[1].promptInput.mode, "continue");
    assert.equal(stub.runTextCalls[1].promptInput.missingWordGap, 800);
    assert.equal(saved[0].content, `${overCondensed}\n\n${appended}`);
  } finally {
    stub.restore();
  }
});

test("recondenses after continue when the merged draft exceeds hard max", async () => {
  const draft = "短".repeat(2000);
  const appended = "补".repeat(2000);
  const recompressed = "压".repeat(2800);
  const saved = [];
  const graph = createGraph(saved);
  const stub = stubPromptRunner({ draft, textOutputs: [appended, recompressed] });

  try {
    await runDraft(graph, buildContextPackage(), draft);

    assert.equal(stub.runTextCalls.length, 2);
    assert.equal(stub.runTextCalls[0].promptInput.mode, "continue");
    assert.equal(stub.runTextCalls[1].promptInput.mode, "condense");
    assert.equal(saved[0].content, recompressed);
    assert.ok(saved[0].content.replace(/\s+/g, "").length <= HARD_MAX);
  } finally {
    stub.restore();
  }
});

test("uses book default chapter length when chapter target is missing", async () => {
  const draft = "正".repeat(3000);
  const saved = [];
  const graph = createGraph(saved);
  const contextPackage = buildContextPackage();
  contextPackage.chapter.targetWordCount = null;
  contextPackage.chapterWriteContext.chapterMission.targetWordCount = null;
  contextPackage.chapterWriteContext.lengthBudget = null;
  const stub = stubPromptRunner({
    draft,
    textOutputs: [],
    novelRow: { defaultChapterLength: 2800, writingPlatformSnapshotJson: null },
  });

  try {
    const { stream, onDone } = await graph.createChapterStream({
      novelId: "novel-1",
      novelTitle: "测试小说",
      chapter: { id: "chapter-1", title: "第一章", order: 1, targetWordCount: null },
      contextPackage,
      options: {},
    });
    for await (const _chunk of stream) {
      void _chunk;
    }
    await onDone(draft);
    assert.equal(saved[0].content, draft);
    assert.equal(stub.runTextCalls.length, 0);
  } finally {
    stub.restore();
  }
});

test("condense draft block is not summarized when allowSummary is false", () => {
  const draft = "长".repeat(4000);
  const draftBlock = createContextBlock({
    id: "current_draft_full",
    group: "current_draft_full",
    priority: 106,
    required: true,
    allowSummary: false,
    content: ["Full draft (condense this):", draft].join("\n"),
  });
  const missionBlock = createContextBlock({
    id: "chapter_mission",
    group: "chapter_mission",
    priority: 100,
    required: true,
    content: "本章职责：完成会签。",
  });
  const tightBudgetSelection = selectContextBlocks([draftBlock, missionBlock], {
    maxTokensBudget: 2600,
    requiredGroups: ["current_draft_full", "chapter_mission"],
  });
  const condenseBudgetSelection = selectContextBlocks([draftBlock, missionBlock], {
    maxTokensBudget: 8000,
    requiredGroups: ["current_draft_full", "chapter_mission"],
  });

  assert.equal(tightBudgetSelection.summarizedBlockIds.includes("current_draft_full"), false);
  const selectedDraft = tightBudgetSelection.selectedBlocks.find((block) => block.id === "current_draft_full");
  assert.ok(selectedDraft);
  assert.equal(selectedDraft.content.includes(draft), true);
  assert.equal(selectedDraft.content.includes("[context summarized]"), false);
  assert.equal(condenseBudgetSelection.droppedBlockIds.includes("current_draft_full"), false);
  assert.equal(condenseBudgetSelection.summarizedBlockIds.includes("current_draft_full"), false);
});
