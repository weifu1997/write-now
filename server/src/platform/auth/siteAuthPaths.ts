export function isSiteAuthPublicPath(originalUrl: string): boolean {
  const path = originalUrl.split("?")[0] ?? "";
  if (path === "/api/health" || path.startsWith("/api/health/")) {
    return true;
  }
  if (
    path === "/api/auth/status"
    || path === "/api/auth/login"
    || path === "/api/auth/logout"
  ) {
    return true;
  }
  return path.startsWith("/api/auto-director/channel-callbacks");
}
