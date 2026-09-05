import type { ApiResponse } from "@write-now/shared/types/api";
import type { WritingFormula } from "@write-now/shared/types/writingFormula";
import { apiClient } from "./client";

export async function getWritingFormulas() {
  const { data } = await apiClient.get<ApiResponse<WritingFormula[]>>("/writing-formula");
  return data;
}

export async function getWritingFormulaDetail(id: string) {
  const { data } = await apiClient.get<ApiResponse<WritingFormula>>(`/writing-formula/${id}`);
  return data;
}

export async function deleteWritingFormula(id: string) {
  const { data } = await apiClient.delete<ApiResponse<null>>(`/writing-formula/${id}`);
  return data;
}
