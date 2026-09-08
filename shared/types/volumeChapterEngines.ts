/**
 * 拆章阶段的玩法引擎类型。
 * 用于结构化轮换校验：连续多章不得复用同一引擎。
 * 与具体题材词无关，避免书特化关键词门禁。
 */
export const CHAPTER_PLAY_ENGINE_TYPES = [
  "setup",
  "probe",
  "pressure",
  "confrontation",
  "bargain",
  "reveal",
  "relationship",
  "chase",
  "payoff",
  "aftermath",
] as const;

export type ChapterPlayEngineType = (typeof CHAPTER_PLAY_ENGINE_TYPES)[number];

export function isChapterPlayEngineType(value: string): value is ChapterPlayEngineType {
  return (CHAPTER_PLAY_ENGINE_TYPES as readonly string[]).includes(value);
}
