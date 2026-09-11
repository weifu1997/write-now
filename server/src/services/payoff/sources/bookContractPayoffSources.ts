import {
  LEGACY_EARLY_PAYOFF_WINDOWS,
  hydrateWritingPlatformSnapshot,
  type WritingPlatformEarlyPayoffWindows,
  type WritingPlatformSnapshot,
} from "@write-now/shared/types/writingPlatform";

export interface BookContractPayoffValues {
  chapter3Payoff?: string | null;
  chapter10Payoff?: string | null;
  chapter30Payoff?: string | null;
}

export interface BookContractPayoffSource {
  refId: string;
  refLabel: string;
  payoff: string;
  targetStartChapterOrder: number;
  targetEndChapterOrder: number;
}

export function resolveBookContractPayoffWindows(
  snapshot?: WritingPlatformSnapshot | null,
): WritingPlatformEarlyPayoffWindows {
  const hydrated = hydrateWritingPlatformSnapshot(snapshot);
  return hydrated?.experience?.earlyPayoffWindows ?? LEGACY_EARLY_PAYOFF_WINDOWS;
}

function buildPayoffWindowDefs(windows: WritingPlatformEarlyPayoffWindows) {
  return [
    {
      field: "chapter3Payoff" as const,
      refId: "book_contract.chapter3Payoff",
      refLabel: "Book Contract 第 3 章阶段回报",
      targetStartChapterOrder: 1,
      targetEndChapterOrder: windows.hookByChapter,
    },
    {
      field: "chapter10Payoff" as const,
      refId: "book_contract.chapter10Payoff",
      refLabel: "Book Contract 第 10 章阶段回报",
      targetStartChapterOrder: windows.hookByChapter + 1,
      targetEndChapterOrder: windows.firstStageByChapter,
    },
    {
      field: "chapter30Payoff" as const,
      refId: "book_contract.chapter30Payoff",
      refLabel: "Book Contract 第 30 章阶段回报",
      targetStartChapterOrder: windows.firstStageByChapter + 1,
      targetEndChapterOrder: windows.openingArcByChapter,
    },
  ];
}

function normalizePayoff(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function buildBookContractPayoffSources(
  values: BookContractPayoffValues | null | undefined,
  snapshot?: WritingPlatformSnapshot | null,
): BookContractPayoffSource[] {
  if (!values) {
    return [];
  }
  return buildPayoffWindowDefs(resolveBookContractPayoffWindows(snapshot)).flatMap((window) => {
    const payoff = normalizePayoff(values[window.field]);
    return payoff
      ? [{
          refId: window.refId,
          refLabel: window.refLabel,
          payoff,
          targetStartChapterOrder: window.targetStartChapterOrder,
          targetEndChapterOrder: window.targetEndChapterOrder,
        }]
      : [];
  });
}

export function hasBookContractPayoffChanges(
  previous: BookContractPayoffValues | null | undefined,
  next: BookContractPayoffValues,
): boolean {
  if (!previous) {
    return buildBookContractPayoffSources(next).length > 0;
  }
  return (["chapter3Payoff", "chapter10Payoff", "chapter30Payoff"] as const).some((field) => (
    normalizePayoff(previous[field]) !== normalizePayoff(next[field])
  ));
}
