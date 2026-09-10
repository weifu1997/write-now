const test = require("node:test");
const assert = require("node:assert/strict");

const {
  StyleAnchorPassageService,
  computeStyleAnchorContentHash,
} = require("../dist/services/styleEngine/StyleAnchorPassageService.js");
const { STYLE_ANCHOR_STORED_MAX_CHARS } = require("../../shared/dist/types/styleEngine.js");
const { styleAnchorCreateSchema } = require("../dist/modules/novel/production/http/novelStyleAnchorRoutes.js");
const { resolveChapterIntakeMaxChars } = require("../../shared/dist/types/chapterLengthControl.js");

function buildFakeStore() {
  const rows = [];
  let seq = 0;
  const store = {
    styleAnchorPassage: {
      findUnique: async ({ where }) =>
        rows.find((row) => row.novelId === where.novelId_contentHash.novelId
          && row.contentHash === where.novelId_contentHash.contentHash) ?? null,
      create: async ({ data }) => {
        const row = {
          id: `anchor-${++seq}`,
          sourceChapterId: null,
          pinned: false,
          ...data,
        };
        rows.push(row);
        return row;
      },
      deleteMany: async ({ where }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].id === where.id && rows[i].novelId === where.novelId) {
            rows.splice(i, 1);
          }
        }
        return { count: before - rows.length };
      },
      findMany: async ({ where, orderBy, take }) => {
        let result = rows.filter((row) => row.novelId === where.novelId);
        result = result.slice().sort((left, right) => {
          const byPinned = Number(right.pinned ?? false) - Number(left.pinned ?? false);
          if (byPinned !== 0) {
            return byPinned;
          }
          return (right.createdAt ?? 0) - (left.createdAt ?? 0);
        });
        if (orderBy && orderBy[0] === "pinned") {
          // already pinned-first
        }
        return result.slice(0, take ?? result.length);
      },
      count: async ({ where }) => rows.filter((row) => row.novelId === where.novelId).length,
      findFirst: async ({ where, orderBy }) => {
        const candidates = rows.filter((row) => row.novelId === where.novelId && row.pinned === where.pinned);
        if (candidates.length === 0) {
          return null;
        }
        if (orderBy && orderBy.createdAt === "asc") {
          return candidates.reduce((oldest, row) => (row.createdAt < oldest.createdAt ? row : oldest));
        }
        return candidates[0];
      },
      delete: async ({ where }) => {
        const index = rows.findIndex((row) => row.id === where.id);
        if (index >= 0) {
          return rows.splice(index, 1)[0];
        }
        throw new Error("not found");
      },
    },
    styleProfile: {
      findUnique: async () => null,
    },
    bookAnalysis: {
      findUnique: async () => null,
    },
  };
  return { store, rows };
}

test("style anchor create dedupes by content hash and truncates long text", async () => {
  const { store } = buildFakeStore();
  const service = new StyleAnchorPassageService({ prismaClient: store });

  const first = await service.create({ novelId: "n1", text: "  他推开门，屋里没人。  ", source: "manual" });
  assert.equal(first.created, true);
  const second = await service.create({ novelId: "n1", text: "他推开门，屋里没人。", source: "manual" });
  assert.equal(second.created, false);
  assert.equal(second.anchor.id, first.anchor.id);

  const longText = "夜".repeat(1200);
  const truncated = await service.create({ novelId: "n1", text: longText, source: "adopted" });
  assert.equal(truncated.created, true);

  const empty = await service.create({ novelId: "n1", text: "   ", source: "manual" });
  assert.equal(empty.created, false);
  assert.equal(empty.anchor, null);

  const stored = await store.styleAnchorPassage.findMany({ where: { novelId: "n1" } });
  const longRow = stored.find((row) => row.text.startsWith("夜"));
  assert.ok(longRow);
  assert.ok(longRow.text.length <= STYLE_ANCHOR_STORED_MAX_CHARS);
  assert.equal(longRow.source, "adopted");
});

test("style anchor HTTP intake follows chapter length hard max instead of a fixed 4000", () => {
  const chapterLengthText = "字".repeat(4100);
  const parsed = styleAnchorCreateSchema.parse({ text: chapterLengthText, source: "adopted" });
  assert.equal(parsed.text.length, 4100);

  const intakeMax = resolveChapterIntakeMaxChars();
  assert.ok(intakeMax > 4000);
  assert.throws(() => styleAnchorCreateSchema.parse({
    text: "字".repeat(intakeMax + 1),
    source: "adopted",
  }));
});

test("style anchor listForGeneration prefers confirmed passages then degrades silently", async () => {
  const { store, rows } = buildFakeStore();
  const service = new StyleAnchorPassageService({ prismaClient: store });

  // Tier 3: nothing anywhere.
  assert.deepEqual(await service.listForGeneration({ novelId: "n2" }), []);

  // Tier 1: confirmed passages.
  rows.push({ id: "a1", novelId: "n2", text: "范文一", contentHash: "h1", source: "adopted", pinned: false, createdAt: 2 });
  rows.push({ id: "a2", novelId: "n2", text: "范文二", contentHash: "h2", source: "manual", pinned: true, createdAt: 1 });
  const confirmed = await service.listForGeneration({ novelId: "n2" });
  assert.equal(confirmed.length, 2);
  assert.equal(confirmed[0].text, "范文二");
  assert.equal(confirmed[0].forbiddenEntities.length, 0);

  // Tier 2: source-book retrieval when no confirmed passages exist.
  rows.length = 0;
  store.styleProfile.findUnique = async () => ({ sourceType: "book_analysis", sourceRefId: "ba1" });
  store.bookAnalysis.findUnique = async () => ({ documentId: "doc1" });
  const retrievalCalls = [];
  const hybridRetrieval = {
    retrieve: async (query, options) => {
      retrievalCalls.push({ query, options });
      return [
        { chunkText: "  拆书源文本段落一。  ", chunkOrder: 1 },
        { chunkText: "", chunkOrder: 2 },
        { chunkText: "拆书源文本段落二。", chunkOrder: 3 },
      ];
    },
  };
  const serviceWithRetrieval = new StyleAnchorPassageService({
    prismaClient: store,
    hybridRetrieval,
  });
  const sourceAnchors = await serviceWithRetrieval.listForGeneration({
    novelId: "n3",
    styleProfileId: "sp1",
    queryHint: "第 3 章 反击",
    forbiddenEntities: ["曹国栋", "北境"],
  });
  assert.equal(sourceAnchors.length, 2);
  assert.equal(sourceAnchors[0].text, "拆书源文本段落一。");
  assert.equal(sourceAnchors[0].source, "source_book");
  assert.deepEqual(sourceAnchors[0].forbiddenEntities, ["曹国栋", "北境"]);
  assert.deepEqual(retrievalCalls[0].options.knowledgeDocumentIds, ["doc1"]);
  assert.equal(retrievalCalls[0].options.ownerTypes[0], "knowledge_document");

  // Retrieval failure degrades to empty array instead of throwing.
  const failingRetrieval = {
    retrieve: async () => {
      throw new Error("rag down");
    },
  };
  const serviceWithFailure = new StyleAnchorPassageService({
    prismaClient: store,
    hybridRetrieval: failingRetrieval,
  });
  assert.deepEqual(await serviceWithFailure.listForGeneration({ novelId: "n3", styleProfileId: "sp1" }), []);

  // Non book-analysis profile never triggers retrieval.
  store.styleProfile.findUnique = async () => ({ sourceType: "brief", sourceRefId: null });
  const serviceNoRetrieval = new StyleAnchorPassageService({ prismaClient: store });
  assert.deepEqual(await serviceNoRetrieval.listForGeneration({ novelId: "n3", styleProfileId: "sp1" }), []);
});

test("style anchor content hash is stable after trim", () => {
  assert.equal(computeStyleAnchorContentHash("  同一段文本  "), computeStyleAnchorContentHash("同一段文本"));
});
