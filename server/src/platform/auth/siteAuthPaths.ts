function normalizeRequestPath(originalUrl: string): string {
  const raw = originalUrl.split("?")[0] || "/";
  try {
    const pathname = new URL(raw, "http://write-now.local").pathname;
    if (!pathname.startsWith("/")) {
      return "/";
    }
    return pathname.replace(/\/+$/, "") || "/";
  } catch {
    return raw;
  }
}

export function isSiteAuthPublicPath(originalUrl: string): boolean {
  const path = normalizeRequestPath(originalUrl);
  if (path === "/api/health") {
    return true;
  }
  if (
    path === "/api/auth/status"
    || path === "/api/auth/login"
    || path === "/api/auth/logout"
  ) {
    return true;
  }
  return path === "/api/auto-director/channel-callbacks"
    || path.startsWith("/api/auto-director/channel-callbacks/");
}
