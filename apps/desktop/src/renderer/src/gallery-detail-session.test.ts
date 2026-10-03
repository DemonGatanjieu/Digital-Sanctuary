import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GalleryDetailSessionCache, capturePageAnchor, normalizeDetailSession, photobookAnchor, resolvePageAnchor, resolvePhotobookSpread,
  type ArtistDetailSession, type CollectionDetailSession, type GalleryDetailScope, type PageAnchor, type ScrollPosition
} from "./gallery-detail-session";

const collection = { kind: "collection" as const, collectionId: "album-1" };
const artist = { kind: "artist" as const, artistId: "artist-1" };
const pages = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `legacy-${index}`, assetId: `asset-${index}` }));
const scroll = (anchor: PageAnchor | null, scrollTop = 800, offsetPx = -24): ScrollPosition => ({ anchor, offsetPx, scrollTop });

describe("gallery detail page anchors", () => {
  it("uses asset identity before legacy fallback and follows surviving pages through reordering", () => {
    const items = pages(5), anchor = capturePageAnchor(items, 2);
    const reordered = [items[4]!, items[2]!, items[0]!, items[1]!, items[3]!];
    expect(resolvePageAnchor(reordered, anchor)).toBe(1);
    expect(resolvePageAnchor([{ id: "legacy-2", assetId: "different" }, { id: "renamed", assetId: "asset-2" }], anchor)).toBe(1);
    expect(resolvePageAnchor([{ id: "legacy-2", assetId: "replacement" }], anchor)).toBe(0);
    expect(resolvePageAnchor(items.map(({ id }) => ({ id })), anchor)).toBe(2);
  });

  it("falls back in current, previous, next order before clamping after removed pages", () => {
    const items = pages(5), anchor = capturePageAnchor(items, 2);
    expect(resolvePageAnchor([items[0]!, items[1]!, items[3]!, items[4]!], anchor)).toBe(1);
    expect(resolvePageAnchor([items[0]!, items[3]!, items[4]!], anchor)).toBe(1);
    expect(resolvePageAnchor([items[0]!, items[4]!], anchor)).toBe(1);
    expect(resolvePageAnchor([items[4]!], anchor)).toBe(0);
    expect(resolvePageAnchor([], anchor)).toBeNull();
    expect(resolvePageAnchor(items, null)).toBe(0);
  });

  it("captures only bounded real identifiers and safe fallback indices", () => {
    const items = pages(3), withPath = { ...items[1]!, path: "E:/private/image.png", thumbnailPath: "E:/private/thumb.png" };
    expect(capturePageAnchor([withPath], 0).current).toEqual({ assetId: "asset-1", legacyArtworkId: "legacy-1" });
    expect(JSON.stringify(capturePageAnchor([withPath], 0))).not.toContain("private");
    expect(capturePageAnchor(items, -10).fallbackIndex).toBe(0);
    expect(capturePageAnchor(items, 999).fallbackIndex).toBe(2);
    expect(capturePageAnchor(items, Number.NaN).fallbackIndex).toBe(0);
    expect(capturePageAnchor([], 999)).toEqual({ current: null, previous: null, next: null, fallbackIndex: 0 });
    expect(capturePageAnchor([{ id: "E:/private.png", assetId: "a".repeat(301) }], 0).current).toBeNull();
  });

  it("maps cover, paired and odd final photobook pages and resolves a moved spread by ID", () => {
    const items = pages(6);
    expect(photobookAnchor(items, 0).current?.assetId).toBe("asset-0");
    expect(photobookAnchor(items, 1).current?.assetId).toBe("asset-1");
    expect(photobookAnchor(items, 2).current?.assetId).toBe("asset-3");
    expect(photobookAnchor(items, 3).current?.assetId).toBe("asset-5");
    expect(photobookAnchor(items, 999).current?.assetId).toBe("asset-5");
    expect(photobookAnchor(items, -1).current?.assetId).toBe("asset-0");
    for (const spread of [0, 1, 2, 3]) expect(resolvePhotobookSpread(items, photobookAnchor(items, spread))).toBe(spread);
    const moved = [items[0]!, items[2]!, items[3]!, items[4]!, items[5]!, items[1]!];
    expect(resolvePhotobookSpread(moved, photobookAnchor(items, 1))).toBe(3);
    expect(resolvePhotobookSpread([], photobookAnchor([], 0))).toBe(0);
    expect(resolvePhotobookSpread(pages(1), photobookAnchor(items, 3))).toBe(0);
    expect(resolvePhotobookSpread(pages(4), photobookAnchor(pages(4), 2))).toBe(2);
  });
});

describe("gallery detail session boundary", () => {
  it("uses kind-specific defaults and drops foreign modes, arrays, paths and transient UI state", () => {
    const input = { kind: "artist", viewMode: "catalog", bookAnchor: capturePageAnchor(pages(4), 2),
      scrollPositions: { grid: scroll(null), catalog: scroll(null), artbook: scroll(null), aquarium: scroll(null) },
      tocPosition: scroll(null), items: pages(50), path: "E:/private", search: "draft", tocOpen: true, animation: { from: 1, to: 2 }, popup: {} };
    const normalized = normalizeDetailSession(collection, input);
    expect(normalized).toEqual({ kind: "collection", viewMode: "flip", bookAnchor: input.bookAnchor,
      scrollPositions: { grid: scroll(null), aquarium: scroll(null) }, tocPosition: scroll(null) });
    expect(normalizeDetailSession(artist, { viewMode: "grid", scrollPositions: { works: scroll(null), flip: scroll(null) } }))
      .toEqual({ kind: "artist", viewMode: "works", bookAnchor: null, scrollPositions: { works: scroll(null) }, tocPosition: null });
    expect(normalizeDetailSession(collection, null).viewMode).toBe("flip");
    expect(normalizeDetailSession(artist, []).viewMode).toBe("works");
  });

  it("bounds numbers and IDs, rejects class instances, and copies every nested anchor", () => {
    const maxId = "a".repeat(300), tooLong = "b".repeat(301);
    const input = { viewMode: "grid", bookAnchor: { current: { assetId: maxId, legacyArtworkId: tooLong, path: "private" },
      previous: { assetId: "E:/file.png", legacyArtworkId: "ok-id" }, next: { assetId: "" }, fallbackIndex: 90_000_000 },
      scrollPositions: { grid: { anchor: null, scrollTop: 90_000_000, offsetPx: -50_000 },
        aquarium: { anchor: null, scrollTop: Infinity, offsetPx: Number.NaN }, toc: { anchor: null, scrollTop: -20, offsetPx: 50_000 } },
      tocPosition: { anchor: null, scrollTop: 123.5, offsetPx: 6.25 } };
    const normalized = normalizeDetailSession(collection, input);
    expect(normalized.bookAnchor).toEqual({ current: { assetId: maxId }, previous: { legacyArtworkId: "ok-id" }, next: null, fallbackIndex: 10_000_000 });
    expect(normalized.scrollPositions.grid).toEqual(scroll(null, 10_000_000, -10_000));
    expect(normalized.scrollPositions.aquarium).toEqual(scroll(null, 0, 0));
    expect(normalized.scrollPositions.toc).toEqual(scroll(null, 0, 10_000));
    expect(normalized.tocPosition).toEqual(scroll(null, 123.5, 6.25));
    expect(normalized.bookAnchor).not.toBe(input.bookAnchor);
    expect(normalized.bookAnchor?.current).not.toBe(input.bookAnchor.current);
    class DomLike { scrollTop = 300; anchor = capturePageAnchor(pages(3), 1); }
    expect(normalizeDetailSession(collection, { tocPosition: new DomLike() }).tocPosition).toBeNull();
    expect(() => normalizeDetailSession({ kind: "collection", collectionId: "E:/path" }, null)).toThrow("Invalid gallery detail scope");
    expect(() => normalizeDetailSession({ kind: "artist", artistId: tooLong }, null)).toThrow("Invalid gallery detail scope");
  });

  it("deep-merges local patches and retains TOC position when a closed drawer or mode changes", () => {
    const cache = new GalleryDetailSessionCache(), anchor = capturePageAnchor(pages(4), 2), tocPosition = scroll(anchor, 200);
    cache.patch(collection, { viewMode: "grid", bookAnchor: anchor, scrollPositions: { grid: scroll(anchor), flip: scroll(null, 0) }, tocPosition });
    const changed = cache.patch(collection, { viewMode: "aquarium", scrollPositions: { aquarium: scroll(null, 600) } });
    expect(changed.viewMode).toBe("aquarium"); expect(changed.bookAnchor).toEqual(anchor); expect(changed.tocPosition).toEqual(tocPosition);
    expect(changed.scrollPositions).toEqual({ grid: scroll(anchor), flip: scroll(null, 0), aquarium: scroll(null, 600) });
    cache.patch(collection, { viewMode: "flip" });
    expect(cache.read(collection)?.tocPosition).toEqual(tocPosition);
    expect(cache.patch(collection, { bookAnchor: null, tocPosition: null })).toMatchObject({ bookAnchor: null, tocPosition: null });
  });

  it("isolates caller mutation on writes, patch results, and reads", () => {
    const cache = new GalleryDetailSessionCache(), anchor = capturePageAnchor(pages(4), 2), position = scroll(anchor);
    const result = cache.patch(collection, { bookAnchor: anchor, scrollPositions: { grid: position } });
    anchor.current!.assetId = "caller-mutation"; position.scrollTop = 999;
    result.bookAnchor!.current!.assetId = "result-mutation"; result.scrollPositions.grid!.scrollTop = 111;
    const firstRead = cache.read(collection)!;
    expect(firstRead.bookAnchor!.current!.assetId).toBe("asset-2"); expect(firstRead.scrollPositions.grid!.scrollTop).toBe(800);
    firstRead.bookAnchor!.next!.assetId = "read-mutation"; firstRead.scrollPositions.grid!.anchor!.previous = null;
    const secondRead = cache.read(collection)!;
    expect(secondRead.bookAnchor!.next!.assetId).toBe("asset-3"); expect(secondRead.scrollPositions.grid!.anchor!.previous?.assetId).toBe("asset-1");
  });

  it("separates same-ID scopes and the unknown artist from a literal null artist ID", () => {
    const cache = new GalleryDetailSessionCache(), unknown = { kind: "artist" as const, artistId: null }, knownNull = { kind: "artist" as const, artistId: "null" };
    cache.patch(collection, { viewMode: "grid" }); cache.patch({ kind: "artist", artistId: collection.collectionId }, { viewMode: "catalog" });
    cache.patch(unknown, { viewMode: "aquarium" }); cache.patch(knownNull, { viewMode: "artbook" });
    expect(cache.size).toBe(4); expect(cache.read(collection)?.viewMode).toBe("grid");
    expect(cache.read({ kind: "artist", artistId: collection.collectionId })?.viewMode).toBe("catalog");
    expect(cache.read(unknown)?.viewMode).toBe("aquarium"); expect(cache.read(knownNull)?.viewMode).toBe("artbook");
    cache.delete(unknown); expect(cache.read(unknown)).toBeNull(); expect(cache.read(knownNull)?.viewMode).toBe("artbook");
  });

  it("keeps at most 20 LRU sessions, refreshing reads and patches before eviction", () => {
    const cache = new GalleryDetailSessionCache(999);
    const scope = (index: number): GalleryDetailScope => ({ kind: "collection", collectionId: `album-${index}` });
    for (let index = 0; index < 20; index += 1) cache.patch(scope(index), {});
    cache.read(scope(0)); cache.patch(scope(1), { viewMode: "toc" }); cache.patch(scope(20), {});
    expect(cache.size).toBe(20); expect(cache.read(scope(2))).toBeNull();
    expect(cache.read(scope(0))).not.toBeNull(); expect(cache.read(scope(1))?.viewMode).toBe("toc");
    cache.delete(scope(1)); expect(cache.size).toBe(19);
    const small = new GalleryDetailSessionCache(2); small.patch(scope(0), {}); small.patch(scope(1), {}); small.read(scope(0)); small.patch(scope(2), {});
    expect(small.read(scope(1))).toBeNull(); expect(small.size).toBe(2);
  });

  it("types scope-specific snapshots and rejects cross-kind view modes", () => {
    const cache = new GalleryDetailSessionCache();
    expectTypeOf(cache.patch(collection, { viewMode: "grid" })).toEqualTypeOf<CollectionDetailSession>();
    expectTypeOf(cache.patch(artist, { viewMode: "catalog" })).toEqualTypeOf<ArtistDetailSession>();
    // @ts-expect-error An artist mode cannot be written to a known collection scope.
    cache.patch(collection, { viewMode: "catalog" });
    // @ts-expect-error A collection mode cannot be written to a known artist scope.
    cache.patch(artist, { viewMode: "flip" });
    expect(cache.read(collection)?.viewMode).toBe("flip"); expect(cache.read(artist)?.viewMode).toBe("works");
  });
});
