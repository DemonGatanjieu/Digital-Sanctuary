import type { WorkQuery } from "@sanctuary/domain";

export type WorkPreset = "all" | "favorites" | "recent" | "uncollected";
export interface WorkSortSnapshot {
  sortBy: Exclude<NonNullable<WorkQuery["sortBy"]>, "lastViewedAt">;
  direction: "asc" | "desc";
}

export function getWorkPreset(query: WorkQuery): WorkPreset {
  if (query.viewedOnly) return "recent";
  if (query.favorite === true) return "favorites";
  if (query.uncollected) return "uncollected";
  return "all";
}

/** Presets compose with search, type and album conditions; only recent temporarily owns the sort. */
export function applyWorkPreset(query: WorkQuery, preset: WorkPreset, normalSort: WorkSortSnapshot): WorkQuery {
  const { favorite: _favorite, uncollected: _uncollected, viewedOnly: _viewedOnly, ...rest } = query;
  const next: WorkQuery = { ...rest, offset: 0 };
  if (query.viewedOnly || query.sortBy === "lastViewedAt") Object.assign(next, normalSort);
  if (preset === "favorites") next.favorite = true;
  if (preset === "uncollected") next.uncollected = true;
  if (preset === "recent") Object.assign(next, { viewedOnly: true, sortBy: "lastViewedAt", direction: "desc" });
  return next;
}

export function clearWorkCollectionFilters(query: WorkQuery): WorkQuery {
  const {
    collectionId: _collectionId, collectionIds: _collectionIds,
    collectionMatchMode: _collectionMatchMode, excludedCollectionIds: _excludedCollectionIds,
    ...rest
  } = query;
  return { ...rest, offset: 0 };
}

export function hasWorkFilters(query: WorkQuery): boolean {
  return Boolean(query.search || query.workType || query.artistId || query.collectionId || query.collectionIds?.length ||
    query.excludedCollectionIds?.length || query.favorite !== undefined || query.uncollected || query.viewedOnly);
}

export function workEmptyMessage(query: WorkQuery): { title: string; description: string } {
  const scoped = Boolean(query.search || query.workType || query.artistId || query.collectionId ||
    query.collectionIds?.length || query.excludedCollectionIds?.length);
  const preset = getWorkPreset(query);
  if (scoped) return {
    title: preset === "favorites" ? "当前条件下没有喜欢的作品" : "没有匹配的作品",
    description: "换一个标题、作者或 Pixiv ID，或调整筛选与相册条件。"
  };
  if (preset === "recent") return { title: "还没有浏览记录", description: "打开一件作品，读到的页会自动保存在这里。" };
  if (preset === "favorites") return { title: "还没有喜欢的作品", description: "点击作品卡片上的爱心，方便下次找到它。" };
  if (preset === "uncollected") return { title: "没有未分相册的作品", description: "作品都已整理到相册。选择“全部”查看图库。" };
  if (hasWorkFilters(query)) return { title: "没有匹配的作品", description: "调整筛选条件，再试一次。" };
  return { title: "画廊还是空的", description: "从探索页保存作品，或导入本地图片。" };
}
