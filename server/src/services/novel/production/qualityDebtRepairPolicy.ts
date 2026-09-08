import type {
  ChapterAcceptanceContinuePolicy,
  ChapterAcceptanceRepairDirective,
  ChapterAcceptanceRepairability,
  ChapterAcceptanceStatus,
} from "@write-now/shared/types/chapterRuntime/qualitySchemas";

export type QualityDebtRepairMode =
  | "detect_only"
  | "light_repair"
  | "heavy_repair"
  | "continuity_only"
  | "character_only"
  | "ending_only";

export function isQualityDebtRepairScope(chapterScope: unknown): boolean {
  return chapterScope === "quality_debt";
}

function isPausedAcceptance(input: {
  continuePolicy?: ChapterAcceptanceContinuePolicy | string | null;
  acceptanceStatus?: ChapterAcceptanceStatus | string | null;
}): boolean {
  return input.continuePolicy === "pause" || input.acceptanceStatus === "needs_manual_review";
}

/**
 * 是否跳过本章自动修复。
 * `pause` / `needs_manual_review` 在普通写作入口仍表示不要自动修；
 * 用户显式发起的质量债批次除外，规划错位仍不能靠改写本章消掉。
 */
export function shouldSkipAutomaticRepair(input: {
  chapterScope?: string | null;
  autoRepair: boolean;
  repairMode?: QualityDebtRepairMode | null;
  attempt: number;
  repairAttemptBudget: number;
  continuePolicy?: ChapterAcceptanceContinuePolicy | string | null;
  acceptanceStatus?: ChapterAcceptanceStatus | string | null;
  repairability?: ChapterAcceptanceRepairability | string | null;
}): boolean {
  if (!input.autoRepair || input.repairMode === "detect_only") {
    return true;
  }
  if (input.attempt >= input.repairAttemptBudget) {
    return true;
  }
  if (input.repairability === "plan_misalignment") {
    return true;
  }
  if (isPausedAcceptance(input) && !isQualityDebtRepairScope(input.chapterScope)) {
    return true;
  }
  return false;
}

/**
 * 质量债入口按验收结构化字段决定本次修复模式。
 * 普通写作入口保持调用方模式，补丁失败不得在这里升级成整章重写。
 */
export function resolveQualityDebtRepairMode(input: {
  chapterScope?: string | null;
  requestedMode?: QualityDebtRepairMode | null;
  repairability?: ChapterAcceptanceRepairability | string | null;
  acceptanceStatus?: ChapterAcceptanceStatus | string | null;
  repairDirectives?: Array<Pick<ChapterAcceptanceRepairDirective, "mode">> | null;
}): QualityDebtRepairMode {
  const requested = input.requestedMode ?? "light_repair";
  if (!isQualityDebtRepairScope(input.chapterScope) || requested === "detect_only") {
    return requested;
  }
  if (input.repairability === "plan_misalignment") {
    return requested;
  }
  const hasRewriteDirective = (input.repairDirectives ?? []).some((directive) => directive.mode === "rewrite");
  if (
    input.repairability === "rewrite_needed"
    || input.acceptanceStatus === "needs_manual_review"
    || hasRewriteDirective
  ) {
    return "heavy_repair";
  }
  return requested;
}
