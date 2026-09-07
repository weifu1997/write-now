const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GenerationDecisionEngine,
} = require("../dist/services/novel/production/GenerationDecisionEngine.js");

function createSnapshot(overrides = {}) {
  const { narrative: narrativeOverrides, ...snapshotOverrides } = overrides;
  return {
    novelId: "novel-1",
    sourceSnapshotId: "snapshot-1",
    scopeLabel: "chapter:5",
    bookContract: {
      title: "Test Novel",
      genre: "urban",
      targetAudience: null,
      sellingPoint: null,
      first30ChapterPromise: null,
      readingPromise: null,
      protagonistFantasy: null,
      coreSellingPoint: null,
      chapter3Payoff: null,
      chapter10Payoff: null,
      chapter30Payoff: null,
      escalationLadder: null,
      relationshipMainline: null,
      toneGuardrails: [],
      hardConstraints: [],
    },
    worldState: null,
    characters: [{
      characterId: "char-1",
      name: "Hero",
      role: "lead",
      currentGoal: "win ground",
      currentState: "under pressure",
      currentPressure: null,
      currentSecret: null,
      emotion: null,
      knownFacts: [],
      relationStageLabels: [],
      summary: null,
      lastEventSummary: null,
    }],
    narrative: {
      currentVolumeId: "volume-1",
      currentVolumeTitle: "Counterattack",
      currentChapterId: "chapter-5",
      currentChapterOrder: 5,
      currentChapterGoal: "push the visible gain",
      currentPhase: "chapter_progression",
      openConflicts: [],
      pendingPayoffs: [],
      urgentPayoffs: [],
      overduePayoffs: [],
      publicKnowledge: [],
      hiddenKnowledge: [],
      suspenseThreads: [],
      ...narrativeOverrides,
    },
    timeline: [],
    createdAt: new Date().toISOString(),
    ...snapshotOverrides,
  };
}

test("GenerationDecisionEngine prefers review hold when pending proposals exist", () => {
  const engine = new GenerationDecisionEngine();
  const action = engine.decideNextAction({
    snapshot: createSnapshot(),
    pendingReviewProposalCount: 2,
    hasRepairableDraft: true,
  });
  assert.equal(action, "hold_for_review");
});

test("GenerationDecisionEngine repairs existing draft issues before holding for proposal review", () => {
  const engine = new GenerationDecisionEngine();
  const action = engine.decideNextAction({
    snapshot: createSnapshot(),
    pendingReviewProposalCount: 2,
    openAuditIssueCount: 1,
    hasRepairableDraft: true,
  });
  assert.equal(action, "repair_existing_chapter");
});

test("GenerationDecisionEngine auto-repairs pending proposals during full-book autopilot", () => {
  const engine = new GenerationDecisionEngine();
  const action = engine.decideNextAction({
    snapshot: createSnapshot(),
    policy: {
      kickoffMode: "director_start",
      advanceMode: "full_book_autopilot",
      reviewCheckpoints: [],
    },
    pendingReviewProposalCount: 2,
    hasRepairableDraft: true,
  });
  assert.equal(action, "repair_existing_chapter");
});

test("GenerationDecisionEngine keeps writing when pending proposals belong to a blank chapter", () => {
  const engine = new GenerationDecisionEngine();
  const action = engine.decideNextAction({
    snapshot: createSnapshot(),
    pendingReviewProposalCount: 2,
    hasRepairableDraft: false,
  });
  assert.equal(action, "write_chapter");
});

function createOverduePayoff() {
  return {
    id: "payoff-1",
    ledgerKey: "payoff-1",
    title: "first counterattack",
    summary: "still not paid off",
    scopeType: "chapter",
    currentStatus: "overdue",
    targetStartChapterOrder: 4,
    targetEndChapterOrder: 5,
    firstSeenChapterOrder: 2,
    lastTouchedChapterOrder: 4,
    lastTouchedChapterId: "chapter-4",
    setupChapterId: "chapter-2",
    payoffChapterId: null,
    statusReason: "reader payoff overdue",
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("GenerationDecisionEngine keeps writing when only overdue payoffs remain", () => {
  const engine = new GenerationDecisionEngine();
  const action = engine.decideNextAction({
    snapshot: createSnapshot({
      narrative: {
        overduePayoffs: [createOverduePayoff()],
      },
    }),
  });
  assert.equal(action, "write_chapter");
});

test("GenerationDecisionEngine does not hold stage review solely for overdue payoffs", () => {
  const engine = new GenerationDecisionEngine();
  const action = engine.decideNextAction({
    snapshot: createSnapshot({
      narrative: {
        overduePayoffs: [createOverduePayoff()],
      },
    }),
    policy: {
      kickoffMode: "director_start",
      advanceMode: "stage_review",
      reviewCheckpoints: [],
    },
  });
  assert.equal(action, "write_chapter");
});
