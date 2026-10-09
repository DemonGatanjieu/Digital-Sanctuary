import { describe, expect, it } from "vitest";
import { clearAllWorkFilters, withOwnership, withWorkType, workFilterChips } from "./work-filters";

const sort = { sortBy: "savedAt", direction: "desc" } as const;
const albums = [{ id: "a", name: "海与天空" }, { id: "b", name: "人物" }];

describe("work filter chips", () => {
  it("lists each active condition once and leaves the search text to the search box", () => {
    const chips = workFilterChips({ search: "海", favorite: true, workType: "manga", ownership: "external", collectionId: "a" }, albums, sort);
    expect(chips.map((chip) => chip.label)).toEqual(["喜欢", "相册：海与天空", "漫画", "外部引用"]);
  });

  it("removes exactly one condition per chip and resets paging", () => {
    const query = { favorite: true, workType: "manga" as const, offset: 120 };
    const chips = workFilterChips(query, albums, sort);
    expect(chips.find((chip) => chip.key === "type")!.clear(query)).toEqual({ favorite: true, offset: 0 });
    expect(chips.find((chip) => chip.key === "preset")!.clear(query)).toEqual({ workType: "manga", offset: 0 });
  });

  it("restores the normal sort when the recent preset is removed", () => {
    const query = { viewedOnly: true, sortBy: "lastViewedAt" as const, direction: "desc" as const };
    const [chip] = workFilterChips(query, albums, { sortBy: "title", direction: "asc" });
    expect(chip!.label).toBe("最近浏览");
    expect(chip!.clear(query)).toMatchObject({ sortBy: "title", direction: "asc" });
    expect(chip!.clear(query).viewedOnly).toBeUndefined();
  });

  it("describes album combinations without exposing ids", () => {
    const [chip] = workFilterChips({ collectionIds: ["a", "gone"], collectionMatchMode: "all", excludedCollectionIds: ["b"] }, albums, sort);
    expect(chip!.label).toBe("相册组合：海与天空 且 已移除的相册，排除 人物");
    expect(chip!.clear({ collectionIds: ["a"], collectionMatchMode: "all", excludedCollectionIds: ["b"], favorite: true })).toEqual({ favorite: true, offset: 0 });
  });

  it("keeps the search and page size when clearing everything", () => {
    expect(clearAllWorkFilters({ search: "猫", favorite: true, workType: "manga", limit: 60 }, sort)).toEqual({ sortBy: "savedAt", direction: "desc", offset: 0, search: "猫", limit: 60 });
  });

  it("sets or removes single-valued filters", () => {
    expect(withWorkType({ workType: "manga", offset: 60 }, null)).toEqual({ offset: 0 });
    expect(withOwnership({}, "managed")).toEqual({ ownership: "managed", offset: 0 });
  });
});
