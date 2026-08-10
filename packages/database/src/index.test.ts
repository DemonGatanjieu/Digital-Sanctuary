import { describe, expect, it } from "vitest";
import { decideFilter, DEFAULT_FILTER_RULES, type VisionAssessment } from "../../domain/dist/index.js";
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
});
