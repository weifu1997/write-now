import type { NarrativeForm } from "./creationStudio";

export type WritingPlatform = "fanqie_free" | "qidian_male" | "jinjiang_female" | "zhihu_story";
export type WritingPlatformPreference = "ai_recommend" | WritingPlatform;
export type OpeningWorldExplainBudget = "minimal" | "moderate" | "full";

export interface WritingPlatformGuidance {
  positioning: string;
  planning: string;
  drafting: string;
  auditing: string;
  repairing: string;
}

export interface WritingPlatformEarlyPayoffWindows {
  hookByChapter: number;
  firstStageByChapter: number;
  openingArcByChapter: number;
}

export interface WritingPlatformExperienceContract {
  recommendedChapterWordCount: number | null;
  softMinWordCount: number | null;
  softMaxWordCount: number | null;
  hardMaxWordCount: number | null;
  openingPressureByChars: number;
  openingWorldExplainBudget: OpeningWorldExplainBudget;
  earlyPayoffWindows: WritingPlatformEarlyPayoffWindows | null;
  incompatibleCommercialTags: string[];
  suggestedCommercialTags: string[];
}

export interface WritingPlatformProfileDefinition {
  platform: WritingPlatform;
  label: string;
  summary: string;
  supportedNarrativeForms: NarrativeForm[];
  guidance: Partial<Record<NarrativeForm, WritingPlatformGuidance>>;
  experience?: Partial<Record<NarrativeForm, WritingPlatformExperienceContract>>;
  officialVersion: number;
}

export interface WritingPlatformRecommendation {
  platform: WritingPlatform;
  confidence: number;
  reason: string;
}

export interface WritingPlatformSnapshot {
  platform: WritingPlatform;
  label: string;
  narrativeForm: NarrativeForm;
  profileVersion: number;
  source: "official" | "custom";
  guidance: WritingPlatformGuidance;
  experience?: WritingPlatformExperienceContract;
}

export interface WritingPlatformProfileVersionView {
  id: string;
  platform: WritingPlatform;
  versionNo: number;
  profile: WritingPlatformProfileDefinition;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

export const LEGACY_EARLY_PAYOFF_WINDOWS: WritingPlatformEarlyPayoffWindows = {
  hookByChapter: 3,
  firstStageByChapter: 10,
  openingArcByChapter: 30,
};

export const FANQIE_INCOMPATIBLE_COMMERCIAL_TAGS = ["无限流", "诸天万界", "黑科技"] as const;
export const FANQIE_SUGGESTED_COMMERCIAL_TAGS = ["穿越", "逆袭", "神匠", "无敌"] as const;

export const FANQIE_LONG_NOVEL_EXPERIENCE: WritingPlatformExperienceContract = {
  recommendedChapterWordCount: 2000,
  softMinWordCount: 1800,
  softMaxWordCount: 2200,
  hardMaxWordCount: 2500,
  openingPressureByChars: 500,
  openingWorldExplainBudget: "minimal",
  earlyPayoffWindows: {
    hookByChapter: 3,
    firstStageByChapter: 8,
    openingArcByChapter: 14,
  },
  incompatibleCommercialTags: [...FANQIE_INCOMPATIBLE_COMMERCIAL_TAGS],
  suggestedCommercialTags: [...FANQIE_SUGGESTED_COMMERCIAL_TAGS],
};

export const QIDIAN_LONG_NOVEL_EXPERIENCE: WritingPlatformExperienceContract = {
  recommendedChapterWordCount: 2800,
  softMinWordCount: 2380,
  softMaxWordCount: 3220,
  hardMaxWordCount: 3500,
  openingPressureByChars: 800,
  openingWorldExplainBudget: "moderate",
  earlyPayoffWindows: {
    hookByChapter: 3,
    firstStageByChapter: 10,
    openingArcByChapter: 30,
  },
  incompatibleCommercialTags: [],
  suggestedCommercialTags: [],
};

export const JINJIANG_LONG_NOVEL_EXPERIENCE: WritingPlatformExperienceContract = {
  recommendedChapterWordCount: 2800,
  softMinWordCount: 2380,
  softMaxWordCount: 3220,
  hardMaxWordCount: 3500,
  openingPressureByChars: 800,
  openingWorldExplainBudget: "moderate",
  earlyPayoffWindows: {
    hookByChapter: 3,
    firstStageByChapter: 10,
    openingArcByChapter: 30,
  },
  incompatibleCommercialTags: [],
  suggestedCommercialTags: [],
};

export const ZHIHU_SHORT_STORY_EXPERIENCE: WritingPlatformExperienceContract = {
  recommendedChapterWordCount: null,
  softMinWordCount: null,
  softMaxWordCount: null,
  hardMaxWordCount: null,
  openingPressureByChars: 500,
  openingWorldExplainBudget: "minimal",
  earlyPayoffWindows: null,
  incompatibleCommercialTags: [],
  suggestedCommercialTags: [],
};

export const FANQIE_SHORT_STORY_EXPERIENCE: WritingPlatformExperienceContract = {
  recommendedChapterWordCount: null,
  softMinWordCount: null,
  softMaxWordCount: null,
  hardMaxWordCount: null,
  openingPressureByChars: 500,
  openingWorldExplainBudget: "minimal",
  earlyPayoffWindows: null,
  incompatibleCommercialTags: [...FANQIE_INCOMPATIBLE_COMMERCIAL_TAGS],
  suggestedCommercialTags: [...FANQIE_SUGGESTED_COMMERCIAL_TAGS],
};

export const OFFICIAL_WRITING_PLATFORM_EXPERIENCE: Record<
  WritingPlatform,
  Partial<Record<NarrativeForm, WritingPlatformExperienceContract>>
> = {
  fanqie_free: {
    long_novel: FANQIE_LONG_NOVEL_EXPERIENCE,
    short_story: FANQIE_SHORT_STORY_EXPERIENCE,
  },
  qidian_male: {
    long_novel: QIDIAN_LONG_NOVEL_EXPERIENCE,
  },
  jinjiang_female: {
    long_novel: JINJIANG_LONG_NOVEL_EXPERIENCE,
  },
  zhihu_story: {
    short_story: ZHIHU_SHORT_STORY_EXPERIENCE,
  },
};

export function resolveOfficialWritingPlatformExperience(
  platform: WritingPlatform,
  narrativeForm: NarrativeForm,
): WritingPlatformExperienceContract | null {
  return OFFICIAL_WRITING_PLATFORM_EXPERIENCE[platform]?.[narrativeForm] ?? null;
}

function cloneExperience(experience: WritingPlatformExperienceContract): WritingPlatformExperienceContract {
  return {
    recommendedChapterWordCount: experience.recommendedChapterWordCount,
    softMinWordCount: experience.softMinWordCount,
    softMaxWordCount: experience.softMaxWordCount,
    hardMaxWordCount: experience.hardMaxWordCount,
    openingPressureByChars: experience.openingPressureByChars,
    openingWorldExplainBudget: experience.openingWorldExplainBudget,
    earlyPayoffWindows: experience.earlyPayoffWindows
      ? { ...experience.earlyPayoffWindows }
      : null,
    incompatibleCommercialTags: [...experience.incompatibleCommercialTags],
    suggestedCommercialTags: [...experience.suggestedCommercialTags],
  };
}

function fillExperienceFromOfficial(
  raw: Partial<WritingPlatformExperienceContract> | null | undefined,
  official: WritingPlatformExperienceContract,
  options: { preserveLegacyWindows: boolean },
): WritingPlatformExperienceContract {
  const filled = cloneExperience(official);
  if (!raw) {
    if (options.preserveLegacyWindows) {
      filled.earlyPayoffWindows = official.earlyPayoffWindows
        ? { ...LEGACY_EARLY_PAYOFF_WINDOWS }
        : null;
    }
    return filled;
  }
  if (typeof raw.recommendedChapterWordCount === "number" || raw.recommendedChapterWordCount === null) {
    filled.recommendedChapterWordCount = raw.recommendedChapterWordCount;
  }
  if (typeof raw.softMinWordCount === "number" || raw.softMinWordCount === null) {
    filled.softMinWordCount = raw.softMinWordCount;
  }
  if (typeof raw.softMaxWordCount === "number" || raw.softMaxWordCount === null) {
    filled.softMaxWordCount = raw.softMaxWordCount;
  }
  if (typeof raw.hardMaxWordCount === "number" || raw.hardMaxWordCount === null) {
    filled.hardMaxWordCount = raw.hardMaxWordCount;
  }
  if (typeof raw.openingPressureByChars === "number" && raw.openingPressureByChars > 0) {
    filled.openingPressureByChars = raw.openingPressureByChars;
  }
  if (
    raw.openingWorldExplainBudget === "minimal"
    || raw.openingWorldExplainBudget === "moderate"
    || raw.openingWorldExplainBudget === "full"
  ) {
    filled.openingWorldExplainBudget = raw.openingWorldExplainBudget;
  }
  if (options.preserveLegacyWindows) {
    filled.earlyPayoffWindows = official.earlyPayoffWindows
      ? { ...LEGACY_EARLY_PAYOFF_WINDOWS }
      : null;
  } else if (raw.earlyPayoffWindows) {
    filled.earlyPayoffWindows = { ...raw.earlyPayoffWindows };
  }
  if (Array.isArray(raw.incompatibleCommercialTags)) {
    filled.incompatibleCommercialTags = [...raw.incompatibleCommercialTags];
  }
  if (Array.isArray(raw.suggestedCommercialTags)) {
    filled.suggestedCommercialTags = [...raw.suggestedCommercialTags];
  }
  return filled;
}

export function hydrateWritingPlatformSnapshot(
  snapshot: WritingPlatformSnapshot | null | undefined,
): WritingPlatformSnapshot | null {
  if (!snapshot) {
    return null;
  }
  const official = resolveOfficialWritingPlatformExperience(snapshot.platform, snapshot.narrativeForm);
  if (!official) {
    return {
      ...snapshot,
      guidance: { ...snapshot.guidance },
      experience: snapshot.experience ? cloneExperience(snapshot.experience) : undefined,
    };
  }
  const preserveLegacyWindows = snapshot.experience?.earlyPayoffWindows == null;
  return {
    ...snapshot,
    guidance: { ...snapshot.guidance },
    experience: fillExperienceFromOfficial(snapshot.experience, official, { preserveLegacyWindows }),
  };
}

export function parseWritingPlatformSnapshotJson(
  raw: string | null | undefined,
): WritingPlatformSnapshot | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as WritingPlatformSnapshot;
    return hydrateWritingPlatformSnapshot(parsed);
  } catch {
    return null;
  }
}

export interface ResolvedDefaultChapterLength {
  value: number;
  fromUser: boolean;
  recommended: number | null;
  differsFromRecommended: boolean;
}

export function resolveDefaultChapterLength(input: {
  userValue?: number | null;
  platform?: WritingPlatform | null;
  narrativeForm?: NarrativeForm | null;
  snapshot?: WritingPlatformSnapshot | null;
}): ResolvedDefaultChapterLength {
  const hydrated = hydrateWritingPlatformSnapshot(input.snapshot);
  const official = input.platform && input.narrativeForm
    ? resolveOfficialWritingPlatformExperience(input.platform, input.narrativeForm)
    : null;
  const recommended = hydrated?.experience?.recommendedChapterWordCount
    ?? official?.recommendedChapterWordCount
    ?? null;
  if (typeof input.userValue === "number" && Number.isFinite(input.userValue) && input.userValue > 0) {
    const value = Math.round(input.userValue);
    return {
      value,
      fromUser: true,
      recommended,
      differsFromRecommended: recommended != null && value !== recommended,
    };
  }
  if (typeof recommended === "number" && recommended > 0) {
    return {
      value: recommended,
      fromUser: false,
      recommended,
      differsFromRecommended: false,
    };
  }
  return {
    value: 2800,
    fromUser: false,
    recommended,
    differsFromRecommended: false,
  };
}

export function resolveChapterTargetWordCount(input: {
  chapterTargetWordCount?: number | null;
  defaultChapterLength?: number | null;
  snapshot?: WritingPlatformSnapshot | null;
  platform?: WritingPlatform | null;
  narrativeForm?: NarrativeForm | null;
}): number | null {
  if (typeof input.chapterTargetWordCount === "number" && input.chapterTargetWordCount > 0) {
    return Math.round(input.chapterTargetWordCount);
  }
  if (typeof input.defaultChapterLength === "number" && input.defaultChapterLength > 0) {
    return Math.round(input.defaultChapterLength);
  }
  const resolved = resolveDefaultChapterLength({
    platform: input.platform,
    narrativeForm: input.narrativeForm,
    snapshot: input.snapshot,
  });
  return resolved.recommended != null ? resolved.value : resolved.value;
}

export function formatWritingPlatformPlanningText(snapshot: WritingPlatformSnapshot | null | undefined): string {
  const hydrated = hydrateWritingPlatformSnapshot(snapshot);
  if (!hydrated) {
    return "沿用通用中文商业网文写法，保持情节推进、人物主动、因果清晰和章节回报。";
  }
  const experience = hydrated.experience;
  const lengthLine = experience?.recommendedChapterWordCount
    ? `推荐单章约 ${experience.recommendedChapterWordCount} 字，可接受 ${experience.softMinWordCount}-${experience.softMaxWordCount} 字，硬上限 ${experience.hardMaxWordCount} 字。`
    : "本平台不使用长篇单章字数合同。";
  const openingLine = experience
    ? `开篇前 ${experience.openingPressureByChars} 字必须进入可见压力、动作或选择；世界观解释量：${experience.openingWorldExplainBudget}。`
    : "";
  const windowLine = experience?.earlyPayoffWindows
    ? `早期兑现窗：抓手第 ${experience.earlyPayoffWindows.hookByChapter} 章，第一阶段第 ${experience.earlyPayoffWindows.firstStageByChapter} 章，开篇弧第 ${experience.earlyPayoffWindows.openingArcByChapter} 章。开书主矛盾必须落在开篇弧内。`
    : "";
  return [
    `${hydrated.label}（配置版本 ${hydrated.profileVersion}）`,
    hydrated.guidance.planning,
    lengthLine,
    openingLine,
    windowLine,
  ].filter(Boolean).join("\n");
}

export function formatWritingPlatformDraftingText(snapshot: WritingPlatformSnapshot | null | undefined): string {
  const hydrated = hydrateWritingPlatformSnapshot(snapshot);
  if (!hydrated) {
    return "沿用通用中文商业网文写法，保持情节推进、人物主动、因果清晰和章节回报。";
  }
  return `${hydrated.label}（配置版本 ${hydrated.profileVersion}）：${hydrated.guidance.drafting}`;
}

export function compactOpeningExplainContext(
  text: string,
  chapterOrder: number,
  snapshot?: WritingPlatformSnapshot | null,
): string {
  if (!text.trim() || chapterOrder > 3) {
    return text;
  }
  const budget = hydrateWritingPlatformSnapshot(snapshot)?.experience?.openingWorldExplainBudget ?? "moderate";
  if (budget !== "minimal") {
    return text;
  }
  const compactLines = text
    .split(/\n+/)
    .filter((line) => /禁止|不得|红线|硬约束|当前场景|当场|危机|冲突/.test(line))
    .slice(0, 8);
  return compactLines.join("\n") || text.split(/\n+/).slice(0, 4).join("\n");
}

export function formatOpeningPlatformConstraintText(input: {
  snapshot?: WritingPlatformSnapshot | null;
  chapterOrder: number;
}): string | null {
  if (input.chapterOrder <= 0 || input.chapterOrder > 3) {
    return null;
  }
  const hydrated = hydrateWritingPlatformSnapshot(input.snapshot);
  const experience = hydrated?.experience;
  if (!experience) {
    return null;
  }
  return [
    `开篇约束（第 ${input.chapterOrder} 章）：`,
    `前 ${experience.openingPressureByChars} 字必须进入可见危机、冲突、动作或选择，禁止用说明文开场。`,
    "禁止法条背诵、系统说明书、长段前世回忆开场。",
    experience.openingWorldExplainBudget === "minimal"
      ? "世界规则只作为硬约束，只保留当前场景立刻用得到的信息，禁止写成设定说明书。"
      : "世界规则只作为硬约束，用动作和选择带出必要信息。",
  ].join("\n");
}

export interface CommercialTagConflict {
  tag: string;
  suggestedTags: string[];
}

export interface CommercialTagGuardResult {
  conflicts: CommercialTagConflict[];
  suggestedTags: string[];
}

function normalizeTagKey(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

export function findIncompatibleCommercialTags(
  tags: string[] | null | undefined,
  experience: WritingPlatformExperienceContract | null | undefined,
): CommercialTagGuardResult {
  const incompatible = experience?.incompatibleCommercialTags ?? [];
  const suggestedTags = experience?.suggestedCommercialTags ?? [];
  if (!tags?.length || incompatible.length === 0) {
    return { conflicts: [], suggestedTags };
  }
  const blocked = new Map(incompatible.map((tag) => [normalizeTagKey(tag), tag]));
  const conflicts: CommercialTagConflict[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const matched = blocked.get(normalizeTagKey(tag));
    if (!matched || seen.has(matched)) {
      continue;
    }
    seen.add(matched);
    conflicts.push({ tag: matched, suggestedTags });
  }
  return { conflicts, suggestedTags };
}

export function formatCommercialTagConflictMessage(result: CommercialTagGuardResult): string {
  if (result.conflicts.length === 0) {
    return "";
  }
  const tags = result.conflicts.map((item) => item.tag).join("、");
  const suggestions = result.suggestedTags.length > 0
    ? `可改用 ${result.suggestedTags.join("、")}。`
    : "请改成与当前平台阅读习惯更匹配的标签。";
  return `当前标签与目标平台不合：${tags}。${suggestions}如需保留，请明确确认后再保存。`;
}
