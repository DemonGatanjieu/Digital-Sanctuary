import type {
  CollectionMatchMode,
  SortDirection,
  WorkElementFilter,
  WorkQuery,
  WorkViewRequest,
  WorkSortField,
  WorkType
} from "@sanctuary/domain";

const WORK_TYPES = new Set<WorkType>(["illustration", "manga", "ugoira", "local", "unknown"]);
const SORT_FIELDS = new Set<WorkSortField>([
  "savedAt",
  "lastViewedAt",
  "publishedAt",
  "title",
  "artist",
  "pageCount",
  "byteLength"
]);
const DIRECTIONS = new Set<SortDirection>(["asc", "desc"]);
const COLLECTION_MATCH_MODES = new Set<CollectionMatchMode>(["all", "any"]);

/** Converts untrusted renderer input into a small, bounded database query. */
export function parseWorkQuery(value: unknown): WorkQuery {
  if (!isRecord(value)) return { limit: 60, offset: 0 };
  const query: WorkQuery = {
    limit: boundedInteger(value.limit, 60, 1, 200),
    offset: boundedInteger(value.offset, 0, 0, 10_000_000)
  };
  if (typeof value.search === "string" && value.search.trim()) {
    query.search = value.search.trim().slice(0, 200);
  }
  if (value.ownership === "managed" || value.ownership === "external") query.ownership = value.ownership;
  if (typeof value.workType === "string" && WORK_TYPES.has(value.workType as WorkType)) {
    query.workType = value.workType as WorkType;
  }
  if (typeof value.artistId === "string" && value.artistId.length <= 200) {
    query.artistId = value.artistId;
  }
  if (typeof value.collectionId === "string" && value.collectionId.length <= 200) {
    query.collectionId = value.collectionId;
  }
  const collectionIds = boundedStringIds(value.collectionIds, 50, 200);
  if (collectionIds?.length) query.collectionIds = collectionIds;
  const excludedCollectionIds = boundedStringIds(value.excludedCollectionIds, 50, 200);
  if (excludedCollectionIds?.length) query.excludedCollectionIds = excludedCollectionIds;
  if (
    typeof value.collectionMatchMode === "string" &&
    COLLECTION_MATCH_MODES.has(value.collectionMatchMode as CollectionMatchMode)
  ) {
    query.collectionMatchMode = value.collectionMatchMode as CollectionMatchMode;
  }
  if (typeof value.sortBy === "string" && SORT_FIELDS.has(value.sortBy as WorkSortField)) {
    query.sortBy = value.sortBy as WorkSortField;
  }
  if (typeof value.direction === "string" && DIRECTIONS.has(value.direction as SortDirection)) {
    query.direction = value.direction as SortDirection;
  }
  if (typeof value.favorite === "boolean") query.favorite = value.favorite;
  if (typeof value.unattributed === "boolean") query.unattributed = value.unattributed;
  if (typeof value.uncollected === "boolean") query.uncollected = value.uncollected;
  if (typeof value.viewedOnly === "boolean") query.viewedOnly = value.viewedOnly;
  const elements = parseElementFilter(value.elements);
  if (elements) query.elements = elements;
  // `elementMatch` is resolved in the main process and never read from here.
  return query;
}

/** Tagger tag names: short, printable, no separators that could confuse storage. */
export function parseElementFilter(value: unknown): WorkElementFilter | null {
  if (!isRecord(value)) return null;
  const tags = (list: unknown) => Array.isArray(list)
    ? [...new Set(list.filter((tag): tag is string => typeof tag === "string" && /^[^\u0000-\u001f,]{1,80}$/.test(tag.trim())).map((tag) => tag.trim()))].slice(0, 20)
    : [];
  const filter: WorkElementFilter = {};
  const include = tags(value.include), exclude = tags(value.exclude).filter((tag) => !include.includes(tag));
  if (include.length) filter.include = include;
  if (exclude.length) filter.exclude = exclude;
  if (value.blocked === true) filter.blocked = true;
  return filter.include || filter.exclude || filter.blocked ? filter : null;
}

export function parseWorkViewRequest(value: unknown): WorkViewRequest | null {
  if (!isRecord(value)) return null;
  const isLocalId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(id);
  return isLocalId(value.workId) && isLocalId(value.assetId)
    ? { workId: value.workId, assetId: value.assetId }
    : null;
}

export function parseWorkId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 300
    ? value
    : null;
}

export function parseWorkIds(value: unknown, maximum = 500): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) return null;
  const ids = value.map(parseWorkId);
  if (ids.some((id) => id === null)) return null;
  return [...new Set(ids as string[])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function boundedStringIds(value: unknown, maximumItems: number, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const ids = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0 && item.length <= maximumLength
  );
  if (ids.length !== value.length) return null;
  return [...new Set(ids)];
}
