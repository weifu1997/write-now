import { SITE_AUTH_UNAUTHENTICATED, SITE_AUTH_UNCONFIGURED } from "@write-now/shared/types/api";

export function isSiteAuthUnauthorized(payload: { message?: string } | undefined): boolean {
  return payload?.message === SITE_AUTH_UNAUTHENTICATED;
}

export function isSiteAuthUnconfigured(payload: { message?: string } | undefined): boolean {
  return payload?.message === SITE_AUTH_UNCONFIGURED;
}

export function isSiteAuthGateError(payload: { message?: string } | undefined): boolean {
  return isSiteAuthUnauthorized(payload) || isSiteAuthUnconfigured(payload);
}

export function notifySiteAuthUnauthorizedFromHttpStatus(status: number | undefined): boolean {
  if (status !== 401) {
    return false;
  }
  notifySiteAuthUnauthorized();
  return true;
}

let unauthorizedHandler: (() => void) | null = null;

export function setSiteAuthUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifySiteAuthUnauthorized(): void {
  unauthorizedHandler?.();
}
