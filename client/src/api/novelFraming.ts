import type { ApiResponse } from "@write-now/shared/types/api";
import type { BookFramingSuggestion, BookFramingSuggestionInput } from "@write-now/shared/types/novelFraming";
import { apiClient } from "./client";

export async function suggestBookFraming(payload: BookFramingSuggestionInput) {
  const { data } = await apiClient.post<ApiResponse<BookFramingSuggestion>>("/novels/framing/suggest", payload);
  return data;
}
