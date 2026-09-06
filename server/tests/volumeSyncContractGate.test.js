const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectChapterExecutionContractSyncWarnings,
  hasFinalizedChapterProse,
} = require("../dist/services/novel/volume/VolumeChapterSyncService.js");
const {
  normalizeChapterScenePlan,
  serializeChapterScenePlan,
} = require("../../shared/dist/types/chapterLengthControl.js");

function buildSceneCards(targetWordCount) {
  const plan = normalizeChapterScenePlan(
    {
      scenes: [
        {
          sceneKey: "s1",
          sceneTitle: "开场抓手",
          objective: "把当前风险钉死。",
          mustAdvanceItems: ["风险落地"],
          mustPreserveItems: ["压迫感"],
          startState: "主角还在被动。",
          endState: "主角确认危险真实存在。",
          forbidden: ["不要回顾前情"],
          wordCount: Math.round(targetWordCount * 0.3),
        },
        {
          sceneKey: "s2",
          sceneTitle: "正面对抗",
          objective: "完成第一次明确反压。",
          mustAdvanceItems: ["反压兑现"],
          mustPreserveItems: ["资源差距仍在"],
          startState: "主角拿到反击切口。",
          endState: "敌方被迫应对。",
          forbidden: ["不要提前决战"],
          wordCount: Math.round(targetWordCount * 0.4),
        },
        {
          sceneKey: "s3",
          sceneTitle: "尾段钩子",
          objective: "用更大威胁接下章。",
          mustAdvanceItems: ["新威胁出现"],
          mustPreserveItems: ["本章收益有效"],
          startState: "主角暂时回到主动。",
          endState: "读者明确知道压力变大。",
          forbidden: ["不要展开下一章战斗"],
          wordCount: Math.round(targetWordCount * 0.3),
        },
      ],
    },
    targetWordCount,
  );
  return serializeChapterScenePlan(plan);
}

function createStaleContractChapter(overrides = {}) {
  return {
    id: "volume-chapter-8",
    volumeId: "volume-1",
    chapterId: "chapter-8",
    chapterOrder: 8,
    beatKey: null,
    title: "破门起获藏金窟",
    summary: "第八章摘要",
    purpose: "",
    exclusiveEvent: "",
    endingState: "",
    nextChapterEntryState: "",
    conflictLevel: 3,
    revealLevel: 2,
    targetWordCount: 2800,
    mustAvoid: "禁止提前破译暗契细节。",
    payoffRefs: [],
    taskSheet: "章节目标：夜袭别业起获藏金；关键角色：陆衡、楚疏影。",
    sceneCards: buildSceneCards(2800),
    ...overrides,
  };
}

function createCompleteContractChapter(overrides = {}) {
  return createStaleContractChapter({
    purpose: "第八章目标：完成查封并锁死履约事实。",
    exclusiveEvent: "当场逆转抽灵法阵。",
    endingState: "四万灵石注入护山大阵。",
    nextChapterEntryState: "主角带队直插主峰内库。",
    ...overrides,
  });
}

function createDocument(chapters) {
  return {
    novelId: "novel-demo",
    activeVersionId: null,
    source: "volume",
    volumes: [
      {
        id: "volume-1",
        novelId: "novel-demo",
        sortOrder: 1,
        title: "第一卷",
        chapters,
      },
    ],
    beatSheets: [],
  };
}

const FINALIZED_ROW = {
  id: "chapter-8",
  order: 8,
  content: "正文内容超过一定长度，视为已有成稿。",
  generationState: "approved",
  chapterStatus: "completed",
};

const PENDING_ROW = {
  id: "chapter-8",
  order: 8,
  content: "",
  generationState: "planned",
  chapterStatus: "unplanned",
};

test("已有成稿正文的章节即使合同是旧结构也跳过门禁校验", () => {
  const warnings = collectChapterExecutionContractSyncWarnings({
    document: createDocument([createStaleContractChapter()]),
    chapterRows: [FINALIZED_ROW],
  });
  assert.deepEqual(warnings, []);
});

test("章节行按 chapterId 匹配失败时回退按章节序号匹配", () => {
  const warnings = collectChapterExecutionContractSyncWarnings({
    document: createDocument([createStaleContractChapter()]),
    chapterRows: [{ ...FINALIZED_ROW, id: "another-chapter-id" }],
  });
  assert.deepEqual(warnings, []);
});

test("待执行章节的合同缺口作为质量债务返回且不抛错", () => {
  const warnings = collectChapterExecutionContractSyncWarnings({
    document: createDocument([createStaleContractChapter()]),
    chapterRows: [PENDING_ROW],
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].chapterOrder, 8);
  assert.deepEqual(warnings[0].issues, ["章节目标缺失。", "章节边界合同不完整。"]);
  assert.ok(warnings[0].repairGuidance.length > 0);
});

test("合同完整的待执行章节不产生债务", () => {
  const warnings = collectChapterExecutionContractSyncWarnings({
    document: createDocument([createCompleteContractChapter()]),
    chapterRows: [PENDING_ROW],
  });
  assert.deepEqual(warnings, []);
});

test("无执行产物的章节不参与合同校验", () => {
  const warnings = collectChapterExecutionContractSyncWarnings({
    document: createDocument([
      createStaleContractChapter({ taskSheet: "", sceneCards: "" }),
    ]),
    chapterRows: [PENDING_ROW],
  });
  assert.deepEqual(warnings, []);
});

test("范围外章节不校验执行合同", () => {
  const warnings = collectChapterExecutionContractSyncWarnings({
    document: createDocument([
      createStaleContractChapter({ chapterOrder: 9, chapterId: "chapter-9" }),
    ]),
    chapterRows: [{ ...PENDING_ROW, id: "chapter-9", order: 9 }],
    chapterRange: { startOrder: 8, endOrder: 8 },
  });
  assert.deepEqual(warnings, []);
});

test("已成稿判定要求正文非空且状态定稿", () => {
  assert.equal(hasFinalizedChapterProse(FINALIZED_ROW), true);
  assert.equal(hasFinalizedChapterProse({ ...FINALIZED_ROW, content: "   " }), false);
  assert.equal(hasFinalizedChapterProse({ ...FINALIZED_ROW, content: null }), false);
  assert.equal(hasFinalizedChapterProse({ ...FINALIZED_ROW, chapterStatus: "generating", generationState: "repaired" }), false);
  assert.equal(hasFinalizedChapterProse({ ...FINALIZED_ROW, content: "" }), false);
});
