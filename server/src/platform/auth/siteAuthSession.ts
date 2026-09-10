import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const SITE_AUTH_COOKIE_NAME = "wn_site_session";
export const SITE_AUTH_OPERATOR_ID = "site-operator";

export function secretsEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function createSessionToken(
  secret: string,
  now = Date.now(),
  ttlSeconds: number,
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = String(exp);
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): boolean {
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return false;
  }
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!secretsEqual(signature, expected)) {
    return false;
  }
  const exp = Number(payload);
  return Number.isFinite(exp) && exp * 1000 > now;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (forwardedValue?.split(",")[0]?.trim() === "https") {
    return true;
  }
  return req.protocol === "https";
}

export function applySessionCookie(
  res: Response,
  token: string,
  ttlSeconds: number,
  secure: boolean,
): void {
  const parts = [
    `${SITE_AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  const parts = [
    `${SITE_AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function readValidSessionToken(req: Request, secret: string, now = Date.now()): string | null {
  const token = readCookie(req, SITE_AUTH_COOKIE_NAME);
  if (!token || !verifySessionToken(token, secret, now)) {
    return null;
  }
  return token;
}
