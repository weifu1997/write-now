import type { ApiResponse } from "@write-now/shared/types/api";
import type { AgentCatalog } from "@write-now/shared/types/agent";
import { apiClient } from "./client";

export async function getAgentCatalog() {
  const { data } = await apiClient.get<ApiResponse<AgentCatalog>>("/agent-catalog");
  return data;
}
