import { describe, expect, it } from "vitest";
import {
  parsePixivArtworkPages,
  parsePixivArtworkMetadata,
  parsePixivBookmarkPage,
  parsePixivPageContext,
  safePixivImageExtension
} from "./pixiv-download.js";

describe("parsePixivPageContext", () => {
  it("recognizes artwork and bookmark pages", () => {
    expect(parsePixivPageContext("https://www.pixiv.net/artworks/123456")).toEqual({
      kind: "artwork",
      artworkId: "123456",
      bookmarkUserId: ""
    });
    expect(
      parsePixivPageContext("https://www.pixiv.net/users/42/bookmarks/artworks")
    ).toEqual({ kind: "bookmarks", artworkId: "", bookmarkUserId: "42" });
  });

  it("rejects lookalike hosts", () => {
    expect(parsePixivPageContext("https://www.pixiv.net.example/artworks/123").kind)
      .toBe("other");
  });
});

describe("Pixiv response validation", () => {
  it("extracts original artwork pages", () => {
    expect(parsePixivArtworkPages({
      error: false,
      body: [
        { urls: { original: "https://i.pximg.net/img-original/example_p0.jpg" } },
        { urls: { original: "https://i.pximg.net/img-original/example_p1.png" } }
      ]
    })).toEqual([
      { index: 0, originalUrl: "https://i.pximg.net/img-original/example_p0.jpg" },
      { index: 1, originalUrl: "https://i.pximg.net/img-original/example_p1.png" }
    ]);
  });

  it("rejects non-Pixiv image hosts", () => {
    expect(() => parsePixivArtworkPages({
      error: false,
      body: [{ urls: { original: "https://evil.example/image.jpg" } }]
    })).toThrow(/原图地址/);
  });

  it("deduplicates bookmark artwork ids", () => {
    expect(parsePixivBookmarkPage({
      error: false,
      body: { total: 3, works: [{ id: "10" }, { id: 11 }, { id: "10" }] }
    })).toEqual({ artworkIds: ["10", "11"], total: 3 });
  });

  it("extracts author and work metadata", () => {
    expect(parsePixivArtworkMetadata({
      error: false,
      body: { title: "夜色", userId: "456", userName: "画师" }
    }, "123")).toEqual({
      artworkId: "123",
      title: "夜色",
      authorId: "456",
      authorName: "画师"
    });
  });
});

describe("safePixivImageExtension", () => {
  it("prefers a supported response content type", () => {
    expect(safePixivImageExtension("https://i.pximg.net/file.jpg", "image/webp; charset=binary"))
      .toBe(".webp");
  });
});
