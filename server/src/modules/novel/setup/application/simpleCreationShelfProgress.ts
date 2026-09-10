interface SimpleCreationChapterFact {
  id?: string;
  order: number;
  content?: string | null;
}

export interface QualityDebtRepairJobLike {
  id: string;
  status: string;
  pendingManualRecovery?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  payload?: string | null;
}

function parseJobPayload(value: string | null | undefined): Record<string, unknown> | null {
  if (!value?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isQualityDebtRepairJob(job: QualityDebtRepairJobLike): boolean {
  return parseJobPayload(job.payload)?.chapterScope === "quality_debt";
}

function toJobTimestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isLiveQualityDebtRepairJob(job: QualityDebtRepairJobLike): boolean {
  return job.status === "running" || (job.status === "queued" && !job.pendingManualRecovery);
}

function compareQualityDebtRepairJobs(
  left: QualityDebtRepairJobLike,
  right: QualityDebtRepairJobLike,
): number {
  const createdDiff = toJobTimestamp(right.createdAt) - toJobTimestamp(left.createdAt);
  if (createdDiff !== 0) return createdDiff;
  const updatedDiff = toJobTimestamp(right.updatedAt) - toJobTimestamp(left.updatedAt);
  if (updatedDiff !== 0) return updatedDiff;
  return right.id.localeCompare(left.id);
}

/**
 * 简易书架只展示当前这次质量债自动修复。
 * 正在运行或排队中的任务优先；没有进行中的任务时，才回落到最新一次尝试。
 */
export function selectCurrentQualityDebtRepairJob<T extends QualityDebtRepairJobLike>(
  jobs: T[],
): T | null {
  const candidates = jobs.filter((job) => isQualityDebtRepairJob(job));
  if (candidates.length === 0) return null;
  const liveJobs = candidates.filter((job) => isLiveQualityDebtRepairJob(job));
  const pool = liveJobs.length > 0 ? liveJobs : candidates;
  return [...pool].sort(compareQualityDebtRepairJobs)[0] ?? null;
}

export interface SimpleCreationRemainingRange {
  startOrder: number;
  endOrder: number;
  totalChapterCount: number;
  savedChapterCount: number;
  remainingChapterCount: number;
  nextChapterId: string | null;
}

export function resolveSimpleCreationRemainingRange(input: {
  chapters: SimpleCreationChapterFact[];
  estimatedChapterCount?: number | null;
}): SimpleCreationRemainingRange | null {
  const maxChapterOrder = input.chapters.reduce(
    (maximum, chapter) => Math.max(maximum, Math.round(chapter.order)),
    0,
  );
  const totalChapterCount = Math.max(
    maxChapterOrder,
    Math.round(input.estimatedChapterCount ?? 0),
  );
  if (totalChapterCount <= 0) return null;

  const savedOrders = new Set(
    input.chapters
      .filter((chapter) => chapter.content?.trim())
      .map((chapter) => Math.round(chapter.order)),
  );
  const startOrder = Array.from(
    { length: totalChapterCount },
    (_item, index) => index + 1,
  ).find((order) => !savedOrders.has(order));
  if (!startOrder) return null;

  return {
    startOrder,
    endOrder: totalChapterCount,
    totalChapterCount,
    savedChapterCount: savedOrders.size,
    remainingChapterCount: totalChapterCount - savedOrders.size,
    nextChapterId: input.chapters.find((chapter) => chapter.order === startOrder)?.id ?? null,
  };
}
