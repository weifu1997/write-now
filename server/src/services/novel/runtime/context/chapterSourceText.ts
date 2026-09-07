export const runtimeChapterSelect = {
  id: true,
  title: true,
  order: true,
  content: true,
  expectation: true,
  targetWordCount: true,
  conflictLevel: true,
  revealLevel: true,
  mustAvoid: true,
  taskSheet: true,
  sceneCards: true,
  hook: true,
} as const;

export function extractChapterOpening(content: string, maxLength: number): string {
  return content.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export interface OpeningAvoidanceSample {
  order: number;
  title: string;
  opening: string;
}

export function formatOpeningAvoidanceSamples(samples: OpeningAvoidanceSample[]): string {
  const lines = samples
    .map((item) => ({
      order: item.order,
      title: (item.title ?? "").trim(),
      opening: item.opening.trim(),
    }))
    .filter((item) => item.opening.length > 0)
    .map((item) => `- 第${item.order}章${item.title ? ` ${item.title}` : ""}：${item.opening}`);

  if (lines.length === 0) {
    return "";
  }

  return [
    "近几章这样开头（上一章在最前）：",
    ...lines,
    "规避要求：本章开头不得复用以上样本的开场表达模式（相同的环境铺陈句式、相同的起手词或「时间+地点+氛围」组合）；换一个切入位置，从进行中的事件、对话、动作或人物决策直接进入，并换用不同的感官与节奏。",
  ].join("\n");
}

export function extractChapterTail(content: string | null | undefined, maxLength = 520): string {
  const normalized = (content ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.slice(Math.max(0, normalized.length - maxLength));
}
