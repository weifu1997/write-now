const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFailureClassification,
  buildRuntimePackage,
} = require("../dist/services/novel/runtime/chapterRuntimePackageBuilders.js");

function createAcceptance(repairability = "none") {
  return {
    repairability,
    decisionReason: "章节验收结构化判断。",
  };
}

test("buildFailureClassification keeps local quality issues out of replan_required", () => {
  const classification = buildFailureClassification({
    acceptance: createAcceptance(),
    hasBlockingIssues: true,
    replanRecommended: false,
    missingObligations: [],
  });

  assert.equal(classification.code, "draft_repair_exhausted");
});

test("buildFailureClassification preserves explicit plan misalignment as replan_required", () => {
  const classification = buildFailureClassification({
    acceptance: createAcceptance("plan_misalignment"),
    hasBlockingIssues: false,
    replanRecommended: false,
    missingObligations: [],
  });

  assert.equal(classification.code, "replan_required");
});

function createOverdueLedgerItem() {
  return {
    id: "ledger-overdue",
    novelId: "novel-1",
    ledgerKey: "book_contract.chapter3Payoff",
    title: "前三章合同兑现",
    summary: "开篇承诺仍未兑现。",
    scopeType: "book",
    currentStatus: "overdue",
    targetStartChapterOrder: 1,
    targetEndChapterOrder: 3,
    firstSeenChapterOrder: 1,
    lastTouchedChapterOrder: 3,
    lastTouchedChapterId: "chapter-3",
    setupChapterId: "chapter-1",
    payoffChapterId: null,
    lastSnapshotId: null,
    sourceRefs: [],
    evidence: [],
    riskSignals: [],
    statusReason: "已超过第3章合同兑现窗口。",
    confidence: 0.9,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function createRuntimePackageInput(overrides = {}) {
  return {
    novelId: "novel-1",
    chapterId: "chapter-74",
    request: {},
    contextPackage: {
      chapter: { id: "chapter-74", title: "第74章", order: 74 },
      ledgerPendingItems: [],
      ledgerOverdueItems: [createOverdueLedgerItem()],
      ledgerSummary: { overdueCount: 1 },
    },
    finalContent: "本章细纲已完成。",
    auditResult: {
      score: {
        coherence: 90,
        pacing: 90,
        repetition: 90,
        engagement: 90,
        voice: 90,
        overall: 90,
      },
      auditReports: [],
    },
    activeOpenConflicts: [],
    styleReview: {
      report: null,
      autoRewritten: false,
      originalContent: null,
    },
    acceptance: {
      status: "accepted",
      missingObligations: [],
      repairability: "none",
      decisionReason: "本章正文可继续。",
      continuePolicy: "continue",
      riskTags: [],
      repairDirectives: [],
      assetSyncRecommendation: {
        priority: "normal",
        reason: "normal sync",
        requiresFullPayoffReconcile: false,
      },
    },
    runId: null,
    plannerService: {
      shouldTriggerReplanFromAudit() {
        return false;
      },
    },
    ...overrides,
  };
}

test("buildRuntimePackage keeps ledger overdue issues out of chapter blocking", () => {
  const runtimePackage = buildRuntimePackage(createRuntimePackageInput());

  assert.equal(runtimePackage.audit.hasBlockingIssues, false);
  assert.deepEqual(runtimePackage.audit.openIssues.map((issue) => issue.code), ["payoff_overdue"]);
  assert.equal(runtimePackage.context.chapterRepairContext ?? null, null);
  assert.deepEqual(runtimePackage.replanRecommendation.blockingLedgerKeys, []);
});

test("buildRuntimePackage still blocks local high-severity issues beside overdue payoffs", () => {
  const runtimePackage = buildRuntimePackage(createRuntimePackageInput({
    auditResult: {
      score: {
        coherence: 90,
        pacing: 90,
        repetition: 90,
        engagement: 90,
        voice: 90,
        overall: 90,
      },
      auditReports: [{
        id: "report-1",
        novelId: "novel-1",
        chapterId: "chapter-74",
        auditType: "mode_fit",
        overallScore: 90,
        summary: "局部正文问题",
        legacyScoreJson: null,
        issues: [{
          id: "prose-1",
          reportId: "report-1",
          auditType: "mode_fit",
          severity: "high",
          code: "prose_negative_flip",
          description: "模板化否定翻转。",
          evidence: "他不是害怕，而是终于明白。",
          fixSuggestion: "改成具体动作。",
          status: "open",
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-07T00:00:00.000Z",
        }],
        createdAt: "2026-09-07T00:00:00.000Z",
        updatedAt: "2026-09-07T00:00:00.000Z",
      }],
    },
  }));

  assert.equal(runtimePackage.audit.hasBlockingIssues, true);
  assert.deepEqual(
    runtimePackage.audit.openIssues.map((issue) => issue.code).sort(),
    ["payoff_overdue", "prose_negative_flip"],
  );
});
