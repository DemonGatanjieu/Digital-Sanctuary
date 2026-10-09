import { describe, expect, it } from "vitest";
import type { CollectionRecord, SavedCollectionView } from "@sanctuary/domain";
import { formatSavedViewSummary } from "./DirectoryCards";

describe("album & saved view routing contracts", () => {
  const collections: CollectionRecord[] = [
    { id: "col-1", name: "二次元插画", description: "精选插画集", createdAt: "2026-08-14" },
    { id: "col-2", name: "角色原画", description: "设定集", createdAt: "2026-08-14" },
    { id: "col-3", name: "废弃草稿", description: "待清理", createdAt: "2026-08-14" }
  ];

  it("formats saved collection view summary correctly for inclusion and exclusion", () => {
    const viewAll: SavedCollectionView = {
      id: "view-1",
      name: "精选插画",
      includedCollectionIds: ["col-1", "col-2"],
      excludedCollectionIds: ["col-3"],
      matchMode: "all",
      createdAt: "2026-08-14",
      updatedAt: "2026-08-14"
    };

    const summaryAll = formatSavedViewSummary(viewAll, collections);
    expect(summaryAll).toBe("包含 [二次元插画, 角色原画] (全部满足) 且 排除 [废弃草稿]");

    const viewAny: SavedCollectionView = {
      id: "view-2",
      name: "全部画作",
      includedCollectionIds: ["col-1", "col-2"],
      excludedCollectionIds: [],
      matchMode: "any",
      createdAt: "2026-08-14",
      updatedAt: "2026-08-14"
    };

    const summaryAny = formatSavedViewSummary(viewAny, collections);
    expect(summaryAny).toBe("包含 [二次元插画, 角色原画] (任一满足)");
  });

  it("handles empty saved view conditions safely", () => {
    const emptyView: SavedCollectionView = {
      id: "view-empty",
      name: "全库视图",
      includedCollectionIds: [],
      excludedCollectionIds: [],
      matchMode: "any",
      createdAt: "2026-08-14",
      updatedAt: "2026-08-14"
    };

    expect(formatSavedViewSummary(emptyView, collections)).toBe("无条件筛选");
  });
});
