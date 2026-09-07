function getCurrentHref(): string {
  if (typeof window === "undefined") {
    return "http://localhost/";
  }
  return window.location.href;
}

export function resolveInternalNavigationTarget(
  targetUrl: string | null | undefined,
  currentHref = getCurrentHref(),
): string | null {
  const rawTarget = targetUrl?.trim();
  if (!rawTarget) {
    return null;
  }

  if (rawTarget.startsWith("#/")) {
    return rawTarget.slice(1);
  }

  if (rawTarget.startsWith("/") && !rawTarget.startsWith("//")) {
    return rawTarget;
  }

  try {
    const currentUrl = new URL(currentHref);
    const parsedTarget = new URL(rawTarget, currentUrl);
    if (parsedTarget.origin !== currentUrl.origin) {
      return null;
    }

    if (parsedTarget.hash.startsWith("#/")) {
      return parsedTarget.hash.slice(1);
    }

    return `${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`;
  } catch {
    return null;
  }
}

/**
 * 外部链接（抓取/厂商返回的数据）只放行 http/https；
 * javascript: 等危险协议原样渲染进 href 会在点击时于应用来源执行脚本。
 */
export function safeExternalUrl(targetUrl: string | null | undefined): string | null {
  const rawTarget = targetUrl?.trim();
  if (!rawTarget || !/^https?:\/\//i.test(rawTarget)) {
    return null;
  }
  try {
    const parsed = new URL(rawTarget);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
