import type { ApiResponse } from "@write-now/shared/types/api";
import type { ChapterQualityLoopAssessment } from "@write-now/shared/types/chapterQualityLoop";
import type { LLMProvider } from "@write-now/shared/types/llm";
import type {
  AuditIssue,
  AuditReport,
  PayoffLedgerResponse,
  QualityScore,
  ReplanRecommendation,
  ReplanResult,
  ReviewIssue,
  StoryPlan,
  StoryStateSnapshot,
} from "@write-now/shared/types/novel";
import type { BookFramingSuggestion, BookFramingSuggestionInput } from "@write-now/shared/types/novelFraming";
import type {
  StoryDecomposition,
  StoryExpansion,
  StoryMacroField,
  StoryMacroLocks,
  StoryMacroPlan,
  StoryMacroState,
} from "@write-now/shared/types/storyMacro";
import type {
  NovelWorldGenerateInput,
  NovelWorldImportInput,
  NovelWorldManualInput,
  NovelWorldSaveToLibraryInput,
  NovelWorldSyncDiff,
  NovelWorldSyncInput,
  NovelWorldView,
} from "@write-now/shared/types/novelWorld";
import type {
  StoryWorldSliceBuilderMode,
  StoryWorldSliceOverrides,
  StoryWorldSliceView,
} from "@write-now/shared/types/storyWorldSlice";
import { apiClient } from "../client";
import type { DraftOptimizePreview } from "./shared";

export async function reviewNovelChapter(
  id: string,
  chapterId: string,
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
    content?: string;
  },
) {
  const { data } = await apiClient.post<
    ApiResponse<{
      score: QualityScore;
      issues: ReviewIssue[];
      auditReports?: AuditReport[];
      qualityAssessment: ChapterQualityLoopAssessment;
      replanRecommendation: ReplanRecommendation;
    }>
  >(`/novels/${id}/chapters/${chapterId}/review`, payload ?? {});
  return data;
}

export async function getNovelState(id: string) {
  const { data } = await apiClient.get<ApiResponse<StoryStateSnapshot | null>>(`/novels/${id}/state`);
  return data;
}

export async function getLatestStateSnapshot(id: string) {
  const { data } = await apiClient.get<ApiResponse<StoryStateSnapshot | null>>(`/novels/${id}/state-snapshots/latest`);
  return data;
}

export async function getNovelPayoffLedger(id: string, chapterOrder?: number) {
  const { data } = await apiClient.get<ApiResponse<PayoffLedgerResponse>>(`/novels/${id}/payoff-ledger`, {
    params: typeof chapterOrder === "number" ? { chapterOrder } : undefined,
  });
  return data;
}

export async function getChapterStateSnapshot(id: string, chapterId: string) {
  const { data } = await apiClient.get<ApiResponse<StoryStateSnapshot | null>>(`/novels/${id}/chapters/${chapterId}/state-snapshot`);
  return data;
}

export async function rebuildNovelState(
  id: string,
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<StoryStateSnapshot[]>>(`/novels/${id}/state/rebuild`, payload ?? {});
  return data;
}

export async function generateBookPlan(
  id: string,
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<StoryPlan>>(`/novels/${id}/plans/book/generate`, payload ?? {});
  return data;
}

export async function generateArcPlan(
  id: string,
  arcId: string,
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<StoryPlan>>(`/novels/${id}/plans/arcs/${arcId}/generate`, payload ?? {});
  return data;
}

export async function generateChapterPlan(
  id: string,
  chapterId: string,
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<StoryPlan>>(`/novels/${id}/chapters/${chapterId}/plan/generate`, payload ?? {});
  return data;
}

export async function getChapterPlan(id: string, chapterId: string) {
  const { data } = await apiClient.get<ApiResponse<StoryPlan | null>>(`/novels/${id}/chapters/${chapterId}/plan`);
  return data;
}

export async function replanNovel(
  id: string,
  payload: {
    reason: string;
    chapterId?: string;
    triggerType?: string;
    sourceIssueIds?: string[];
    windowSize?: number;
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<ReplanResult>>(`/novels/${id}/replan`, payload);
  return data;
}

export async function auditNovelChapter(
  id: string,
  chapterId: string,
  scope: "continuity" | "character" | "plot" | "mode_fit" | "full",
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
    content?: string;
  },
) {
  const { data } = await apiClient.post<
    ApiResponse<{
      score: QualityScore;
      issues: ReviewIssue[];
      auditReports: AuditReport[];
      replanRecommendation?: ReplanRecommendation;
    }>
  >(`/novels/${id}/chapters/${chapterId}/audit/${scope}`, payload ?? {});
  return data;
}

export async function getChapterAuditReports(id: string, chapterId: string) {
  const { data } = await apiClient.get<ApiResponse<AuditReport[]>>(`/novels/${id}/chapters/${chapterId}/audit-reports`);
  return data;
}

export async function resolveAuditIssue(id: string, issueId: string) {
  const { data } = await apiClient.post<ApiResponse<AuditIssue[]>>(`/novels/${id}/audit-issues/${issueId}/resolve`, {});
  return data;
}

export async function getNovelQualityReport(id: string) {
  const { data } = await apiClient.get<
    ApiResponse<{
      novelId: string;
      summary: QualityScore;
      chapterReports: Array<{
        chapterId?: string | null;
        coherence: number;
        repetition: number;
        pacing: number;
        voice: number;
        engagement: number;
        overall: number;
        issues?: string | null;
      }>;
      totalReports?: number;
    }>
  >(`/novels/${id}/quality-report`);
  return data;
}

export async function generateChapterHook(
  id: string,
  payload?: {
    chapterId?: string;
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<
    ApiResponse<{
      chapterId: string;
      hook: string;
      nextExpectation: string;
    }>
  >(`/novels/${id}/hooks/generate`, payload ?? {});
  return data;
}

export async function optimizeNovelOutlinePreview(
  id: string,
  payload: {
    currentDraft: string;
    instruction: string;
    mode?: "full" | "selection";
    selectedText?: string;
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<DraftOptimizePreview>>(
    `/novels/${id}/outline/optimize-preview`,
    payload,
  );
  return data;
}

export async function optimizeNovelStructuredOutlinePreview(
  id: string,
  payload: {
    currentDraft: string;
    instruction: string;
    mode?: "full" | "selection";
    selectedText?: string;
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<DraftOptimizePreview>>(
    `/novels/${id}/structured-outline/optimize-preview`,
    payload,
  );
  return data;
}

export async function suggestBookFraming(payload: BookFramingSuggestionInput) {
  const { data } = await apiClient.post<ApiResponse<BookFramingSuggestion>>("/novels/framing/suggest", payload);
  return data;
}

export async function getNovelStoryMacroPlan(id: string) {
  const { data } = await apiClient.get<ApiResponse<StoryMacroPlan | null>>(`/novels/${id}/story-macro`);
  return data;
}

export async function decomposeNovelStory(
  id: string,
  payload: { provider?: LLMProvider; model?: string; temperature?: number } & { storyInput: string },
) {
  const { data } = await apiClient.post<ApiResponse<StoryMacroPlan>>(`/novels/${id}/story-macro/decompose`, payload);
  return data;
}

export async function buildNovelStoryConstraintEngine(
  id: string,
  payload?: { provider?: LLMProvider; model?: string; temperature?: number },
) {
  const { data } = await apiClient.post<ApiResponse<StoryMacroPlan>>(
    `/novels/${id}/story-macro/constraint/build`,
    payload ?? {},
  );
  return data;
}

export async function updateNovelStoryMacroPlan(
  id: string,
  payload: {
    storyInput?: string | null;
    expansion?: Partial<StoryExpansion>;
    decomposition?: Partial<StoryDecomposition>;
    constraints?: string[];
    lockedFields?: StoryMacroLocks;
  },
) {
  const { data } = await apiClient.patch<ApiResponse<StoryMacroPlan>>(`/novels/${id}/story-macro`, payload);
  return data;
}

export async function regenerateNovelStoryMacroField(
  id: string,
  field: StoryMacroField,
  payload?: { provider?: LLMProvider; model?: string; temperature?: number },
) {
  const { data } = await apiClient.post<ApiResponse<StoryMacroPlan>>(
    `/novels/${id}/story-macro/fields/${field}/regenerate`,
    payload ?? {},
  );
  return data;
}

export async function getNovelStoryMacroState(id: string) {
  const { data } = await apiClient.get<ApiResponse<StoryMacroState>>(`/novels/${id}/story-macro/state`);
  return data;
}

export async function updateNovelStoryMacroState(
  id: string,
  payload: Partial<StoryMacroState>,
) {
  const { data } = await apiClient.patch<ApiResponse<StoryMacroState>>(`/novels/${id}/story-macro/state`, payload);
  return data;
}

export async function getNovelWorld(id: string) {
  const { data } = await apiClient.get<ApiResponse<NovelWorldView>>(`/novels/${id}/novel-world`);
  return data;
}

export async function importNovelWorldFromLibrary(id: string, payload: NovelWorldImportInput) {
  const { data } = await apiClient.post<ApiResponse<NovelWorldView>>(`/novels/${id}/novel-world/import`, payload);
  return data;
}

export async function createManualNovelWorld(id: string, payload: NovelWorldManualInput) {
  const { data } = await apiClient.post<ApiResponse<NovelWorldView>>(`/novels/${id}/novel-world/manual`, payload);
  return data;
}

export async function generateNovelWorldFromTheme(id: string, payload: NovelWorldGenerateInput) {
  const { data } = await apiClient.post<ApiResponse<NovelWorldView>>(`/novels/${id}/novel-world/generate`, payload);
  return data;
}

export async function saveNovelWorldToLibrary(id: string, payload: NovelWorldSaveToLibraryInput) {
  const { data } = await apiClient.post<ApiResponse<NovelWorldView>>(`/novels/${id}/novel-world/save-to-library`, payload);
  return data;
}

export async function getNovelWorldSyncDiff(id: string) {
  const { data } = await apiClient.get<ApiResponse<NovelWorldSyncDiff>>(`/novels/${id}/novel-world/sync-diff`);
  return data;
}

export async function syncNovelWorldWithLibrary(id: string, payload: NovelWorldSyncInput) {
  const { data } = await apiClient.post<ApiResponse<NovelWorldSyncDiff>>(`/novels/${id}/novel-world/sync`, payload);
  return data;
}

export async function getNovelWorldSlice(id: string) {
  const { data } = await apiClient.get<ApiResponse<StoryWorldSliceView>>(`/novels/${id}/world-slice`);
  return data;
}

export async function refreshNovelWorldSlice(
  id: string,
  payload?: {
    storyInput?: string;
    builderMode?: StoryWorldSliceBuilderMode;
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<ApiResponse<StoryWorldSliceView>>(
    `/novels/${id}/world-slice/refresh`,
    payload ?? {},
  );
  return data;
}

export async function updateNovelWorldSliceOverrides(id: string, payload: StoryWorldSliceOverrides) {
  const { data } = await apiClient.put<ApiResponse<StoryWorldSliceView>>(`/novels/${id}/world-slice/overrides`, payload);
  return data;
}
