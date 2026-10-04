import { describe, expect, it } from "vitest";
import { describeWorkFilter } from "./SavedWorkFilters";

describe("saved filter explanation", () => {
  it("explains compound conditions, exclusions, removed albums and ordering without exposing IDs", () => {
    const description = describeWorkFilter({ search: "背景", favorite: true, workType: "manga", collectionIds: ["one", "gone"],
      collectionMatchMode: "all", excludedCollectionIds: ["two"], sortBy: "title", direction: "asc" }, [{ id: "one", name: "收藏" }, { id: "two", name: "已用" }]);
    expect(description).toContain("搜索“背景”"); expect(description).toContain("漫画 · 喜欢的作品");
    expect(description).toContain("同时属于：收藏、已移除的相册（保留原条件）");
    expect(description).toContain("排除：已用 · 标题升序"); expect(description).not.toContain("gone");
  });
});
