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

export const WRITABLE_REPAIR_ATTEMPT_BUDGET = 1;
export const QUALITY_DEBT_REPAIR_ATTEMPT_BUDGET = 2;

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
 * 普通写作入口仍最多修 1 次。
 * 用户显式发起的质量债批次在同一次任务里最多修 2 次：先按验收模式修，仍不过再改写。
 */
export function clampRepairAttemptBudget(input: {
  chapterScope?: string | null;
  requestedMaxRetries?: number | null;
}): number {
  if (isQualityDebtRepairScope(input.chapterScope)) {
    return QUALITY_DEBT_REPAIR_ATTEMPT_BUDGET;
  }
  const requested = input.requestedMaxRetries ?? WRITABLE_REPAIR_ATTEMPT_BUDGET;
  return Math.max(0, Math.min(requested, WRITABLE_REPAIR_ATTEMPT_BUDGET));
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
 * 第一次仍可轻修；同章第二次自动修升级为改写，避免用户再点一次按钮。
 * 普通写作入口保持调用方模式，补丁失败不得在这里升级成整章重写。
 */
export function resolveQualityDebtRepairMode(input: {
  chapterScope?: string | null;
  requestedMode?: QualityDebtRepairMode | null;
  repairability?: ChapterAcceptanceRepairability | string | null;
  acceptanceStatus?: ChapterAcceptanceStatus | string | null;
  repairDirectives?: Array<Pick<ChapterAcceptanceRepairDirective, "mode">> | null;
  repairAttemptsUsed?: number | null;
}): QualityDebtRepairMode {
  const requested = input.requestedMode ?? "light_repair";
  if (!isQualityDebtRepairScope(input.chapterScope) || requested === "detect_only") {
    return requested;
  }
  if (input.repairability === "plan_misalignment") {
    return requested;
  }
  if ((input.repairAttemptsUsed ?? 0) > 0) {
    return "heavy_repair";
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

export function shouldEscalateFailedQualityDebtPatch(input: {
  chapterScope?: string | null;
  activeRepairMode?: QualityDebtRepairMode | null;
  repairability?: ChapterAcceptanceRepairability | string | null;
  failureTypes?: string[] | null;
  remainingRepairBudget: number;
}): boolean {
  if (!isQualityDebtRepairScope(input.chapterScope)) {
    return false;
  }
  if (input.remainingRepairBudget <= 0) {
    return false;
  }
  if (input.activeRepairMode === "heavy_repair" || input.activeRepairMode === "detect_only") {
    return false;
  }
  if (input.repairability === "plan_misalignment") {
    return false;
  }
  if ((input.failureTypes ?? []).includes("review_gate_unavailable")) {
    return false;
  }
  return true;
}

/**
 * 质量债批次修完本章后，流水线闸门仍未通过时，再用与「重新审校」相同的独立审校刷新待跟进项。
 * 普通写作入口不走这条收口，避免改变自动导演的 pass 语义。
 */
export function shouldRefreshQualityDebtByStandaloneReview(input: {
  chapterScope?: string | null;
  pass: boolean;
}): boolean {
  return isQualityDebtRepairScope(input.chapterScope) && !input.pass;
}

export function didStandaloneReviewCloseQualityDebt(
  assessment: { recommendedAction?: string | null } | null | undefined | void,
): boolean {
  return assessment?.recommendedAction === "continue";
}
