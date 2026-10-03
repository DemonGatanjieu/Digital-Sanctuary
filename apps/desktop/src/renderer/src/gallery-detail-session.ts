import type { GalleryScope } from "@sanctuary/domain";
import { getPhotobookArtworkIndex, getPhotobookSpreadForArtworkIndex, getPhotobookTotalSpreads } from "./photobook-navigation";

export type GalleryDetailScope = Exclude<GalleryScope, { kind: "work" }>;
export type CollectionDetailViewMode = "flip" | "aquarium" | "grid" | "toc";
export type ArtistDetailViewMode = "works" | "artbook" | "aquarium" | "catalog";
export type DetailViewMode = CollectionDetailViewMode | ArtistDetailViewMode;

export interface PageRef { assetId?: string; legacyArtworkId?: string }
export interface PageAnchor {
  current: PageRef | null;
  previous: PageRef | null;
  next: PageRef | null;
  fallbackIndex: number;
}
export interface ScrollPosition { anchor: PageAnchor | null; offsetPx: number; scrollTop: number }
export interface AnchoredGalleryPage { id: string; assetId?: string | null }

interface DetailSessionFields<V extends DetailViewMode> {
  viewMode: V;
  bookAnchor: PageAnchor | null;
  scrollPositions: Partial<Record<V, ScrollPosition>>;
  tocPosition: ScrollPosition | null;
}
export interface CollectionDetailSession extends DetailSessionFields<CollectionDetailViewMode> { kind: "collection" }
export interface ArtistDetailSession extends DetailSessionFields<ArtistDetailViewMode> { kind: "artist" }
export type GalleryDetailSession = CollectionDetailSession | ArtistDetailSession;
export type GalleryDetailSessionFor<S extends GalleryDetailScope> = S extends { kind: "collection" } ? CollectionDetailSession : ArtistDetailSession;
type SessionPatch<T extends GalleryDetailSession> = Partial<Omit<T, "kind" | "scrollPositions">> & { scrollPositions?: T["scrollPositions"] };
export type GalleryDetailSessionPatch<S extends GalleryDetailScope = GalleryDetailScope> =
  S extends { kind: "collection" } ? SessionPatch<CollectionDetailSession> : SessionPatch<ArtistDetailSession>;

const collectionModes: readonly CollectionDetailViewMode[] = ["flip", "aquarium", "grid", "toc"];
const artistModes: readonly ArtistDetailViewMode[] = ["works", "artbook", "aquarium", "catalog"];
const MAX_POSITION = 10_000_000;

/** A session holds only bounded, copied identifiers and numbers; never gallery assets or DOM nodes. */
export function normalizeDetailSession<S extends GalleryDetailScope>(scope: S, value: unknown): GalleryDetailSessionFor<S> {
  detailScopeKey(scope);
  const source = record(value), modes: readonly DetailViewMode[] = scope.kind === "collection" ? collectionModes : artistModes;
  const viewMode = modes.includes(source?.viewMode as DetailViewMode) ? source!.viewMode as DetailViewMode : modes[0]!;
  const inputPositions = record(source?.scrollPositions), scrollPositions: Partial<Record<DetailViewMode, ScrollPosition>> = {};
  for (const mode of modes) {
    const position = normalizeScrollPosition(inputPositions?.[mode]);
    if (position) scrollPositions[mode] = position;
  }
  return { kind: scope.kind, viewMode, bookAnchor: normalizeAnchor(source?.bookAnchor), scrollPositions,
    tocPosition: normalizeScrollPosition(source?.tocPosition) } as GalleryDetailSessionFor<S>;
}

/** Returning to a surviving page takes precedence over an old numeric index after insertions or deletions. */
export function capturePageAnchor(items: readonly AnchoredGalleryPage[], index: number): PageAnchor {
  const currentIndex = items.length ? integer(index, 0, 0, Math.min(items.length - 1, MAX_POSITION)) : 0;
  return { current: pageRef(items[currentIndex]), previous: pageRef(items[currentIndex - 1]), next: pageRef(items[currentIndex + 1]), fallbackIndex: currentIndex };
}

export function resolvePageAnchor(items: readonly AnchoredGalleryPage[], anchor: PageAnchor | null | undefined): number | null {
  if (!items.length) return null;
  const normalized = normalizeAnchor(anchor);
  for (const reference of [normalized?.current, normalized?.previous, normalized?.next]) {
    if (!reference) continue;
    // Search the full asset identity first, so an earlier legacy-ID match cannot win accidentally.
    if (reference.assetId) {
      const index = items.findIndex((item) => item.assetId === reference.assetId);
      if (index >= 0) return index;
    }
    if (reference.legacyArtworkId) {
      const index = items.findIndex((item) => item.id === reference.legacyArtworkId);
      if (index >= 0) return index;
    }
  }
  return Math.min(normalized?.fallbackIndex ?? 0, items.length - 1);
}

/** Capture the first physical page of the settled spread, including the opening cover on the right. */
export function photobookAnchor(items: readonly AnchoredGalleryPage[], spread: number): PageAnchor {
  const settled = integer(spread, 0, 0, getPhotobookTotalSpreads(items.length) - 1);
  const index = getPhotobookArtworkIndex(settled, "left", items.length) ?? getPhotobookArtworkIndex(settled, "right", items.length) ?? 0;
  return capturePageAnchor(items, index);
}

export function resolvePhotobookSpread(items: readonly AnchoredGalleryPage[], anchor: PageAnchor | null | undefined): number {
  return getPhotobookSpreadForArtworkIndex(resolvePageAnchor(items, anchor) ?? 0);
}

/** Read and write both refresh LRU order. Returned snapshots cannot mutate the cached session. */
export class GalleryDetailSessionCache {
  readonly #sessions = new Map<string, GalleryDetailSession>();
  readonly #capacity: number;

  constructor(capacity = 20) { this.#capacity = integer(capacity, 20, 1, 20); }
  get size(): number { return this.#sessions.size; }

  read<S extends GalleryDetailScope>(scope: S): GalleryDetailSessionFor<S> | null {
    const key = detailScopeKey(scope), value = this.#sessions.get(key);
    if (!value) return null;
    this.#sessions.delete(key); this.#sessions.set(key, value);
    return normalizeDetailSession(scope, value);
  }

  patch<S extends GalleryDetailScope>(scope: S, patch: NoInfer<GalleryDetailSessionPatch<S>>): GalleryDetailSessionFor<S> {
    const key = detailScopeKey(scope), current = this.#sessions.get(key) ?? normalizeDetailSession(scope, null);
    const source = record(patch), incomingPositions = record(source?.scrollPositions);
    const modes: readonly DetailViewMode[] = scope.kind === "collection" ? collectionModes : artistModes;
    const positions: Partial<Record<DetailViewMode, unknown>> = { ...current.scrollPositions };
    for (const mode of modes) if (incomingPositions?.[mode] !== undefined) positions[mode] = incomingPositions[mode];
    const session = normalizeDetailSession(scope, {
      viewMode: source?.viewMode === undefined ? current.viewMode : source.viewMode,
      bookAnchor: source?.bookAnchor === undefined ? current.bookAnchor : source.bookAnchor,
      scrollPositions: positions,
      tocPosition: source?.tocPosition === undefined ? current.tocPosition : source.tocPosition
    });
    this.#sessions.delete(key); this.#sessions.set(key, session);
    while (this.#sessions.size > this.#capacity) this.#sessions.delete(this.#sessions.keys().next().value!);
    return normalizeDetailSession(scope, session);
  }

  delete(scope: GalleryDetailScope): void { this.#sessions.delete(detailScopeKey(scope)); }
}

function detailScopeKey(scope: GalleryDetailScope): string {
  if (scope?.kind === "collection" && validId(scope.collectionId)) return JSON.stringify(["collection", scope.collectionId]);
  if (scope?.kind === "artist" && (scope.artistId === null || validId(scope.artistId))) return JSON.stringify(["artist", scope.artistId]);
  throw new Error("Invalid gallery detail scope");
}
function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}
function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(value);
}
function normalizeRef(value: unknown): PageRef | null {
  const source = record(value);
  if (!source) return null;
  const assetId = validId(source.assetId) ? source.assetId : null, legacyArtworkId = validId(source.legacyArtworkId) ? source.legacyArtworkId : null;
  return assetId || legacyArtworkId ? { ...(assetId ? { assetId } : {}), ...(legacyArtworkId ? { legacyArtworkId } : {}) } : null;
}
function pageRef(item: AnchoredGalleryPage | undefined): PageRef | null {
  return item ? normalizeRef({ assetId: item.assetId, legacyArtworkId: item.id }) : null;
}
function normalizeAnchor(value: unknown): PageAnchor | null {
  const source = record(value);
  return source ? { current: normalizeRef(source.current), previous: normalizeRef(source.previous), next: normalizeRef(source.next),
    fallbackIndex: integer(source.fallbackIndex, 0, 0, MAX_POSITION) } : null;
}
function normalizeScrollPosition(value: unknown): ScrollPosition | null {
  const source = record(value);
  return source ? { anchor: normalizeAnchor(source.anchor), offsetPx: finite(source.offsetPx, 0, -10_000, 10_000), scrollTop: finite(source.scrollTop, 0, 0, MAX_POSITION) } : null;
}
function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function integer(value: unknown, fallback: number, min: number, max: number): number { return Math.trunc(finite(value, fallback, min, max)); }
