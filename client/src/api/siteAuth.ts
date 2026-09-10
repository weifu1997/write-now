import type { ApiResponse, SiteAuthStatus } from "@write-now/shared/types/api";
import { apiClient } from "./client";

export type { SiteAuthStatus };
export { isSiteAuthUnauthorized, notifySiteAuthUnauthorized, setSiteAuthUnauthorizedHandler } from "./siteAuthEvents";

export async function getSiteAuthStatus() {
  const { data } = await apiClient.get<ApiResponse<SiteAuthStatus>>("/auth/status", {
    silentErrorStatuses: [401, 503],
  });
  return data;
}

export async function loginSiteAuth(payload: { username: string; password: string }) {
  const { data } = await apiClient.post<ApiResponse<SiteAuthStatus>>("/auth/login", payload, {
    silentErrorStatuses: [401, 429, 503],
  });
  return data;
}

export async function logoutSiteAuth() {
  const { data } = await apiClient.post<ApiResponse<SiteAuthStatus>>("/auth/logout");
  return data;
}
