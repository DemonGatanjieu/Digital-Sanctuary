import { describe, expect, it } from "vitest";
import { parseWorkId, parseWorkIds, parseWorkQuery, parseWorkViewRequest } from "./library-query.js";

describe("parseWorkQuery", () => {
  it("keeps supported fields and bounds pagination", () => {
    expect(parseWorkQuery({
      search: "  cloud  ",
      workType: "manga",
      collectionIds: ["collection:a", "collection:a", "collection:b"],
      collectionMatchMode: "all",
      excludedCollectionIds: ["collection:c"],
      sortBy: "title",
      direction: "asc",
      limit: 9_999,
      offset: -10
    })).toEqual({
      search: "cloud",
      workType: "manga",
      collectionIds: ["collection:a", "collection:b"],
      collectionMatchMode: "all",
      excludedCollectionIds: ["collection:c"],
      sortBy: "title",
      direction: "asc",
      limit: 200,
      offset: 0
    });
  });

  it("drops unsupported renderer input", () => {
    expect(parseWorkQuery({ ownership: "managed" })).toEqual({ ownership: "managed", limit: 60, offset: 0 });
    expect(parseWorkQuery({ ownership: "external" })).toEqual({ ownership: "external", limit: 60, offset: 0 });
    expect(parseWorkQuery({ ownership: "any OR 1=1" })).toEqual({ limit: 60, offset: 0 });
    expect(parseWorkQuery({ workType: "anything", sortBy: "sql", direction: "sideways" }))
      .toEqual({ limit: 60, offset: 0 });
    expect(parseWorkQuery({
      collectionIds: ["valid", 42],
      excludedCollectionIds: Array.from({ length: 51 }, (_, index) => String(index)),
      collectionMatchMode: "neither"
    })).toEqual({ limit: 60, offset: 0 });
    expect(parseWorkId(42)).toBeNull();
    expect(parseWorkId("pixiv:42")).toBe("pixiv:42");
    expect(parseWorkIds(["pixiv:42", "pixiv:42", "local:1"])).toEqual(["pixiv:42", "local:1"]);
    expect(parseWorkIds([])).toBeNull();
  });

  it("keeps explicit boolean filters and recently viewed sorting without coercing strings", () => {
    expect(parseWorkQuery({ unattributed: true })).toEqual({ limit: 60, offset: 0, unattributed: true });
    expect(parseWorkQuery({ unattributed: "true" })).toEqual({ limit: 60, offset: 0 });
    expect(parseWorkQuery({ favorite: false, uncollected: true, viewedOnly: true, sortBy: "lastViewedAt" }))
      .toEqual({ limit: 60, offset: 0, favorite: false, uncollected: true, viewedOnly: true, sortBy: "lastViewedAt" });
    expect(parseWorkQuery({ favorite: "true", uncollected: 1, viewedOnly: null }))
      .toEqual({ limit: 60, offset: 0 });
  });

  it("accepts only bounded local IDs for view recording and discards caller timestamps or paths", () => {
    expect(parseWorkViewRequest({ workId: "pixiv:42", assetId: "asset-123", path: "E:/private/file.png", viewedAt: "tomorrow" }))
      .toEqual({ workId: "pixiv:42", assetId: "asset-123" });
    for (const target of [null, {}, { workId: "pixiv:42", assetId: 1 }, { workId: "pixiv:42", assetId: "E:/private/file.png" },
      { workId: "../work", assetId: "asset" }, { workId: " work", assetId: "asset" },
      { workId: "work\u0000", assetId: "asset" }, { workId: "work", assetId: "x".repeat(301) }]) {
      expect(parseWorkViewRequest(target)).toBeNull();
    }
  });
});
