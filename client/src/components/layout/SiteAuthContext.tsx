import { createContext, useContext } from "react";
import type { SiteAuthStatus } from "@write-now/shared/types/api";

export interface SiteAuthContextValue {
  status: SiteAuthStatus;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const SiteAuthContext = createContext<SiteAuthContextValue | null>(null);

export function useSiteAuth(): SiteAuthContextValue | null {
  return useContext(SiteAuthContext);
}
