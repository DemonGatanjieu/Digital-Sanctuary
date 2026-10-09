import { describe, expect, it } from "vitest";
import type { WorkQuery } from "@sanctuary/domain";
import { applyWorkPreset, clearWorkCollectionFilters, getWorkPreset, hasWorkFilters, workEmptyMessage } from "./work-presets";

const normalSort = { sortBy: "title", direction: "asc" } as const;
const query: WorkQuery = { search: "月", workType: "manga", collectionIds: ["night"], collectionMatchMode: "all", excludedCollectionIds: ["draft"], sortBy: "title", direction: "asc", offset: 100, limit: 50 };

describe("work presets", () => {
  it("preserves ownership across presets and reports empty scoped results honestly", () => {
    expect(applyWorkPreset({ ownership: "external" }, "favorites", normalSort)).toMatchObject({ ownership: "external", favorite: true });
    expect(hasWorkFilters({ ownership: "managed" })).toBe(true);
    expect(workEmptyMessage({ ownership: "external" }).title).toBe("没有匹配的作品");
  });
  it("treats element conditions as filters, so an empty result never looks like an empty library", () => {
    expect(hasWorkFilters({ elements: { exclude: ["blood"] } })).toBe(true);
    expect(hasWorkFilters({ elements: { blocked: true } })).toBe(true);
    expect(workEmptyMessage({ elements: { include: ["cat_ears"] } }).description).toContain("未识别的图片");
  });
  it("composes each shortcut with the user's search, type and album scope", () => {
    for (const preset of ["favorites", "uncollected", "recent"] as const) {
      const next = applyWorkPreset(query, preset, normalSort);
      expect(next).toMatchObject({ search: "月", workType: "manga", collectionIds: ["night"], excludedCollectionIds: ["draft"], offset: 0, limit: 50 });
      expect(getWorkPreset(next)).toBe(preset);
    }
  });

  it("recent temporarily orders viewed works and leaving it restores the prior sort", () => {
    const recent = applyWorkPreset(query, "recent", normalSort);
    expect(recent).toMatchObject({ viewedOnly: true, sortBy: "lastViewedAt", direction: "desc" });
    for (const preset of ["all", "favorites", "uncollected"] as const) {
      expect(applyWorkPreset(recent, preset, normalSort)).toMatchObject(normalSort);
      expect(applyWorkPreset(recent, preset, normalSort).viewedOnly).toBeUndefined();
    }
  });

  it("switching presets removes all prior preset conditions, including explicit false favorite", () => {
    const mixed = { ...query, favorite: false, viewedOnly: true, uncollected: true };
    expect(applyWorkPreset(mixed, "favorites", normalSort)).toEqual({ ...query, offset: 0, favorite: true });
    const all = applyWorkPreset(mixed, "all", normalSort);
    expect(all.favorite).toBeUndefined();
    expect(all.uncollected).toBeUndefined();
    expect(all.viewedOnly).toBeUndefined();
  });

  it("returning to all works clears albums and presets without losing search or type", () => {
    const all = clearWorkCollectionFilters(applyWorkPreset({ ...query, collectionId: "extra", viewedOnly: true, sortBy: "lastViewedAt" }, "all", normalSort));
    expect(all).toEqual({ search: "月", workType: "manga", ...normalSort, offset: 0, limit: 50 });
    expect(hasWorkFilters({ favorite: true })).toBe(true);
    expect(hasWorkFilters({ viewedOnly: true })).toBe(true);
    expect(hasWorkFilters({ sortBy: "savedAt" })).toBe(false);
  });

  it("distinguishes no history from no match within an album or search", () => {
    expect(workEmptyMessage({ viewedOnly: true }).title).toBe("还没有浏览记录");
    expect(workEmptyMessage({ viewedOnly: true, collectionId: "night" }).title).toBe("没有匹配的作品");
    expect(workEmptyMessage({ favorite: true, search: "海" }).title).toBe("当前条件下没有喜欢的作品");
    expect(workEmptyMessage({ uncollected: true }).title).toBe("没有未分相册的作品");
  });
});
