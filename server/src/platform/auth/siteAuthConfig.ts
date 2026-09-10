import { createHmac } from "node:crypto";

function parseEnvFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}

export interface SiteAuthConfig {
  required: boolean;
  configured: boolean;
  username: string;
  password: string;
  secret: string;
  sessionTtlSeconds: number;
}

export const SITE_AUTH_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function deriveSessionSecret(username: string, password: string): string {
  return createHmac("sha256", "write-now-site-auth-v1")
    .update(`${username}\0${password}`)
    .digest("hex");
}

export function resolveSiteAuthConfig(env: NodeJS.ProcessEnv = process.env): SiteAuthConfig {
  const username = env.SITE_AUTH_USERNAME?.trim() ?? "";
  const password = env.SITE_AUTH_PASSWORD?.trim() ?? "";
  const configured = username.length > 0 && password.length > 0;
  const isDesktop = env.AI_NOVEL_RUNTIME?.trim() === "desktop";
  const defaultRequired = env.NODE_ENV === "production" && !isDesktop;
  const required = parseEnvFlag(env.SITE_AUTH_REQUIRED, defaultRequired);
  const secret = env.SITE_AUTH_SECRET?.trim() || deriveSessionSecret(username, password);
  return {
    required,
    configured,
    username,
    password,
    secret,
    sessionTtlSeconds: SITE_AUTH_SESSION_TTL_SECONDS,
  };
}
