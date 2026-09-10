import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, LogOut } from "lucide-react";
import type { SiteAuthStatus } from "@write-now/shared/types/api";
import { getSiteAuthStatus, logoutSiteAuth } from "@/api/siteAuth";
import { setSiteAuthUnauthorizedHandler } from "@/api/siteAuthEvents";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import LoginPage from "@/pages/login/LoginPage";
import { SiteAuthContext, useSiteAuth, type SiteAuthContextValue } from "./SiteAuthContext";

export { useSiteAuth } from "./SiteAuthContext";

function SiteAuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/40">
          <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-foreground">正在确认访问权限</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          系统会在确认后进入写作工作台。
        </p>
      </div>
    </div>
  );
}

function SiteAuthUnconfiguredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-foreground">还不能打开工作台</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          这台服务器还没有设置访问账号。请在部署配置里填写 SITE_AUTH_USERNAME 和 SITE_AUTH_PASSWORD，然后重新启动服务。
        </p>
      </div>
    </div>
  );
}

export function SiteAuthLogoutButton(props: { className?: string; compact?: boolean }) {
  const auth = useSiteAuth();
  if (!auth?.status.required || !auth.status.authenticated) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={props.className}
      onClick={() => {
        void auth.logout();
      }}
    >
      <LogOut className="h-4 w-4" />
      {props.compact ? null : <span>退出</span>}
    </Button>
  );
}

export default function SiteAuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [forcedUnauthenticated, setForcedUnauthenticated] = useState(false);
  const statusQuery = useQuery({
    queryKey: queryKeys.siteAuth.status,
    queryFn: getSiteAuthStatus,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setSiteAuthUnauthorizedHandler(() => {
      setForcedUnauthenticated(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.siteAuth.status });
    });
    return () => {
      setSiteAuthUnauthorizedHandler(null);
    };
  }, [queryClient]);

  const remote = statusQuery.data?.data;
  const status = useMemo<SiteAuthStatus>(() => ({
    required: remote?.required ?? false,
    configured: remote?.configured ?? true,
    authenticated: forcedUnauthenticated ? false : Boolean(remote?.authenticated),
  }), [forcedUnauthenticated, remote]);

  const value = useMemo<SiteAuthContextValue>(() => ({
    status,
    refresh: async () => {
      setForcedUnauthenticated(false);
      await statusQuery.refetch();
    },
    logout: async () => {
      await logoutSiteAuth();
      setForcedUnauthenticated(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.siteAuth.status });
    },
  }), [queryClient, status, statusQuery]);

  if (statusQuery.isLoading && !remote) {
    return <SiteAuthLoadingScreen />;
  }

  if (statusQuery.isError && !remote) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-foreground">无法确认访问权限</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            写作服务已启动，但还读不到登录状态。请稍后重试。
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-6"
            onClick={() => {
              void statusQuery.refetch();
            }}
          >
            重新检查
          </Button>
        </div>
      </div>
    );
  }

  if (status.required && !status.configured) {
    return <SiteAuthUnconfiguredPage />;
  }

  if (status.required && !status.authenticated) {
    return (
      <SiteAuthContext.Provider value={value}>
        <LoginPage />
      </SiteAuthContext.Provider>
    );
  }

  return (
    <SiteAuthContext.Provider value={value}>
      {children}
    </SiteAuthContext.Provider>
  );
}
