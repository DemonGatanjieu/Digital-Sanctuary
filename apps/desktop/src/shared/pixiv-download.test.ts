import { describe, expect, it } from "vitest";
import {
  completedDownloadPhase,
  hasContiguousPixivPages,
  parsePixivArtworkPages,
  parsePixivArtworkMetadata,
  parsePixivArtistProfile,
  parsePixivBookmarkPage,
  parsePixivPageContext,
  reachedConsecutiveFailureLimit,
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
      authorName: "画师",
      authorAvatarUrl: null
    });
  });

  it("accepts only Pixiv-hosted author avatars", () => {
    expect(parsePixivArtworkMetadata({
      error: false,
      body: {
        title: "夜色",
        userId: "456",
        userName: "画师",
        userUrl: "https://evil.example/avatar.jpg"
      }
    }, "123").authorAvatarUrl).toBeNull();
    expect(parsePixivArtworkMetadata({
      error: false,
      body: {
        title: "夜色",
        userId: "456",
        userName: "画师",
        userUrl: "https://i.pximg.net/user-profile/img/avatar.jpg"
      }
    }, "123").authorAvatarUrl).toBe("https://i.pximg.net/user-profile/img/avatar.jpg");
  });

  it("extracts the large avatar from the dedicated artist profile response", () => {
    expect(parsePixivArtistProfile({
      error: false,
      body: {
        userId: "456",
        name: "画师",
        image: "https://i.pximg.net/user-profile/img/avatar_50.png",
        imageBig: "https://i.pximg.net/user-profile/img/avatar_170.png"
      }
    }, "456")).toEqual({
      authorId: "456",
      authorName: "画师",
      avatarUrl: "https://i.pximg.net/user-profile/img/avatar_170.png"
    });
  });

  it("rejects mismatched artists and non-Pixiv profile images", () => {
    expect(() => parsePixivArtistProfile({
      error: false,
      body: { userId: "999", name: "错误作者" }
    }, "456")).toThrow("作者 ID");
    expect(parsePixivArtistProfile({
      error: false,
      body: {
        userId: "456",
        name: "画师",
        imageBig: "https://evil.example/avatar.png"
      }
    }, "456").avatarUrl).toBeNull();
  });
});

describe("download completion state", () => {
  it("distinguishes complete, partial, and failed batches", () => {
    expect(completedDownloadPhase(12, 0)).toBe("complete");
    expect(completedDownloadPhase(8, 4)).toBe("partial");
    expect(completedDownloadPhase(0, 4)).toBe("error");
  });

  it("accepts only a unique, zero-based contiguous page set", () => {
    expect(hasContiguousPixivPages([2, 0, 1])).toBe(true);
    expect(hasContiguousPixivPages([0, 2])).toBe(false);
    expect(hasContiguousPixivPages([0, 0])).toBe(false);
    expect(hasContiguousPixivPages([])).toBe(false);
  });

  it("opens the batch circuit at the configured failure threshold", () => {
    expect(reachedConsecutiveFailureLimit(4)).toBe(false);
    expect(reachedConsecutiveFailureLimit(5)).toBe(true);
    expect(reachedConsecutiveFailureLimit(3, 3)).toBe(true);
  });
});

describe("safePixivImageExtension", () => {
  it("prefers a supported response content type", () => {
    expect(safePixivImageExtension("https://i.pximg.net/file.jpg", "image/webp; charset=binary"))
      .toBe(".webp");
  });
});
