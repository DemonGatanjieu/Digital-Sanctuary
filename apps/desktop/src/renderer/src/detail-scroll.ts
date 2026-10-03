import type { ArtworkRecord, ScopedArtworkRecord } from "@sanctuary/domain";
import { capturePageAnchor, resolvePageAnchor, type ScrollPosition } from "./gallery-detail-session";

const PAGE_SELECTOR = "[data-gallery-page-id]";
type PageItem = { id: string; assetId?: string | null };

export function detailPageAttributes(item: ArtworkRecord): { "data-gallery-page-id": string; "data-gallery-page-kind": "asset" | "artwork" } {
  const assetId = (item as Partial<ScopedArtworkRecord>).assetId;
  return { "data-gallery-page-id": assetId || item.id, "data-gallery-page-kind": assetId ? "asset" : "artwork" };
}

function scrollIndex(content: HTMLElement, items: readonly PageItem[]) {
  const itemIndices = new Map<string, number>();
  items.forEach((item, index) => {
    itemIndices.set(`artwork:${item.id}`, index);
    if (item.assetId) itemIndices.set(`asset:${item.assetId}`, index);
  });
  const nodes = [...content.querySelectorAll<HTMLElement>(PAGE_SELECTOR)].flatMap((element) => {
    const index = itemIndices.get(`${element.dataset.galleryPageKind}:${element.dataset.galleryPageId}`);
    return index === undefined ? [] : [{ element, index }];
  });
  return { nodes, nodeByIndex: new Map(nodes.map((node) => [node.index, node.element])) };
}

/** getBoundingClientRect includes the theater's entry transform; scrollTop uses CSS pixels. */
function scrollGeometry(container: HTMLElement) {
  const bounds = container.getBoundingClientRect();
  const ratio = container.offsetHeight > 0 ? bounds.height / container.offsetHeight : 1;
  const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return { scale, viewportTop: bounds.top + container.clientTop * scale };
}

/** Capture the row nearest the viewport top; grid rows need only logarithmic layout reads. */
export function captureDetailScroll(container: HTMLElement, content: HTMLElement, items: readonly PageItem[]): ScrollPosition {
  return captureIndexedScroll(container, items, scrollIndex(content, items));
}

function captureIndexedScroll(container: HTMLElement, items: readonly PageItem[], indexData: ReturnType<typeof scrollIndex>): ScrollPosition {
  if (!items.length) return { anchor: null, offsetPx: 0, scrollTop: container.scrollTop };
  const { nodes } = indexData;
  const { scale, viewportTop: top } = scrollGeometry(container);
  let low = 0, high = nodes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (nodes[middle]!.element.getBoundingClientRect().top < top) low = middle + 1;
    else high = middle;
  }
  let index = Math.max(0, low - 1);
  const rowTop = nodes[index]?.element.getBoundingClientRect().top;
  while (index > 0 && nodes[index - 1]!.element.getBoundingClientRect().top === rowTop) index -= 1;
  const element = nodes[index]?.element;
  const itemIndex = nodes[index]?.index ?? -1;
  return { anchor: itemIndex < 0 ? null : capturePageAnchor(items, itemIndex),
    offsetPx: element ? (element.getBoundingClientRect().top - top) / scale : 0, scrollTop: container.scrollTop };
}

export function restoreDetailScroll(container: HTMLElement, content: HTMLElement, items: readonly PageItem[], position: ScrollPosition | null): void {
  restoreIndexedScroll(container, items, position, scrollIndex(content, items));
}

function restoreIndexedScroll(container: HTMLElement, items: readonly PageItem[], position: ScrollPosition | null, indexData: ReturnType<typeof scrollIndex>, resolvedIndex?: number | null): void {
  const index = resolvedIndex === undefined ? position?.anchor ? resolvePageAnchor(items, position.anchor) : null : resolvedIndex;
  const element = index === null ? undefined : indexData.nodeByIndex.get(index);
  const { scale, viewportTop } = scrollGeometry(container);
  const top = element && position
    ? container.scrollTop + (element.getBoundingClientRect().top - viewportTop) / scale - position.offsetPx
    : position?.scrollTop ?? 0;
  container.scrollTo({ top: Math.max(0, Math.min(Math.max(0, container.scrollHeight - container.clientHeight), top)), behavior: "instant" });
}

export interface DetailScrollBinding { capture(): ScrollPosition; dispose(): void }
interface FrameScheduler { request(callback: FrameRequestCallback): number; cancel(id: number): void }
const INTERACTIVE_TARGETS = "button, a[href], input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='button']";
function interactiveTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return typeof element?.closest === "function" && Boolean(element.closest(INTERACTIVE_TARGETS));
}

/** At most three restoration frames account for newly materialized content-visibility rows. */
export function bindDetailScroll(
  container: HTMLElement, content: HTMLElement, items: readonly PageItem[], position: ScrollPosition | null,
  onChange: (position: ScrollPosition) => void,
  frames: FrameScheduler = { request: (callback) => window.requestAnimationFrame(callback), cancel: (id) => window.cancelAnimationFrame(id) }
): DetailScrollBinding {
  const indexData = scrollIndex(content, items);
  const resolvedIndex = position?.anchor ? resolvePageAnchor(items, position.anchor) : null;
  const restorePosition = position?.anchor
    ? { ...position, anchor: resolvedIndex === null ? null : capturePageAnchor(items, resolvedIndex) }
    : position;
  let alive = true, restoring = true, restoreFrame: number | null = null, captureFrame: number | null = null;
  let ownedTop = container.scrollTop, ownedHeight = container.scrollHeight;
  let restorePasses = 0;
  const cancelRestore = () => {
    restoring = false;
    if (restoreFrame !== null) frames.cancel(restoreFrame);
    restoreFrame = null;
  };
  const detectUserScroll = () => {
    if (!restoring || Math.abs(container.scrollTop - ownedTop) < 0.5) return;
    // Browser scroll anchoring during row materialization is followed by another bounded verification.
    if (container.scrollHeight !== ownedHeight) { ownedTop = container.scrollTop; ownedHeight = container.scrollHeight; }
    else cancelRestore();
  };
  const capture = () => {
    detectUserScroll();
    return restoring && restorePosition ? restorePosition : captureIndexedScroll(container, items, indexData);
  };
  const publish = () => { if (alive) onChange(capture()); };
  const onScroll = () => {
    // Ignore queued events from our own restoration, but honor a new scroll intention.
    detectUserScroll();
    if (captureFrame === null) captureFrame = frames.request(() => { captureFrame = null; publish(); });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || interactiveTarget(event.target)) return;
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelRestore();
  };
  const onPointerDown = (event: Event) => { if (event.target === container) cancelRestore(); };
  const onTouchStart = (event: Event) => { if (!interactiveTarget(event.target)) cancelRestore(); };
  container.addEventListener("scroll", onScroll, { passive: true });
  container.addEventListener("wheel", cancelRestore, { passive: true });
  container.addEventListener("pointerdown", onPointerDown, { passive: true });
  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("keydown", onKeyDown);
  const restore = () => {
    restoreFrame = null;
    if (!alive || !restoring) return;
    detectUserScroll();
    if (!restoring) return;
    restoreIndexedScroll(container, items, restorePosition, indexData, resolvedIndex);
    ownedTop = container.scrollTop; ownedHeight = container.scrollHeight;
    restorePasses += 1;
    if (restorePasses < 3) restoreFrame = frames.request(restore);
    else restoring = false;
  };
  restoreFrame = frames.request(restore);
  return { capture, dispose() {
    if (!alive) return;
    alive = false; cancelRestore();
    if (captureFrame !== null) frames.cancel(captureFrame);
    container.removeEventListener("scroll", onScroll);
    container.removeEventListener("wheel", cancelRestore);
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("keydown", onKeyDown);
  } };
}
