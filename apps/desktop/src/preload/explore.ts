import { ipcRenderer, webFrame } from "electron";

type ReviewPriority = "visible" | "near";
type ReviewState = "allowed" | "blocked";

interface ReviewResultMessage {
  normalizedUrl: string;
  state: ReviewState;
  reasons: string[];
}

const REVIEW_STATE_ATTRIBUTE = "data-sanctuary-review-state";
const REVIEW_RELOAD_ATTRIBUTE = "data-sanctuary-review-reloaded";
const ARTWORK_PATH_PARTS = ["/img-master/", "/img-original/", "/custom-thumb/"];
const MAX_PAGE_OUTCOMES = 500;
const outcomes = new Map<string, ReviewResultMessage>();
const trackedImages = new Map<HTMLImageElement, string>();
const nearImages = new Map<string, Set<HTMLImageElement>>();
const visibleImages = new Map<string, Set<HTMLImageElement>>();
const submittedPriorities = new Map<string, ReviewPriority>();

const protectionCss = `
  img[src*="i.pximg.net"][src*="/img-master/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  img[src*="i.pximg.net"][src*="/img-original/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  img[src*="i.pximg.net"][src*="/custom-thumb/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  img[srcset*="i.pximg.net"][srcset*="/img-master/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  img[srcset*="i.pximg.net"][srcset*="/img-original/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  img[srcset*="i.pximg.net"][srcset*="/custom-thumb/"]:not([${REVIEW_STATE_ATTRIBUTE}="allowed"]),
  img[${REVIEW_STATE_ATTRIBUTE}="pending"] {
    filter: blur(32px) saturate(0.65) !important;
    opacity: 0.16 !important;
    transition: filter 180ms ease, opacity 180ms ease !important;
  }
  img[${REVIEW_STATE_ATTRIBUTE}="blocked"] {
    visibility: hidden !important;
    opacity: 0 !important;
  }
  img[${REVIEW_STATE_ATTRIBUTE}="allowed"] {
    filter: none !important;
    opacity: 1 !important;
    visibility: visible !important;
    transition: filter 180ms ease, opacity 180ms ease !important;
  }
`;

webFrame.insertCSS(protectionCss, { cssOrigin: "user" });

function normalizeArtworkUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, document.baseURI);
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

function artworkUrlForImage(image: HTMLImageElement): string | null {
  return normalizeArtworkUrl(
    image.currentSrc || image.getAttribute("src") || image.getAttribute("srcset")?.split(/[ ,]/)[0]
  );
}

function setMembership(
  collection: Map<string, Set<HTMLImageElement>>,
  url: string,
  image: HTMLImageElement,
  active: boolean
): void {
  const members = collection.get(url);
  if (active) {
    if (members) members.add(image);
    else collection.set(url, new Set([image]));
    return;
  }
  members?.delete(image);
  if (members?.size === 0) collection.delete(url);
}

function removeImageMembership(image: HTMLImageElement, url: string): void {
  setMembership(nearImages, url, image, false);
  setMembership(visibleImages, url, image, false);
  syncCandidate(url);
}

function syncCandidate(normalizedUrl: string): void {
  if (outcomes.has(normalizedUrl)) {
    submittedPriorities.delete(normalizedUrl);
    return;
  }
  const priority: ReviewPriority | null = visibleImages.has(normalizedUrl)
    ? "visible"
    : nearImages.has(normalizedUrl)
      ? "near"
      : null;
  const submitted = submittedPriorities.get(normalizedUrl);
  if (!priority) {
    if (submitted) {
      submittedPriorities.delete(normalizedUrl);
      ipcRenderer.send("explore:review-inactive", { normalizedUrl });
    }
    return;
  }
  if (submitted === priority) return;
  submittedPriorities.set(normalizedUrl, priority);
  ipcRenderer.send("explore:review-candidate", {
    normalizedUrl,
    priority,
    referrer: location.href
  });
}

function reloadFailedImage(image: HTMLImageElement, normalizedUrl: string): void {
  if (!image.complete || image.naturalWidth > 0) return;
  if (image.getAttribute(REVIEW_RELOAD_ATTRIBUTE) === normalizedUrl) return;
  const source = image.getAttribute("src");
  const sourceSet = image.getAttribute("srcset");
  if (!source && !sourceSet) return;
  image.setAttribute(REVIEW_RELOAD_ATTRIBUTE, normalizedUrl);
  if (source) image.removeAttribute("src");
  if (sourceSet) image.removeAttribute("srcset");
  queueMicrotask(() => {
    if (sourceSet) image.setAttribute("srcset", sourceSet);
    if (source) image.setAttribute("src", source);
  });
}

function applyOutcome(image: HTMLImageElement, outcome: ReviewResultMessage): void {
  image.setAttribute(REVIEW_STATE_ATTRIBUTE, outcome.state);
  intersectionObserver.unobserve(image);
  removeImageMembership(image, outcome.normalizedUrl);
  if (outcome.state === "allowed") reloadFailedImage(image, outcome.normalizedUrl);
}

function trackImage(image: HTMLImageElement): void {
  const nextUrl = artworkUrlForImage(image);
  const previousUrl = trackedImages.get(image);
  if (previousUrl && previousUrl !== nextUrl) {
    intersectionObserver.unobserve(image);
    removeImageMembership(image, previousUrl);
    trackedImages.delete(image);
    image.removeAttribute(REVIEW_STATE_ATTRIBUTE);
    image.removeAttribute(REVIEW_RELOAD_ATTRIBUTE);
  }
  if (!nextUrl) return;
  trackedImages.set(image, nextUrl);
  const outcome = outcomes.get(nextUrl);
  if (outcome) {
    applyOutcome(image, outcome);
    return;
  }
  image.setAttribute(REVIEW_STATE_ATTRIBUTE, "pending");
  intersectionObserver.observe(image);
}

const intersectionObserver = new IntersectionObserver(
  (entries) => {
    const changedUrls = new Set<string>();
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLImageElement)) continue;
      const image = entry.target;
      const normalizedUrl = trackedImages.get(image);
      if (!normalizedUrl || outcomes.has(normalizedUrl)) continue;
      const rect = entry.boundingClientRect;
      const visible =
        entry.isIntersecting &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      setMembership(nearImages, normalizedUrl, image, entry.isIntersecting);
      setMembership(visibleImages, normalizedUrl, image, visible);
      changedUrls.add(normalizedUrl);
    }
    for (const normalizedUrl of changedUrls) syncCandidate(normalizedUrl);
  },
  { rootMargin: "400px 0px", threshold: 0 }
);

function inspectNode(node: Node): void {
  if (node instanceof HTMLImageElement) trackImage(node);
  if (node instanceof HTMLSourceElement && node.parentElement instanceof HTMLPictureElement) {
    const image = node.parentElement.querySelector("img");
    if (image) trackImage(image);
  }
  if (!(node instanceof Element)) return;
  for (const image of node.querySelectorAll("img")) trackImage(image);
}

function untrackImage(image: HTMLImageElement): void {
  const normalizedUrl = trackedImages.get(image);
  if (!normalizedUrl) return;
  intersectionObserver.unobserve(image);
  trackedImages.delete(image);
  removeImageMembership(image, normalizedUrl);
}

function untrackNode(node: Node): void {
  if (node instanceof HTMLImageElement) untrackImage(node);
  if (!(node instanceof Element)) return;
  for (const image of node.querySelectorAll("img")) untrackImage(image);
}

function handleImageLifecycle(event: Event): void {
  if (event.target instanceof HTMLImageElement) trackImage(event.target);
}

function startObserver(): void {
  for (const image of document.images) trackImage(image);
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") inspectNode(mutation.target);
      else {
        for (const node of mutation.addedNodes) inspectNode(node);
        for (const node of mutation.removedNodes) untrackNode(node);
      }
    }
  });
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"]
  });
  document.addEventListener("load", handleImageLifecycle, true);
  document.addEventListener("error", handleImageLifecycle, true);
  window.addEventListener("pagehide", () => {
    mutationObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener("load", handleImageLifecycle, true);
    document.removeEventListener("error", handleImageLifecycle, true);
  }, { once: true });
}

ipcRenderer.on("explore:review-result", (_event, value: unknown) => {
  if (!value || typeof value !== "object") return;
  const candidate = value as Partial<ReviewResultMessage>;
  const normalizedUrl = normalizeArtworkUrl(candidate.normalizedUrl);
  if (
    !normalizedUrl ||
    (candidate.state !== "allowed" && candidate.state !== "blocked") ||
    !Array.isArray(candidate.reasons)
  ) {
    return;
  }
  const outcome: ReviewResultMessage = {
    normalizedUrl,
    state: candidate.state,
    reasons: candidate.reasons.filter((reason): reason is string => typeof reason === "string")
  };
  outcomes.delete(normalizedUrl);
  outcomes.set(normalizedUrl, outcome);
  while (outcomes.size > MAX_PAGE_OUTCOMES) {
    const oldestUrl = outcomes.keys().next().value as string | undefined;
    if (!oldestUrl) break;
    outcomes.delete(oldestUrl);
  }
  submittedPriorities.delete(normalizedUrl);
  for (const [image, imageUrl] of trackedImages) {
    if (imageUrl === normalizedUrl) applyOutcome(image, outcome);
  }
});

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startObserver, { once: true });
} else {
  startObserver();
}
