import { describe, expect, it } from "vitest";
import { parseArtworkPageQuery, parseCollectionArtworkBatch, parseDirectoryPageQuery, parseGalleryScope } from "./gallery-directory-query.js";

describe("bounded gallery directory requests", () => {
  it("requires an explicit real scope, including the null author group", () => {
    expect(parseGalleryScope({ kind: "artist", artistId: null, path: "E:/private" })).toEqual({ kind: "artist", artistId: null });
    expect(parseGalleryScope({ kind: "work", workId: "pixiv:42" })).toEqual({ kind: "work", workId: "pixiv:42" });
    expect(parseGalleryScope({ kind: "collection", collectionId: "collection-1" })).toEqual({ kind: "collection", collectionId: "collection-1" });
    for (const input of [null, {}, [], { kind: "all" }, { kind: "artist" }, { kind: "artist", artistId: "" },
      { kind: "collection", collectionId: "../private" }, { kind: "work", workId: "E:/private.png" }]) expect(parseGalleryScope(input)).toBeNull();
  });
  it("limits saved-view computation and candidate pages without accepting SQL or paths", () => {
    expect(parseDirectoryPageQuery({ offset: -1, limit: 1000 })).toEqual({ offset: 0, limit: 12 });
    expect(parseDirectoryPageQuery({ offset: Infinity, limit: 1.5 })).toEqual({ offset: 0, limit: 12 });
    expect(parseArtworkPageQuery({ search: "  cloud  ", limit: 9999, excludedCollectionId: "collection:1", sql: "DROP TABLE works", path: "E:/private.png" }))
      .toEqual({ search: "cloud", limit: 200, offset: 0, excludedCollectionId: "collection:1" });
  });
  it("rejects the whole malformed batch and deduplicates valid page IDs", () => {
    expect(parseCollectionArtworkBatch(["artwork:1", "artwork:1", "artwork:2"], "collection:1"))
      .toEqual({ artworkIds: ["artwork:1", "artwork:2"], collectionId: "collection:1" });
    for (const input of [[], ["valid", 2], ["valid", "../private"], Array(501).fill("valid")]) expect(parseCollectionArtworkBatch(input, "collection:1")).toBeNull();
    expect(parseCollectionArtworkBatch(["valid"], "E:/private")).toBeNull();
  });
});
