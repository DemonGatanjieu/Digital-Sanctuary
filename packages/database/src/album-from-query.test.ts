import { describe, expect, it } from "vitest";
import { LibraryDatabase } from "./index.js";

describe("saving a result as an album", () => {
  it("lists every matching work, then stores them with all their pages in one new album", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const pages = [0, 1].map((page) => {
        const image = database.importArtwork(`E:/f/77_p${page}.png`);
        database.saveArtworkSource(image.id, { platform: "pixiv", workId: "77", pageIndex: page, authorId: "1", authorName: "A", title: "双页" });
        return image;
      });
      const single = database.importArtwork("E:/f/single.png");
      database.importArtwork("E:/f/other.png");
      database.updateWorkFavorite(["pixiv:77", `local:${single.id}`], true);

      const ids = database.matchingWorkIdList({ favorite: true }, 100);
      expect(new Set(ids)).toEqual(new Set(["pixiv:77", `local:${single.id}`]));
      expect(database.matchingWorkIdList({}, 1)).toHaveLength(1);

      const { collection, workCount } = database.createAlbumFromWorks("  喜欢的  ", [...ids, "pixiv:missing"]);
      expect(collection.name).toBe("喜欢的");
      expect(workCount).toBe(2);
      expect(database.queryWorks({ collectionId: collection.id }).total).toBe(2);
      expect(database.listScopedArtworks({ kind: "collection", collectionId: collection.id }).map((page) => page.id).sort())
        .toEqual([...pages.map((page) => page.id), single.id].sort());
    } finally { database.close(); }
  });

  it("refuses empty names, empty selections and selections that no longer exist, leaving no album behind", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      const before = database.listCollections().length;
      expect(() => database.createAlbumFromWorks(" ", ["local:x"])).toThrow("名称");
      expect(() => database.createAlbumFromWorks("空", [])).toThrow("没有");
      expect(() => database.createAlbumFromWorks("失效", ["local:gone"])).toThrow("不在图库");
      expect(() => database.createAlbumFromWorks("坏 ID", ["E:/private"])).toThrow();
      expect(database.listCollections().length).toBe(before);
    } finally { database.close(); }
  });
});
