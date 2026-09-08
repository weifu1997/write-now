import type {
  CanonicalStateSnapshot,
  GenerationNextAction,
  NovelControlPolicy,
} from "@write-now/shared/types/canonicalState";

export interface GenerationDecisionInput {
  snapshot: CanonicalStateSnapshot;
  policy?: Partial<NovelControlPolicy> | null;
  chapterScope?: "writable" | "quality_debt" | null;
  pendingReviewProposalCount?: number;
  openAuditIssueCount?: number;
  hasRepairableDraft?: boolean;
}

function shouldAutoContinueChapterRepair(input: GenerationDecisionInput): boolean {
  return input.chapterScope === "quality_debt"
    || input.policy?.advanceMode === "full_book_autopilot";
}

export class GenerationDecisionEngine {
  decideNextAction(input: GenerationDecisionInput): GenerationNextAction {
    if ((input.openAuditIssueCount ?? 0) > 0 && input.hasRepairableDraft) {
      return "repair_existing_chapter";
    }

    if ((input.pendingReviewProposalCount ?? 0) > 0 && input.hasRepairableDraft) {
      if (shouldAutoContinueChapterRepair(input)) {
        return "repair_existing_chapter";
      }
      return "hold_for_review";
    }

    if (
      input.snapshot.narrative.urgentPayoffs.length > 0
      && !input.snapshot.narrative.currentChapterGoal?.trim()
    ) {
      return "advance_payoff";
    }

    if (input.snapshot.characters.length === 0) {
      return "refresh_character_state";
    }

    if (
      input.snapshot.narrative.openConflicts.length > 0
      && !input.snapshot.narrative.currentChapterGoal?.trim()
    ) {
      return "repair_chapter_mission";
    }

    return "write_chapter";
  }
}

export const generationDecisionEngine = new GenerationDecisionEngine();
