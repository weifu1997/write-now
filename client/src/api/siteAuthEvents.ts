import { SITE_AUTH_UNAUTHENTICATED } from "@write-now/shared/types/api";

export function isSiteAuthUnauthorized(payload: { message?: string } | undefined): boolean {
  return payload?.message === SITE_AUTH_UNAUTHENTICATED;
}

let unauthorizedHandler: (() => void) | null = null;

export function setSiteAuthUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifySiteAuthUnauthorized(): void {
  unauthorizedHandler?.();
}
