import type { ApiResponse } from "@write-now/shared/types/api";
import type { LLMProvider } from "@write-now/shared/types/llm";
import { apiClient } from "./client";

export async function generateNovelChapterSummary(
  id: string,
  chapterId: string,
  payload?: {
    provider?: LLMProvider;
    model?: string;
    temperature?: number;
  },
) {
  const { data } = await apiClient.post<
    ApiResponse<{
      chapterId: string;
      summary: string;
      expectation: string;
    }>
  >(`/novels/${id}/chapters/${chapterId}/summary/generate`, payload ?? {});
  return data;
}
