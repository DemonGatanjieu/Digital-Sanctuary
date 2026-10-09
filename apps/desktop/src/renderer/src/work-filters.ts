import type { CollectionRecord, WorkOwnership, WorkQuery, WorkType } from "@sanctuary/domain";
import { applyWorkPreset, getWorkPreset, type WorkPreset, type WorkSortSnapshot } from "./work-presets";

export const PRESET_LABELS: Record<WorkPreset, string> = { all: "全部作品", favorites: "喜欢", recent: "最近浏览", uncollected: "未分相册" };
export const WORK_TYPE_LABELS: Record<WorkType, string> = { illustration: "插画", manga: "漫画", ugoira: "动图", local: "本地导入", unknown: "类型待补充" };
export const OWNERSHIP_LABELS: Record<WorkOwnership, string> = { managed: "图库保存", external: "外部引用" };
export const SORT_LABELS = {
  savedAt: "保存时间",
  publishedAt: "发布时间",
  title: "标题",
  artist: "画师",
  pageCount: "页数",
  byteLength: "文件大小"
} as const satisfies Record<WorkSortSnapshot["sortBy"], string>;

export interface WorkFilterChip {
  key: string;
  label: string;
  clear: (query: WorkQuery) => WorkQuery;
}

/** Every active condition except the free-text search, which stays visible in the search box. */
export function workFilterChips(
  query: WorkQuery,
  collections: Pick<CollectionRecord, "id" | "name">[],
  normalSort: WorkSortSnapshot,
  artistName?: string | null
): WorkFilterChip[] {
  const chips: WorkFilterChip[] = [];
  const album = (id: string) => collections.find((item) => item.id === id)?.name ?? "已移除的相册";
  const without = <K extends keyof WorkQuery>(...keys: K[]) => (current: WorkQuery): WorkQuery => {
    const next = { ...current, offset: 0 };
    for (const key of keys) delete next[key];
    return next;
  };
  const preset = getWorkPreset(query);
  if (preset !== "all") chips.push({ key: "preset", label: PRESET_LABELS[preset], clear: (current) => applyWorkPreset(current, "all", normalSort) });
  if (query.collectionId) chips.push({ key: "collection", label: `相册：${album(query.collectionId)}`, clear: without("collectionId") });
  if (query.collectionIds?.length || query.excludedCollectionIds?.length) {
    const joiner = query.collectionMatchMode === "all" ? " 且 " : " 或 ";
    const included = query.collectionIds?.length ? query.collectionIds.map(album).join(joiner) : "全部作品";
    const excluded = query.excludedCollectionIds?.length ? `，排除 ${query.excludedCollectionIds.map(album).join("、")}` : "";
    chips.push({ key: "combination", label: `相册组合：${included}${excluded}`, clear: without("collectionIds", "collectionMatchMode", "excludedCollectionIds") });
  }
  if (query.artistId) chips.push({ key: "artist", label: `画师：${artistName ?? "指定画师"}`, clear: without("artistId") });
  if (query.unattributed !== undefined) chips.push({ key: "unattributed", label: query.unattributed ? "未记录画师" : "已记录画师", clear: without("unattributed") });
  if (query.workType) chips.push({ key: "type", label: WORK_TYPE_LABELS[query.workType], clear: without("workType") });
  if (query.ownership) chips.push({ key: "ownership", label: OWNERSHIP_LABELS[query.ownership], clear: without("ownership") });
  return chips;
}

export function clearAllWorkFilters(query: WorkQuery, normalSort: WorkSortSnapshot): WorkQuery {
  return { ...normalSort, offset: 0, ...(query.search ? { search: query.search } : {}), ...(query.limit ? { limit: query.limit } : {}) };
}

export function withWorkType(query: WorkQuery, workType: WorkType | null): WorkQuery {
  const { workType: _current, ...rest } = query;
  return { ...rest, ...(workType ? { workType } : {}), offset: 0 };
}

export function withOwnership(query: WorkQuery, ownership: WorkOwnership | null): WorkQuery {
  const { ownership: _current, ...rest } = query;
  return { ...rest, ...(ownership ? { ownership } : {}), offset: 0 };
}
