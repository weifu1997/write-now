export interface ImageTaskOwnerFields {
  id: string;
  sceneType: string;
  novelId?: string | null;
  baseCharacterId?: string | null;
  bookAnalysisCharacterId?: string | null;
  updatedAt: Date | string;
}

export function resolveImageTaskOwnerKey(row: ImageTaskOwnerFields): string {
  if (row.sceneType === "novel_cover" && row.novelId) {
    return `novel_cover:${row.novelId}`;
  }
  if (row.sceneType === "character" && row.baseCharacterId) {
    return `character:${row.baseCharacterId}`;
  }
  if (row.sceneType === "book_analysis_character" && row.bookAnalysisCharacterId) {
    return `book_analysis_character:${row.bookAnalysisCharacterId}`;
  }
  return `task:${row.id}`;
}

function toTimestamp(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isSameImageTaskOwner(
  left: ImageTaskOwnerFields,
  right: ImageTaskOwnerFields,
): boolean {
  return resolveImageTaskOwnerKey(left) === resolveImageTaskOwnerKey(right);
}

export function selectLatestVisibleImageTasks<T extends ImageTaskOwnerFields>(rows: T[]): T[] {
  const latestByOwner = new Map<string, T>();
  for (const row of rows) {
    const ownerKey = resolveImageTaskOwnerKey(row);
    const current = latestByOwner.get(ownerKey);
    if (!current) {
      latestByOwner.set(ownerKey, row);
      continue;
    }
    const currentTime = toTimestamp(current.updatedAt);
    const nextTime = toTimestamp(row.updatedAt);
    if (nextTime > currentTime || (nextTime === currentTime && row.id > current.id)) {
      latestByOwner.set(ownerKey, row);
    }
  }
  return Array.from(latestByOwner.values());
}
