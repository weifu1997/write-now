import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { loginSiteAuth } from "@/api/siteAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSiteAuth } from "@/components/layout/SiteAuthContext";
import DesktopBrandMark from "@/components/layout/DesktopBrandMark";

export default function LoginPage() {
  const auth = useSiteAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth && (!auth.status.required || auth.status.authenticated)) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginSiteAuth({ username, password });
      if (!result.success || !result.data?.authenticated) {
        setError(result.error ?? "用户名或密码不正确。");
        return;
      }
      await auth?.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "用户名或密码不正确。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <DesktopBrandMark className="h-10 w-10 shrink-0 drop-shadow-none" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">登录后进入写作工作台</h1>
            <p className="mt-1 text-sm text-muted-foreground">这台服务器上的小说和设置需要登录后才能使用。</p>
          </div>
        </div>
        <form className="mt-8 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <div className="space-y-2">
            <label htmlFor="site-auth-username" className="text-sm font-medium text-foreground">
              用户名
            </label>
            <Input
              id="site-auth-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="site-auth-password" className="text-sm font-medium text-foreground">
              密码
            </label>
            <Input
              id="site-auth-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "正在进入…" : "进入工作台"}
          </Button>
        </form>
      </div>
    </div>
  );
}
