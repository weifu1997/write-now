const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  OFFICIAL_WRITING_PLATFORM_PROFILES,
  supportsWritingPlatformForm,
} = require("../dist/modules/novel/writing-platform/domain/officialWritingPlatformProfiles.js");
const { listRegisteredPromptAssets } = require("../dist/prompting/registry.js");
const { getOfficialPromptTemplate } = require("../dist/prompting/templates/officialTemplates.js");
const { getRequiredTemplateContextGroups } = require("../dist/prompting/templates/templateTypes.js");

const {
  FANQIE_LONG_NOVEL_EXPERIENCE,
  JINJIANG_LONG_NOVEL_EXPERIENCE,
  QIDIAN_LONG_NOVEL_EXPERIENCE,
  ZHIHU_SHORT_STORY_EXPERIENCE,
  compactOpeningExplainContext,
  findIncompatibleCommercialTags,
  formatOpeningPlatformConstraintText,
  hydrateWritingPlatformSnapshot,
  resolveDefaultChapterLength,
} = require("../../shared/dist/types/writingPlatform.js");
const {
  resolveLengthBudgetContract,
  resolveLengthBudgetFromSnapshot,
} = require("../../shared/dist/types/chapterLengthControl.js");

test("official platform profiles cover the four locked launch profiles", () => {
  assert.deepEqual(Object.keys(OFFICIAL_WRITING_PLATFORM_PROFILES).sort(), [
    "fanqie_free", "jinjiang_female", "qidian_male", "zhihu_story",
  ]);
  assert.equal(supportsWritingPlatformForm("fanqie_free", "short_story"), true);
  assert.equal(supportsWritingPlatformForm("fanqie_free", "long_novel"), true);
  assert.equal(supportsWritingPlatformForm("qidian_male", "short_story"), false);
  assert.equal(supportsWritingPlatformForm("jinjiang_female", "short_story"), false);
  assert.equal(supportsWritingPlatformForm("zhihu_story", "short_story"), true);
  assert.equal(supportsWritingPlatformForm("zhihu_story", "long_novel"), false);
});

test("official experience contracts match the platform reading defaults", () => {
  const fanqie = OFFICIAL_WRITING_PLATFORM_PROFILES.fanqie_free.experience.long_novel;
  const qidian = OFFICIAL_WRITING_PLATFORM_PROFILES.qidian_male.experience.long_novel;
  const jinjiang = OFFICIAL_WRITING_PLATFORM_PROFILES.jinjiang_female.experience.long_novel;
  const zhihu = OFFICIAL_WRITING_PLATFORM_PROFILES.zhihu_story.experience.short_story;

  assert.deepEqual(fanqie, FANQIE_LONG_NOVEL_EXPERIENCE);
  assert.equal(fanqie.recommendedChapterWordCount, 2000);
  assert.equal(fanqie.softMinWordCount, 1800);
  assert.equal(fanqie.softMaxWordCount, 2200);
  assert.equal(fanqie.hardMaxWordCount, 2500);
  assert.equal(fanqie.openingPressureByChars, 500);
  assert.deepEqual(fanqie.earlyPayoffWindows, { hookByChapter: 3, firstStageByChapter: 8, openingArcByChapter: 14 });

  assert.deepEqual(qidian, QIDIAN_LONG_NOVEL_EXPERIENCE);
  assert.equal(qidian.recommendedChapterWordCount, 2800);
  assert.equal(qidian.openingPressureByChars, 800);
  assert.deepEqual(qidian.earlyPayoffWindows, { hookByChapter: 3, firstStageByChapter: 10, openingArcByChapter: 30 });

  assert.deepEqual(jinjiang, JINJIANG_LONG_NOVEL_EXPERIENCE);
  assert.equal(jinjiang.recommendedChapterWordCount, 2800);
  assert.deepEqual(zhihu, ZHIHU_SHORT_STORY_EXPERIENCE);
  assert.equal(zhihu.recommendedChapterWordCount, null);
  assert.equal(zhihu.earlyPayoffWindows, null);
});

test("legacy snapshots hydrate without rewriting the input object and keep 3/10/30 windows", () => {
  const raw = {
    platform: "fanqie_free",
    label: "番茄免费网文",
    narrativeForm: "long_novel",
    profileVersion: 1,
    source: "official",
    guidance: {
      positioning: "p",
      planning: "plan",
      drafting: "draft",
      auditing: "audit",
      repairing: "repair",
    },
  };
  const frozen = JSON.parse(JSON.stringify(raw));
  const hydrated = hydrateWritingPlatformSnapshot(raw);
  assert.deepEqual(raw, frozen);
  assert.equal(hydrated.experience.recommendedChapterWordCount, 2000);
  assert.equal(hydrated.experience.hardMaxWordCount, 2500);
  assert.deepEqual(hydrated.experience.earlyPayoffWindows, {
    hookByChapter: 3,
    firstStageByChapter: 10,
    openingArcByChapter: 30,
  });
});

test("fanqie length budget uses the contract hard max instead of 2000 times 1.25", () => {
  const ratioBudget = resolveLengthBudgetContract(2000);
  const platformBudget = resolveLengthBudgetFromSnapshot(2000, {
    platform: "fanqie_free",
    label: "番茄免费网文",
    narrativeForm: "long_novel",
    profileVersion: 2,
    source: "official",
    guidance: FANQIE_LONG_NOVEL_EXPERIENCE && {
      positioning: "p",
      planning: "plan",
      drafting: "draft",
      auditing: "audit",
      repairing: "repair",
    },
    experience: FANQIE_LONG_NOVEL_EXPERIENCE,
  });
  assert.equal(ratioBudget.hardMaxWordCount, 2500);
  assert.equal(platformBudget.hardMaxWordCount, 2500);
  assert.equal(platformBudget.softMinWordCount, 1800);
  assert.equal(platformBudget.softMaxWordCount, 2200);
  assert.notEqual(platformBudget.softMaxWordCount, ratioBudget.softMaxWordCount);
});

test("default chapter length follows the platform unless the user typed a value", () => {
  const unset = resolveDefaultChapterLength({ platform: "fanqie_free", narrativeForm: "long_novel" });
  const typed = resolveDefaultChapterLength({
    userValue: 3500,
    platform: "fanqie_free",
    narrativeForm: "long_novel",
  });
  assert.equal(unset.value, 2000);
  assert.equal(unset.fromUser, false);
  assert.equal(typed.value, 3500);
  assert.equal(typed.fromUser, true);
  assert.equal(typed.differsFromRecommended, true);
});

test("minimal opening explain context keeps hard constraints and drops encyclopedia lines", () => {
  const compacted = compactOpeningExplainContext([
    "器律清算则例共三百条，以下逐条说明。",
    "禁止越界使用器律印。",
    "当前场景必须立刻面对债务追索。",
    "世界观地理沿革很长。",
  ].join("\n"), 1, {
    platform: "fanqie_free",
    label: "番茄免费网文",
    narrativeForm: "long_novel",
    profileVersion: 2,
    source: "official",
    guidance: {
      positioning: "p",
      planning: "plan",
      drafting: "draft",
      auditing: "audit",
      repairing: "repair",
    },
    experience: FANQIE_LONG_NOVEL_EXPERIENCE,
  });
  assert.match(compacted, /禁止越界/);
  assert.match(compacted, /当前场景/);
  assert.equal(compacted.includes("三百条"), false);
  const opening = formatOpeningPlatformConstraintText({
    chapterOrder: 1,
    snapshot: {
      platform: "fanqie_free",
      label: "番茄免费网文",
      narrativeForm: "long_novel",
      profileVersion: 2,
      source: "official",
      guidance: {
        positioning: "p",
        planning: "plan",
        drafting: "draft",
        auditing: "audit",
        repairing: "repair",
      },
      experience: FANQIE_LONG_NOVEL_EXPERIENCE,
    },
  });
  assert.match(opening, /前 500 字必须进入可见危机/);
  assert.match(opening, /禁止法条背诵/);
});

test("fanqie commercial tags conflict with 无限流 诸天万界 黑科技", () => {
  const result = findIncompatibleCommercialTags(
    ["无限流", "逆袭", "黑科技"],
    FANQIE_LONG_NOVEL_EXPERIENCE,
  );
  assert.deepEqual(result.conflicts.map((item) => item.tag).sort(), ["无限流", "黑科技"].sort());
  assert.ok(result.suggestedTags.includes("穿越"));
});

test("long and short prose prompts declare slots and advanced templates", () => {
  const assets = new Map(listRegisteredPromptAssets().map((asset) => [asset.id, asset]));
  for (const id of ["novel.chapter.writer", "novel.short_story.segment.write"]) {
    const asset = assets.get(id);
    assert.ok(asset, `${id} must be registered`);
    assert.equal(asset.management?.productPrompt, true);
    assert.equal(asset.management?.proseGeneration, true);
    assert.ok(asset.management?.editModes.includes("slots"));
    assert.ok(asset.management?.editModes.includes("advanced_template"));
    assert.ok(asset.slots?.length > 0);
    assert.ok(getOfficialPromptTemplate(id));
    assert.ok(getRequiredTemplateContextGroups(id).includes("writing_platform"));
  }
});

test("short story advanced template keeps all five formal context blocks", () => {
  assert.deepEqual(getRequiredTemplateContextGroups("novel.short_story.segment.write"), [
    "creation_intent", "short_story_plan", "short_story_continuity", "writing_platform", "book_style",
  ]);
  const template = getOfficialPromptTemplate("novel.short_story.segment.write");
  const source = template.messages.map((item) => item.content).join("\n");
  assert.match(source, /content/);
  assert.match(source, /continuitySummary/);

  const asset = listRegisteredPromptAssets()
    .find((item) => item.id === "novel.short_story.segment.write");
  assert.equal(asset.outputSchema.safeParse({ continuitySummary: "只有连续性摘要，缺少正文。" }).success, false);
  assert.equal(asset.outputSchema.safeParse({ content: "只有正文，缺少连续性摘要。".repeat(20) }).success, false);
});

test("PostgreSQL and SQLite schemas and migrations stay aligned", () => {
  const root = path.join(__dirname, "..", "src", "prisma");
  for (const schemaName of ["schema.prisma", "schema.sqlite.prisma"]) {
    const schema = fs.readFileSync(path.join(root, schemaName), "utf8");
    assert.match(schema, /writingPlatform\s+String\?/);
    assert.match(schema, /writingPlatformSnapshotJson\s+String\?/);
    assert.match(schema, /model WritingPlatformProfileOverride/);
    assert.match(schema, /model WritingPlatformProfileVersion/);
  }
  const migration = "20260803120000_writing_platform_profiles";
  assert.ok(fs.existsSync(path.join(root, "migrations", migration, "migration.sql")));
  assert.ok(fs.existsSync(path.join(root, "migrations.sqlite", migration, "migration.sql")));
});
