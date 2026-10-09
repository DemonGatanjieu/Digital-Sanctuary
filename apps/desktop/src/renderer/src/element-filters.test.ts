import { describe, expect, it } from "vitest";
import { elementLabel, parseTagList, withElements } from "./element-filters";
import { clearAllWorkFilters, workFilterChips } from "./work-filters";

const normalSort = { sortBy: "savedAt", direction: "desc" } as const;

describe("gallery element filters", () => {
  it("shows one removable chip per condition, with Chinese names for common tags", () => {
    const query = withElements({ favorite: true }, { include: ["cat_ears", "red_eyes"], exclude: ["blood"], blocked: true });
    const chips = workFilterChips(query, [], normalSort);
    expect(chips.map((chip) => chip.label)).toEqual(["喜欢", "含屏蔽元素", "需要：猫耳", "需要：red eyes", "排除：血迹"]);
    const withoutCat = chips.find((chip) => chip.key === "include:cat_ears")!.clear(query);
    expect(withoutCat.elements).toEqual({ include: ["red_eyes"], exclude: ["blood"], blocked: true });
    expect(withoutCat.favorite).toBe(true);
    const onlyBlocked = withElements(query, { blocked: true });
    expect(workFilterChips(onlyBlocked, [], normalSort).find((chip) => chip.key === "blocked")!.clear(onlyBlocked).elements).toBeUndefined();
  });

  it("drops empty conditions, keeps a tag on one side only, and clears with everything else", () => {
    expect(withElements({ offset: 120 }, { include: [], exclude: [] })).toEqual({ offset: 0 });
    expect(withElements({}, { include: ["solo"], exclude: ["solo", "night"] }).elements).toEqual({ include: ["solo"], exclude: ["night"] });
    expect(clearAllWorkFilters(withElements({ search: "海" }, { include: ["sky"] }), normalSort).elements).toBeUndefined();
  });

  it("reads typed tags in either comma style and names unknown tags readably", () => {
    expect(parseTagList("Red_Eyes, hat，hat  scarf")).toEqual(["red_eyes", "hat", "scarf"]);
    expect(elementLabel("multiple_girls")).toBe("多位女孩");
    expect(elementLabel("open_mouth")).toBe("open mouth");
  });
});
