import { describe, expect, it } from "vitest";
import { decideFilter, DEFAULT_FILTER_RULES, type VisionAssessment } from "../../domain/dist/index.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LibraryDatabase } from "./index.js";

describe("LibraryDatabase", () => {
  it("records schema version 4 and creates a portable SQLite backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-backup-"));
    const databasePath = join(directory, "library.db");
    const backupPath = join(directory, "library-backup.db");
    const database = new LibraryDatabase(databasePath);
    try {
      expect(database.schemaVersion()).toBe(4);
      database.createCollection("Backup fixture");
      expect(database.backupTo(backupPath)).toBe(backupPath);
      const backup = new DatabaseSync(backupPath, { readOnly: true });
      expect((backup.prepare("SELECT COUNT(*) AS count FROM collections").get() as { count: number }).count).toBe(1);
      backup.close();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists explicit analysis jobs, reusable results, and suggestions", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-analysis-"));
    const imagePath = join(directory, "sample.png");
    writeFileSync(imagePath, "image-placeholder");
    const database = new LibraryDatabase(":memory:");
    try {
      database.importArtwork(imagePath);
      const [work] = database.listWorks();
      const scope = { type: "selected" as const, workIds: [work!.id] };
      expect(database.previewAnalysisScope(scope, "test-engine")).toMatchObject({ workCount: 1, assetCount: 1, cachedAssetCount: 0 });
      const job = database.createAnalysisJob(scope, "test-engine");
      expect(job).toMatchObject({ status: "queued", totalItems: 1, processedItems: 0 });
      expect(database.startAnalysisJob(job.id)).toBe(true);
      const item = database.claimNextAnalysisItem(job.id)!;
      const result: VisionAssessment = { status: "complete", engine: "test-engine", engineVersion: "1", labels: { blue_hair: 0.8, general: 0.99 }, elapsedMs: 2 };
      database.completeAnalysisItem(item, result, false);
      database.finishAnalysisJob(job.id, "completed");
      expect(database.getAnalysisJob(job.id)).toMatchObject({
        status: "completed",
        processedItems: 1,
        failedItems: 0,
        suggestions: [{ id: "label:blue_hair", workIds: [work!.id] }]
      });
      expect(database.previewAnalysisScope(scope, "test-engine").cachedAssetCount).toBe(1);

      const cancelled = database.createAnalysisJob(scope, "test-engine");
      expect(database.requestAnalysisCancellation(cancelled.id)).toBe(true);
      expect(database.getAnalysisJob(cancelled.id)?.status).toBe("cancelled");

      const interrupted = database.createAnalysisJob(scope, "test-engine");
      database.startAnalysisJob(interrupted.id);
      expect(database.recoverInterruptedAnalysisJobs()).toBe(1);
      expect(database.getAnalysisJob(interrupted.id)?.status).toBe("failed");
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("seeds an isolated metadata-only renderer benchmark", () => {
    const database = new LibraryDatabase(":memory:");
    database.seedBenchmarkWorks(10_000);
    const firstPage = database.queryWorks({ limit: 60 });
    expect(firstPage.total).toBe(10_000);
    expect(firstPage.items).toHaveLength(60);
    expect(firstPage.items[0]?.coverAsset).toBeNull();
    database.close();
  });

  it("queues available image assets for persistent thumbnail generation", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-thumbnails-"));
    const imagePath = join(directory, "cover.png");
    const thumbnailPath = join(directory, "cover.thumb.jpg");
    writeFileSync(imagePath, "image-placeholder");
    const database = new LibraryDatabase(":memory:");
    try {
      database.importArtwork(imagePath);
      const [asset] = database.listAssetsNeedingThumbnails(10);
      expect(asset?.path).toBe(imagePath);
      expect(asset?.thumbnailPath).toBeNull();
      expect(database.hasArtworkPath(imagePath)).toBe(true);
      expect(database.hasArtworkPath(thumbnailPath)).toBe(false);
      writeFileSync(thumbnailPath, "thumbnail-placeholder");
      expect(database.updateAssetThumbnail(asset!.id, thumbnailPath)).toBe(true);
      expect(database.hasArtworkPath(thumbnailPath)).toBe(true);
      expect(database.listAssetsNeedingThumbnails(10)).toEqual([]);
      expect(database.listWorks()[0]?.assets[0]?.thumbnailPath).toBe(thumbnailPath);
      rmSync(thumbnailPath, { force: true });
      expect(database.listAssetsNeedingThumbnails(10)[0]?.id).toBe(asset?.id);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
    database.clearRemoteImageReviews();
    expect(database.countRemoteImageReviews()).toBe(0);
    database.close();
  });

  it("round-trips custom element settings alongside built-in defaults", () => {
    const database = new LibraryDatabase(":memory:");
    database.saveElementFilterSetting({
      groupId: "custom-watermark",
      enabled: true,
      minimumConfidence: 0.55
    });
    expect(database.listElementFilterSettings()).toContainEqual({
      groupId: "custom-watermark",
      enabled: true,
      minimumConfidence: 0.55
    });
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
    expect(database.listWorks()).toMatchObject([
      {
        id: "pixiv:123",
        sourcePlatform: "pixiv",
        sourceWorkId: "123",
        artistId: "456",
        artistName: "画师",
        title: "三页作品",
        ownership: "managed",
        pageCount: 1,
        assets: [{ legacyArtworkId: artwork.id, pageIndex: 2 }]
      }
    ]);
    database.close();
  });

  it("dual-writes local imports and merges Pixiv pages into one work", () => {
    const database = new LibraryDatabase(":memory:");
    const first = database.importArtwork("E:\\gallery\\500_p0.jpg");
    expect(database.listWorks()[0]).toMatchObject({
      id: `local:${first.id}`,
      workType: "local",
      ownership: "external",
      pageCount: 1
    });

    database.saveArtworkSource(first.id, {
      platform: "pixiv",
      workId: "500",
      pageIndex: 0,
      authorId: "42",
      authorName: "作者",
      title: "双页作品"
    });
    const second = database.importArtwork("E:\\gallery\\500_p1.png");
    database.saveArtworkSource(second.id, {
      platform: "pixiv",
      workId: "500",
      pageIndex: 1,
      authorId: "42",
      authorName: "作者",
      title: "双页作品"
    });

    const works = database.listWorks();
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({
      id: "pixiv:500",
      title: "双页作品",
      pageCount: 2,
      ownership: "managed"
    });
    expect(works[0]?.assets.map((asset) => asset.pageIndex)).toEqual([0, 1]);
    expect(works[0]?.coverAssetId).toBe(works[0]?.assets[0]?.id);
    database.close();
  });

  it("keeps collection membership when a local page is promoted to a Pixiv work", () => {
    const database = new LibraryDatabase(":memory:");
    const artwork = database.importArtwork("E:\\gallery\\promoted.jpg");
    const collection = database.createCollection("稍后阅读");
    database.addArtworkToCollection(artwork.id, collection.id);
    expect(database.listWorks()[0]?.collectionIds).toEqual([collection.id]);

    database.saveArtworkSource(artwork.id, {
      platform: "pixiv",
      workId: "888",
      pageIndex: 0,
      authorId: "9",
      authorName: "作者九",
      title: "迁入作品"
    });

    expect(database.listWorks()).toMatchObject([
      { id: "pixiv:888", collectionIds: [collection.id] }
    ]);
    database.close();
  });

  it("queries works with database search, sorting, filters, and bounded pagination", () => {
    const database = new LibraryDatabase(":memory:");
    for (const [index, title] of ["Gamma", "Alpha", "Beta"].entries()) {
      const artwork = database.importArtwork(`E:\\gallery\\q${index}.jpg`);
      database.saveArtworkSource(artwork.id, {
        platform: "pixiv",
        workId: String(100 + index),
        pageIndex: 0,
        authorId: index === 1 ? "featured" : `artist-${index}`,
        authorName: index === 1 ? "Featured Artist" : `Artist ${index}`,
        title
      });
    }
    const collection = database.createCollection("精选");
    database.addWorkToCollection("pixiv:101", collection.id);
    expect(database.updateCollection(collection.id, "编辑精选", "说明")).toMatchObject({
      name: "编辑精选",
      description: "说明"
    });
    expect(database.updateWorkFavorite(["pixiv:101"], true)).toBe(1);

    const firstPage = database.queryWorks({ sortBy: "title", direction: "asc", limit: 2 });
    expect(firstPage).toMatchObject({ total: 3, totalPages: 3, offset: 0, limit: 2, hasMore: true });
    expect(firstPage.items.map((work) => work.title)).toEqual(["Alpha", "Beta"]);
    expect(database.queryWorks({ sortBy: "title", direction: "asc", offset: 2, limit: 2 }))
      .toMatchObject({ total: 3, offset: 2, hasMore: false, items: [{ title: "Gamma" }] });
    expect(database.queryWorks({ search: "featured" }).items.map((work) => work.id))
      .toEqual(["pixiv:101"]);
    expect(database.queryWorks({ collectionId: collection.id }).items[0]).toMatchObject({
      id: "pixiv:101",
      favorite: true,
      collectionIds: [collection.id],
      coverAsset: { pageIndex: 0 }
    });
    expect(database.getWork("pixiv:101")).toMatchObject({
      title: "Alpha",
      assets: [{ pageIndex: 0 }]
    });
    expect(database.getPreference("gallery.view")).toBeNull();
    database.setPreference("gallery.view", { sortBy: "title", density: "comfortable" });
    expect(database.getPreference("gallery.view")).toEqual({
      sortBy: "title",
      density: "comfortable"
    });
    database.removeWorkFromCollection("pixiv:101", collection.id);
    expect(database.getWork("pixiv:101")?.collectionIds).toEqual([]);
    database.addWorkToCollection("pixiv:101", collection.id);
    expect(database.deleteCollection(collection.id)).toBe(true);
    expect(database.getWork("pixiv:101")?.collectionIds).toEqual([]);
    expect(database.removeWorkFromIndex("pixiv:101")).toBe(true);
    expect(database.getWork("pixiv:101")).toBeNull();
    expect(database.listArtworks().some((artwork) => artwork.source?.workId === "101")).toBe(false);
    expect(database.queryWorks().total).toBe(2);
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

  it("migrates legacy pages idempotently and creates a pre-v2 backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-v2-migration-"));
    const path = join(directory, "library.db");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE artworks (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL COLLATE NOCASE UNIQUE,
          file_name TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          assessment_json TEXT,
          decision_json TEXT,
          source_platform TEXT,
          source_work_id TEXT,
          source_page_index INTEGER,
          author_id TEXT,
          author_name TEXT,
          work_title TEXT
        );
        CREATE TABLE collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          cover_artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE collection_artworks (
          collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
          PRIMARY KEY (collection_id, artwork_id)
        );
        INSERT INTO artworks VALUES
          ('a0', 'E:\\gallery\\900_p0.jpg', '900_p0.jpg', '2026-01-01T00:00:00.000Z', NULL, NULL, 'pixiv', '900', 0, '77', '迁移作者', '迁移双页作品'),
          ('a1', 'E:\\gallery\\900_p1.jpg', '900_p1.jpg', '2026-01-01T00:00:01.000Z', NULL, NULL, 'pixiv', '900', 1, '77', '迁移作者', '迁移双页作品'),
          ('local', 'E:\\gallery\\local.png', 'local.png', '2026-01-02T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        INSERT INTO collections VALUES ('c1', '收藏', '', 'a1', '2026-01-03T00:00:00.000Z');
        INSERT INTO collection_artworks VALUES ('c1', 'a0'), ('c1', 'a1');
      `);
      legacy.close();

      const firstOpen = new LibraryDatabase(path);
      const firstSnapshot = firstOpen.listWorks();
      expect(firstSnapshot).toHaveLength(2);
      expect(firstSnapshot.find((work) => work.id === "pixiv:900")).toMatchObject({
        pageCount: 2,
        collectionIds: ["c1"],
        assets: [{ pageIndex: 0 }, { pageIndex: 1 }]
      });
      firstOpen.close();

      expect(existsSync(`${path}.pre-v2.bak`)).toBe(true);
      const secondOpen = new LibraryDatabase(path);
      expect(secondOpen.listWorks()).toEqual(firstSnapshot);
      secondOpen.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("supports saved collection views and multi-collection combination queries (AND, OR, NOT)", () => {
    const database = new LibraryDatabase(":memory:");
    try {
      // 1. Create collections A, B, C
      const colA = database.createCollection("Collection A");
      const colB = database.createCollection("Collection B");
      const colC = database.createCollection("Collection C");

      // 2. Import 3 works
      // Work 1 belongs to A, B
      const art1 = database.importArtwork("E:\\gallery\\work1.jpg");
      database.addArtworkToCollection(art1.id, colA.id);
      database.addArtworkToCollection(art1.id, colB.id);

      // Work 2 belongs to A
      const art2 = database.importArtwork("E:\\gallery\\work2.jpg");
      database.addArtworkToCollection(art2.id, colA.id);

      // Work 3 belongs to B, C
      const art3 = database.importArtwork("E:\\gallery\\work3.jpg");
      database.addArtworkToCollection(art3.id, colB.id);
      database.addArtworkToCollection(art3.id, colC.id);

      // Helper to get titles
      const queryTitles = (query: import("@sanctuary/domain").WorkQuery) =>
        database.queryWorks(query).items.map((item) => item.title);

      // Test 1: Legacy single collection query compatibility
      const singleA = database.queryWorks({ collectionId: colA.id });
      expect(singleA.total).toBe(2);
      expect(singleA.items.map((i) => i.title).sort()).toEqual(["work1.jpg", "work2.jpg"]);

      // Test 2: all mode returns intersection (A AND B -> Work 1)
      const andResult = database.queryWorks({
        collectionIds: [colA.id, colB.id],
        collectionMatchMode: "all"
      });
      expect(andResult.total).toBe(1);
      expect(andResult.items[0]?.title).toBe("work1.jpg");

      // Test 3: any mode returns union without duplicates (A OR B -> Work 1, 2, 3)
      const orResult = database.queryWorks({
        collectionIds: [colA.id, colB.id],
        collectionMatchMode: "any"
      });
      expect(orResult.total).toBe(3);
      expect(orResult.items.map((i) => i.title).sort()).toEqual(["work1.jpg", "work2.jpg", "work3.jpg"]);

      // Test 4: excluded category (A EXCLUDE B -> Work 2)
      const excludeBResult = database.queryWorks({
        collectionIds: [colA.id],
        excludedCollectionIds: [colB.id]
      });
      expect(excludeBResult.total).toBe(1);
      expect(excludeBResult.items[0]?.title).toBe("work2.jpg");

      // Test 5: A OR B EXCLUDE C -> Work 1, 2
      const orExcludeCResult = database.queryWorks({
        collectionIds: [colA.id, colB.id],
        collectionMatchMode: "any",
        excludedCollectionIds: [colC.id]
      });
      expect(orExcludeCResult.total).toBe(2);
      expect(orExcludeCResult.items.map((i) => i.title).sort()).toEqual(["work1.jpg", "work2.jpg"]);

      // Test 6: Empty included + excluded (all works minus C -> Work 1, 2)
      const allMinusC = database.queryWorks({
        excludedCollectionIds: [colC.id]
      });
      expect(allMinusC.total).toBe(2);
      expect(allMinusC.items.map((i) => i.title).sort()).toEqual(["work1.jpg", "work2.jpg"]);

      // Test 7: Paged count consistency
      const paged = database.queryWorks({
        collectionIds: [colA.id, colB.id],
        collectionMatchMode: "any",
        limit: 1,
        offset: 0
      });
      expect(paged.total).toBe(3);
      expect(paged.items).toHaveLength(1);
      expect(paged.hasMore).toBe(true);

      // Test 8: SavedCollectionView CRUD & Persistence
      const viewDraft = {
        name: "A and B without C",
        matchMode: "all" as const,
        includedCollectionIds: [colA.id, colB.id],
        excludedCollectionIds: [colC.id]
      };
      const createdView = database.createSavedCollectionView(viewDraft);
      expect(createdView).toMatchObject({
        name: "A and B without C",
        matchMode: "all",
        includedCollectionIds: [colA.id, colB.id],
        excludedCollectionIds: [colC.id]
      });
      expect(database.listSavedCollectionViews()).toHaveLength(1);
      expect(database.getSavedCollectionView(createdView.id)).toMatchObject({
        name: "A and B without C"
      });

      // Update view
      const updatedView = database.updateSavedCollectionView(createdView.id, {
        name: "A and B renamed",
        matchMode: "any",
        includedCollectionIds: [colA.id],
        excludedCollectionIds: []
      });
      expect(updatedView?.name).toBe("A and B renamed");
      expect(updatedView?.matchMode).toBe("any");

      // Test 9: Deleting saved collection view does NOT delete works, files, or collections
      database.deleteSavedCollectionView(createdView.id);
      expect(database.listSavedCollectionViews()).toHaveLength(0);
      expect(database.listCollections()).toHaveLength(3);
      expect(database.queryWorks().total).toBe(3);

      // Test 10: SavedCollectionView works even if a referenced collection is deleted
      const viewWithDeleted = database.createSavedCollectionView({
        name: "View referencing soon deleted",
        matchMode: "any",
        includedCollectionIds: [colA.id, colC.id],
        excludedCollectionIds: []
      });
      database.deleteCollection(colC.id);
      expect(database.listCollections()).toHaveLength(2);
      const readView = database.getSavedCollectionView(viewWithDeleted.id);
      expect(readView?.includedCollectionIds).toContain(colC.id); // preserved in query_json
      // Querying with the surviving collections does not crash
      const queryWithMissing = database.queryWorks({
        ...(readView?.includedCollectionIds ? { collectionIds: readView.includedCollectionIds } : {}),
        ...(readView?.matchMode ? { collectionMatchMode: readView.matchMode } : {})
      });
      expect(queryWithMissing.total).toBe(2); // Work 1, Work 2 (having colA)
    } finally {
      database.close();
    }
  });

  it("stores, caches, queries, and audits vision evaluations and technical profiles", () => {
    const directory = mkdtempSync(join(tmpdir(), "sanctuary-vision-db-"));
    const img1 = join(directory, "img1.png");
    const img2 = join(directory, "img2.png");
    writeFileSync(img1, "content1");
    writeFileSync(img2, "content2");

    const database = new LibraryDatabase(":memory:");
    try {
      database.importArtwork(img1);
      database.importArtwork(img2);
      const [work1, work2] = database.listWorks();
      const asset1 = work1!.assets[0]!;
      const asset2 = work2!.assets[0]!;

      // 1. Preview and Create analysis job for technical_visual_v1
      const preview = database.previewAnalysisScope({ type: "all" }, "technical_visual_v1");
      expect(preview.workCount).toBe(2);
      expect(preview.assetCount).toBe(2);
      expect(preview.cachedAssetCount).toBe(0);

      const job = database.createAnalysisJob({ type: "all" }, "technical_visual_v1");
      expect(job.totalItems).toBe(2);

      // 2. Save evaluation results
      database.saveVisionEvaluationResult({
        id: "eval-1",
        workId: work1!.id,
        assetId: asset1.id,
        scope: "cover_asset",
        kind: "local_technical_profile",
        suiteId: "technical_visual_v1",
        suiteVersion: 1,
        status: "success",
        dimensions: [
          { key: "colorfulness", label: "色彩丰富度", score: 85.5 },
          { key: "tonal_range", label: "明暗跨度", score: 70.0 }
        ],
        evaluatorVersion: "0.1.0",
        preprocessingFingerprint: "none",
        assetVersion: asset1.updatedAt,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });

      database.saveVisionEvaluationResult({
        id: "eval-2",
        workId: work2!.id,
        assetId: asset2.id,
        scope: "cover_asset",
        kind: "local_technical_profile",
        suiteId: "technical_visual_v1",
        suiteVersion: 1,
        status: "success",
        dimensions: [
          { key: "colorfulness", label: "色彩丰富度", score: 35.0 },
          { key: "tonal_range", label: "明暗跨度", score: 40.0 }
        ],
        evaluatorVersion: "0.1.0",
        preprocessingFingerprint: "none",
        assetVersion: asset2.updatedAt,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });

      // 3. Cache retrieval and hit
      const cached = database.getCachedVisionEvaluation(
        asset1.id,
        "local_technical_profile",
        "technical_visual_v1",
        1,
        "none",
        asset1.updatedAt
      );
      expect(cached).not.toBeNull();
      expect(cached?.dimensions).toHaveLength(2);
      expect(cached?.dimensions[0]?.score).toBe(85.5);

      // Cache miss on different asset version
      const staleCheck = database.getCachedVisionEvaluation(
        asset1.id,
        "local_technical_profile",
        "technical_visual_v1",
        1,
        "none",
        "stale-timestamp"
      );
      expect(staleCheck).toBeNull();

      // 4. Query works by vision dimension score
      const vibrantWorks = database.queryWorksByVisionScore("colorfulness", 80, 100);
      expect(vibrantWorks).toEqual([work1!.id]);

      const allTonal = database.queryWorksByVisionScore("tonal_range", 30, 80);
      expect(allTonal).toHaveLength(2);

      // 5. List evaluations for work
      const evals = database.listVisionEvaluationsForWork(work1!.id);
      expect(evals).toHaveLength(1);
      expect(evals[0]?.id).toBe("eval-1");

      // 6. External request audit log
      database.recordExternalVisionRequest({
        id: "req-1",
        resultId: "eval-1",
        providerId: "openai",
        modelId: "gpt-4o",
        status: "success",
        latencyMs: 340
      });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

