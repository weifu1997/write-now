import type { ApiResponse } from "@write-now/shared/types/api";
import { clipStyleAnchorText } from "@write-now/shared/types/styleEngine";
import { apiClient } from "../client";

export interface StyleAnchorPassageView {
  id: string;
  sourceChapterId: string | null;
  source: string;
  text: string;
  pinned: boolean;
  createdAt: string;
}

export async function createStyleAnchor(
  novelId: string,
  chapterId: string,
  payload: { text: string; source: "adopted" | "manual" },
  options?: { silent?: boolean },
) {
  const text = clipStyleAnchorText(payload.text);
  if (!text) {
    return {
      success: true,
      data: { created: false, anchor: null },
      message: "范文内容为空。",
    };
  }
  const { data } = await apiClient.post<ApiResponse<{ created: boolean; anchor: { id: string } | null }>>(
    `/novels/${novelId}/chapters/${chapterId}/style-anchors`,
    { text, source: payload.source },
    options?.silent ? { silentErrorStatuses: [400] } : undefined,
  );
  return data;
}

export async function listStyleAnchors(novelId: string) {
  const { data } = await apiClient.get<ApiResponse<StyleAnchorPassageView[]>>(`/novels/${novelId}/style-anchors`);
  return data;
}

export async function deleteStyleAnchor(novelId: string, anchorId: string) {
  const { data } = await apiClient.delete<ApiResponse<{ deleted: boolean }>>(
    `/novels/${novelId}/style-anchors/${anchorId}`,
  );
  return data;
}
