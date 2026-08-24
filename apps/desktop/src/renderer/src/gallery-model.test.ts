import { describe, expect, it } from "vitest";
import type { ArtworkRecord } from "@sanctuary/domain";
import {
  artworkLibraryWorkId,
  artworkWorkPages,
  buildAuthorGroups,
  inferPixivWorkFromFileName
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
});
