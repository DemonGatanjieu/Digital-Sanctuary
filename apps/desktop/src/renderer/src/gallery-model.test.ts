import { describe, expect, it } from "vitest";
import type { ArtistSummary, ArtworkRecord, ScopedArtworkRecord } from "@sanctuary/domain";
import {
  artworkLibraryWorkId,
  artworkWorkPages,
  buildAuthorGroups,
  inferPixivWorkFromFileName,
  authorDetailFromSummary,
  directoryScopeWorkQuery,
  galleryScopeKey,
  savedViewWorkQuery
} from "./gallery-model";

function artwork(id: string, fileName: string, source?: ArtworkRecord["source"]): ArtworkRecord {
  return { id, fileName, source } as ArtworkRecord;
}

describe("gallery model", () => {
  it("infers Pixiv work and page from managed file names", () => {
    expect(inferPixivWorkFromFileName("123456_p12.png")).toEqual({ workId: "123456", pageIndex: 12 });
    expect(inferPixivWorkFromFileName("avatar.png")).toBeNull();
  });

  it("groups legacy pages by author and work while restoring page order", () => {
    const pages = [
      artwork("page-2", "7788_p2.jpg", { platform: "pixiv", workId: "7788", pageIndex: 2, authorId: "42", authorName: "Luna", title: "Night" }),
      artwork("page-0", "7788_p0.jpg", { platform: "pixiv", workId: "7788", pageIndex: 0, authorId: "42", authorName: "Luna", title: "Night" }),
      artwork("page-1", "7788_p1.jpg", { platform: "pixiv", workId: "7788", pageIndex: 1, authorId: "42", authorName: "Luna", title: "Night" })
    ];

    const groups = buildAuthorGroups(pages, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.pageCount).toBe(3);
    expect(groups[0]?.works[0]?.pages.map((page) => page.id)).toEqual(["page-0", "page-1", "page-2"]);
  });

  it("opens only pages belonging to the selected work", () => {
    const pages = [
      artwork("other", "9999_p0.jpg"),
      artwork("second", "7788_p1.jpg"),
      artwork("first", "7788_p0.jpg")
    ];
    expect(artworkWorkPages(pages, pages[1]!).map((page) => page.id)).toEqual(["first", "second"]);
  });

  it("maps compatibility artwork pages back to their canonical library work", () => {
    const pixivPage = artwork("legacy-page", "7788_p2.jpg", {
      platform: "pixiv",
      workId: "7788",
      pageIndex: 2,
      authorId: "42",
      authorName: "Luna",
      title: "Night"
    });
    expect(artworkLibraryWorkId(pixivPage)).toBe("pixiv:7788");
    expect(artworkLibraryWorkId(artwork("local-page", "drawing.png"))).toBe("local:local-page");
    expect(artworkLibraryWorkId(artwork("legacy", "9900_p1.jpg"))).toBe("pixiv:9900");
  });

  it("uses canonical IDs and page indices even when a local filename looks like a Pixiv download", () => {
    const local = { ...artwork("legacy-local", "9900_p1.jpg"), libraryWorkId: "local:canonical", assetId: "local-asset", pageIndex: 7, thumbnailPath: null } as ScopedArtworkRecord;
    expect(artworkLibraryWorkId(local)).toBe("local:canonical");
    expect(artworkWorkPages([local, artwork("other", "9900_p0.jpg")], local)).toEqual([local]);
  });

  it("groups only current scope book pages while retaining authoritative work/page totals", () => {
    const summary = { key: "unknown", artistId: null, artist: null, name: "未归属画师", workCount: 4, pageCount: 8, bookPageCount: 2, previewAssets: [] } satisfies ArtistSummary;
    const pages = [2, 0].map((pageIndex) => ({ ...artwork(`legacy-${pageIndex}`, "9900_p0.jpg"), libraryWorkId: "local:actual", assetId: `asset-${pageIndex}`, pageIndex, thumbnailPath: null } as ScopedArtworkRecord));
    const detail = authorDetailFromSummary(summary, pages);
    expect(detail.workCount).toBe(4);
    expect(detail.pageCount).toBe(8);
    expect(detail.works).toHaveLength(1);
    expect(detail.works[0]?.pages.map((page) => page.id)).toEqual(["legacy-0", "legacy-2"]);
    expect(authorDetailFromSummary(summary, []).works).toEqual([]);
  });

  it("opens directory scopes from clean exact queries, including the unassigned author", () => {
    const sort = { sortBy: "title", direction: "asc" } as const;
    expect(directoryScopeWorkQuery({ kind: "artist", artistId: null }, sort, 60)).toEqual({ ...sort, unattributed: true, offset: 0, limit: 60 });
    expect(directoryScopeWorkQuery({ kind: "artist", artistId: "42" }, sort)).toEqual({ ...sort, artistId: "42", offset: 0 });
    expect(directoryScopeWorkQuery({ kind: "collection", collectionId: "album" }, sort)).toEqual({ ...sort, collectionId: "album", offset: 0 });
    expect(savedViewWorkQuery({ includedCollectionIds: ["a", "b"], matchMode: "all", excludedCollectionIds: ["draft"] }, sort)).toEqual({ ...sort, collectionIds: ["a", "b"], collectionMatchMode: "all", excludedCollectionIds: ["draft"], offset: 0 });
    expect(galleryScopeKey({ kind: "artist", artistId: null })).toBe("artist:null");
    expect(galleryScopeKey({ kind: "artist", artistId: "null" })).not.toBe(galleryScopeKey({ kind: "artist", artistId: null }));
    expect(galleryScopeKey({ kind: "work", workId: "local:actual" })).toBe("work:local:actual");
  });
});
