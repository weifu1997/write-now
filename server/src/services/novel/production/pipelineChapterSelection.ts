import type { Prisma } from "@prisma/client";
import { readChapterQualityDebtDetails } from "@write-now/shared/types/chapterQualityLoop";

export type PipelineChapterScope = "writable" | "quality_debt";

const TERMINAL_CONTINUE_QUALITY_LOOP_RISK_FLAG_FRAGMENT = '"terminalAction":"defer_and_continue"';
const REPLAN_REQUIRED_QUALITY_LOOP_RISK_FLAG_FRAGMENT = '"rootCauseCode":"replan_required"';
const REPLAN_ACTION_QUALITY_LOOP_RISK_FLAG_FRAGMENT = '"recommendedAction":"replan"';

export function resolvePipelineChapterScope(value: unknown): PipelineChapterScope {
  return value === "quality_debt" ? "quality_debt" : "writable";
}

export function isOpenQualityDebtChapter(chapter: {
  content?: string | null;
  riskFlags?: string | null;
}): boolean {
  return Boolean(chapter.content?.trim()) && Boolean(readChapterQualityDebtDetails(chapter.riskFlags));
}

export function buildSkipCompletedChapterWhere(): Prisma.ChapterWhereInput {
  return {
    NOT: {
      AND: [
        { content: { not: null } },
        { content: { not: "" } },
        {
          OR: [
            { generationState: { in: ["approved", "published"] } },
            { chapterStatus: "completed" },
            {
              AND: [
                { riskFlags: { not: null } },
                { riskFlags: { contains: TERMINAL_CONTINUE_QUALITY_LOOP_RISK_FLAG_FRAGMENT } },
                { riskFlags: { not: { contains: REPLAN_REQUIRED_QUALITY_LOOP_RISK_FLAG_FRAGMENT } } },
                { riskFlags: { not: { contains: REPLAN_ACTION_QUALITY_LOOP_RISK_FLAG_FRAGMENT } } },
              ],
            },
          ],
        },
      ],
    },
  };
}

export function buildPipelineChapterWhere(input: {
  novelId: string;
  startOrder: number;
  endOrder: number;
  chapterScope: PipelineChapterScope;
  skipCompleted?: boolean;
}): Prisma.ChapterWhereInput {
  return {
    novelId: input.novelId,
    order: { gte: input.startOrder, lte: input.endOrder },
    ...(input.chapterScope === "quality_debt"
      ? {
        AND: [
          { content: { not: null } },
          { content: { not: "" } },
        ],
      }
      : input.skipCompleted
        ? buildSkipCompletedChapterWhere()
        : {}),
  };
}

export function selectPipelineChapters<T extends {
  content?: string | null;
  riskFlags?: string | null;
}>(
  chapters: T[],
  chapterScope: PipelineChapterScope,
): T[] {
  if (chapterScope !== "quality_debt") {
    return chapters;
  }
  return chapters.filter((chapter) => isOpenQualityDebtChapter(chapter));
}
