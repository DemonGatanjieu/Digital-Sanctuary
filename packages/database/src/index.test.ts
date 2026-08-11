import { describe, expect, it } from "vitest";
import { decideFilter, DEFAULT_FILTER_RULES, type VisionAssessment } from "../../domain/dist/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LibraryDatabase } from "./index.js";

describe("LibraryDatabase", () => {
  it("persists an indexed artwork, assessment, and collection relation", () => {
    const database = new LibraryDatabase(":memory:");
    const artwork = database.importArtwork("E:\\gallery\\safe-image.png");
    const assessment: VisionAssessment = {
      status: "complete",
      engine: "test",
      engineVersion: "1",
      labels: { safe: 0.99 },
      elapsedMs: 1
    };
    database.saveAssessment(
      artwork.id,
      assessment,
      decideFilter(assessment, DEFAULT_FILTER_RULES)
    );
    const collection = database.createCollection("收藏");
    database.addArtworkToCollection(artwork.id, collection.id);

    const [stored] = database.listArtworks();
    expect(stored?.assessment?.engine).toBe("test");
    expect(stored?.decision?.action).toBe("allow");
    expect(stored?.collectionIds).toEqual([collection.id]);
    expect(stored?.source).toBeNull();

    expect(database.invalidateAssessmentsExcept("wd-swinv2-tagger-v3")).toBe(1);
    expect(database.listArtworks()[0]?.assessment).toBeNull();

    const bloodDefaults = database
      .listElementFilterSettings()
      .find((setting) => setting.groupId === "blood");
    expect(bloodDefaults).toMatchObject({ enabled: true, minimumConfidence: 0.35 });
    database.saveElementFilterSetting({
      groupId: "blood",
      enabled: false,
      minimumConfidence: 0.6
    });
    expect(database.listElementFilterSettings().find((setting) => setting.groupId === "blood"))
      .toEqual({ groupId: "blood", enabled: false, minimumConfidence: 0.6 });
    database.close();
  });

  it("persists complete remote reviews and rejects stale cache keys", () => {
    const database = new LibraryDatabase(":memory:");
    const assessment: VisionAssessment = {
      status: "complete",
      engine: "wd-swinv2-tagger-v3",
      engineVersion: "v3/test",
      labels: { safe: 0.99 },
      elapsedMs: 2
    };
    const review = {
      normalizedUrl: "https://i.pximg.net/img-original/1.png",
      contentHash: "abc",
      engine: assessment.engine,
      engineVersion: assessment.engineVersion,
      rulesFingerprint: "rules-a",
      assessment,
      decision: decideFilter(assessment, DEFAULT_FILTER_RULES),
      byteLength: 123,
      reviewedAt: "2026-08-11T00:00:00.000Z"
    };

    database.saveRemoteImageReview(review);
    expect(database.getRemoteImageReview(review)).toEqual(review);
    expect(database.getRemoteImageReview({ ...review, rulesFingerprint: "rules-b" })).toBeNull();
    expect(database.countRemoteImageReviews()).toBe(1);
    database.close();
  });

  it("does not persist failed remote reviews", () => {
    const database = new LibraryDatabase(":memory:");
    const assessment: VisionAssessment = {
      status: "error",
      engine: "test",
      engineVersion: "1",
      labels: {},
      elapsedMs: 1,
      error: "offline"
    };
    database.saveRemoteImageReview({
      normalizedUrl: "https://i.pximg.net/img-original/2.png",
      contentHash: null,
      engine: assessment.engine,
      engineVersion: assessment.engineVersion,
      rulesFingerprint: "rules-a",
      assessment,
      decision: decideFilter(assessment, DEFAULT_FILTER_RULES),
      byteLength: 0,
      reviewedAt: new Date().toISOString()
    });
    expect(database.countRemoteImageReviews()).toBe(0);
    database.close();
  });

  it("marks a user-curated artwork as trusted without retaining AI output", () => {
    const database = new LibraryDatabase(":memory:");
    const artwork = database.importArtwork("E:\\gallery\\favorite.png");
    const assessment: VisionAssessment = {
      status: "complete",
      engine: "test",
      engineVersion: "1",
      labels: { blood: 0.99 },
      elapsedMs: 1
    };
    database.saveAssessment(
      artwork.id,
      assessment,
      decideFilter(assessment, DEFAULT_FILTER_RULES)
    );
    expect(database.listArtworks()[0]?.decision?.action).toBe("hide");

    database.trustArtwork(artwork.id);
    const trusted = database.listArtworks()[0];
    expect(trusted?.assessment).toBeNull();
    expect(trusted?.decision?.action).toBe("allow");
    expect(trusted?.decision?.reasons).toEqual([]);
    database.close();
  });

  it("persists Pixiv author and work grouping metadata", () => {
    const database = new LibraryDatabase(":memory:");
    const artwork = database.importArtwork("E:\\gallery\\123_p2.jpg");
    database.saveArtworkSource(artwork.id, {
      platform: "pixiv",
      workId: "123",
      pageIndex: 2,
      authorId: "456",
      authorName: "画师",
      title: "三页作品"
    });
    expect(database.listArtworks()[0]?.source).toEqual({
      platform: "pixiv",
      workId: "123",
      pageIndex: 2,
      authorId: "456",
      authorName: "画师",
      title: "三页作品"
    });
    database.close();
  });

  it("persists artists and explicit collection covers", () => {
    const database = new LibraryDatabase(":memory:");
    const artwork = database.importArtwork("E:\\gallery\\cover.jpg");
    const collection = database.createCollection("封面测试");
    database.addArtworkToCollection(artwork.id, collection.id);
    database.updateCollectionCover(collection.id, artwork.id);
    database.importArtist({
      id: "456",
      name: "画师",
      avatarUrl: "https://i.pximg.net/user-profile/img/avatar.jpg",
      avatarLocalPath: "E:\\gallery\\avatars\\456.jpg",
      updatedAt: "2026-08-12T00:00:00.000Z"
    });

    expect(database.listCollections()[0]?.coverArtworkId).toBe(artwork.id);
    expect(database.listArtists()[0]).toEqual({
      id: "456",
      name: "画师",
      avatarUrl: "https://i.pximg.net/user-profile/img/avatar.jpg",
      avatarLocalPath: "E:\\gallery\\avatars\\456.jpg",
      updatedAt: "2026-08-12T00:00:00.000Z"
    });
    expect(database.hasAvatarPath("E:\\gallery\\avatars\\456.jpg")).toBe(true);
    database.close();
  });

  it("migrates a legacy artwork table before creating source indexes", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-legacy-"));
    const path = join(directory, "library.db");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE artworks (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL COLLATE NOCASE UNIQUE,
          file_name TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          assessment_json TEXT,
          decision_json TEXT
        );
      `);
      legacy.close();

      const database = new LibraryDatabase(path);
      const artwork = database.importArtwork("E:\\gallery\\legacy.png");
      database.saveArtworkSource(artwork.id, {
        platform: "pixiv",
        workId: "10",
        pageIndex: 0,
        authorId: "20",
        authorName: "旧库画师",
        title: "迁移作品"
      });
      expect(database.listArtworks()[0]?.source?.authorName).toBe("旧库画师");
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
