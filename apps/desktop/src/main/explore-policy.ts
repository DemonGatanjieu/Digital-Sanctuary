export const PIXIV_HOME_URL = "https://www.pixiv.net/";
export const PIXIV_LOGIN_URL =
  "https://www.pixiv.net/login.php?ref=digital_sanctuary";
export const PIXIV_PASSWORD_SETUP_URL = "https://accounts.pixiv.net/password/change";
export const PIXIV_SESSION_PARTITION = "persist:pixiv";

export interface ExploreBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EXPLORE_AD_HOST_SUFFIXES = [
  "3lift.com",
  "adform.net",
  "adnxs.com",
  "amazon-adsystem.com",
  "authorizedvault.com",
  "bidswitch.net",
  "casalemedia.com",
  "criteo.com",
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "onetag-sys.com",
  "openx.net",
  "popin.cc",
  "pubmatic.com",
  "rubiconproject.com",
  "sharethrough.com",
  "simpli.fi",
  "smartadserver.com",
  "taboola.com",
  "temu.com",
  "undertone.com"
] as const;

export function isAllowedPixivNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "pixiv.net" || hostname.endsWith(".pixiv.net"))
    );
  } catch {
    return false;
  }
}

export function isPixivArtworkImageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "i.pximg.net") {
      return false;
    }
    return ["/img-master/", "/img-original/", "/custom-thumb/"].some((segment) =>
      url.pathname.includes(segment)
    );
  } catch {
    return false;
  }
}

export function shouldBlockExploreAdRequest(
  resourceType: string,
  requestUrl: string,
  topLevelUrl = ""
): boolean {
  if (isPixivLoginRecaptcha(requestUrl, topLevelUrl)) return false;
  try {
    const hostname = new URL(requestUrl).hostname.toLowerCase();
    if (EXPLORE_AD_HOST_SUFFIXES.some((suffix) => matchesHostname(hostname, suffix))) {
      return true;
    }
    return resourceType === "subFrame" && !isAllowedPixivNavigation(requestUrl);
  } catch {
    return resourceType === "subFrame";
  }
}

export function shouldBlockExploreResource(
  resourceType: string,
  requestUrl = "",
  topLevelUrl = ""
): boolean {
  if (isPixivLoginRecaptcha(requestUrl, topLevelUrl)) return false;
  return (
    resourceType === "media" ||
    shouldBlockExploreAdRequest(resourceType, requestUrl, topLevelUrl)
  );
}

export function shouldAllowPixivLoginPermission(
  permission: string,
  requestingUrl: string,
  topLevelUrl: string
): boolean {
  if (permission !== "storage-access" && permission !== "top-level-storage-access") {
    return false;
  }
  return isPixivLoginRecaptcha(requestingUrl, topLevelUrl);
}

export function parseExploreBounds(value: unknown): ExploreBounds | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExploreBounds>;
  if (
    !isFiniteCoordinate(candidate.x) ||
    !isFiniteCoordinate(candidate.y) ||
    !isFiniteCoordinate(candidate.width) ||
    !isFiniteCoordinate(candidate.height) ||
    candidate.width < 100 ||
    candidate.height < 100
  ) {
    return null;
  }
  return {
    x: Math.max(0, Math.round(candidate.x)),
    y: Math.max(0, Math.round(candidate.y)),
    width: Math.round(candidate.width),
    height: Math.round(candidate.height)
  };
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function matchesHostname(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function isPixivLoginRecaptcha(requestUrl: string, topLevelUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const topLevel = new URL(topLevelUrl);
    return (
      topLevel.protocol === "https:" &&
      topLevel.hostname === "accounts.pixiv.net" &&
      request.protocol === "https:" &&
      (request.hostname === "recaptcha.net" || request.hostname.endsWith(".recaptcha.net"))
    );
  } catch {
    return false;
  }
}
