export const PROTECTION_MODE_ATTRIBUTE = "data-sanctuary-protection-mode";
export const MIN_IMAGE_CONTAINER_SIZE = 60;
const ARTWORK_PATH_PARTS = ["/img-master/", "/img-original/", "/custom-thumb/"];

export type ExploreImageReviewPriority = "visible" | "near";

export function applyProtectionModeAttribute(
  root: HTMLElement | null,
  enabled: boolean
): boolean {
  if (!root) return false;
  root.setAttribute(PROTECTION_MODE_ATTRIBUTE, enabled ? "on" : "off");
  return true;
}

export function hasUsableImageContainerBox(element: HTMLElement | null): boolean {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > MIN_IMAGE_CONTAINER_SIZE && rect.height > MIN_IMAGE_CONTAINER_SIZE;
}

export function normalizeArtworkUrl(
  value: string | null | undefined,
  baseUri = typeof document !== "undefined" ? document.baseURI : "https://www.pixiv.net/"
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUri);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "i.pximg.net") {
      return null;
    }
    if (!ARTWORK_PATH_PARTS.some((part) => url.pathname.includes(part))) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function extractArtworkFileKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/(\d+_p\d+)(?:_[^/]+|\.[a-zA-Z0-9]+)$/);
  return match && match[1] ? match[1] : null;
}

export function findImageCardContainer(image: HTMLImageElement): HTMLElement {
  const card = typeof image.closest === "function"
    ? image.closest('figure, [role="presentation"], div[class*="gtm-"], a[href*="/artworks/"]')
    : null;
  if (card && typeof (card as HTMLElement).getBoundingClientRect === "function" && hasUsableImageContainerBox(card as HTMLElement)) {
    return card as HTMLElement;
  }
  let current: HTMLElement | null = image.parentElement;
  while (current && (typeof document === "undefined" || current !== document.body)) {
    if (hasUsableImageContainerBox(current)) return current;
    current = current.parentElement;
  }
  return image.parentElement || image;
}

export function measureEffectiveImagePriority(
  image: HTMLImageElement,
  viewportWidth: number,
  viewportHeight: number,
  nearMarginPx = 400
): ExploreImageReviewPriority | null {
  const imageRect = image.getBoundingClientRect();
  const rect = (imageRect.width >= 2 && imageRect.height >= 2)
    ? imageRect
    : findImageCardContainer(image).getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  if (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewportHeight &&
    rect.left < viewportWidth
  ) {
    return "visible";
  }

  if (
    rect.bottom > -nearMarginPx &&
    rect.right > -nearMarginPx &&
    rect.top < viewportHeight + nearMarginPx &&
    rect.left < viewportWidth + nearMarginPx
  ) {
    return "near";
  }

  return null;
}

