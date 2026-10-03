import type { ArtworkPageQuery, DirectoryPageQuery, GalleryScope } from "@sanctuary/domain";

const localId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, fallback: number, maximum: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) ? Math.max(0, Math.min(maximum, value)) : fallback;

/** Every detail request names one real entity. There is deliberately no all-library scope. */
export function parseGalleryScope(value: unknown): GalleryScope | null {
  if (!record(value)) return null;
  if (value.kind === "collection" && localId(value.collectionId)) return { kind: "collection", collectionId: value.collectionId };
  if (value.kind === "artist" && (value.artistId === null || localId(value.artistId))) return { kind: "artist", artistId: value.artistId };
  if (value.kind === "work" && localId(value.workId)) return { kind: "work", workId: value.workId };
  return null;
}

export function parseDirectoryPageQuery(value: unknown, maximum = 12): DirectoryPageQuery {
  const input = record(value) ? value : {};
  return { offset: integer(input.offset, 0, 10_000_000), limit: Math.max(1, integer(input.limit, maximum, maximum)) };
}

export function parseArtworkPageQuery(value: unknown): ArtworkPageQuery {
  const query: ArtworkPageQuery = parseDirectoryPageQuery(value, 200);
  if (!record(value)) return query;
  if (typeof value.search === "string" && value.search.trim()) query.search = value.search.trim().slice(0, 200);
  if (localId(value.excludedCollectionId)) query.excludedCollectionId = value.excludedCollectionId;
  return query;
}

export function parseCollectionArtworkBatch(value: unknown, collectionId: unknown): { artworkIds: string[]; collectionId: string } | null {
  if (!localId(collectionId) || !Array.isArray(value) || !value.length || value.length > 500 || !value.every(localId)) return null;
  return { artworkIds: [...new Set(value)], collectionId };
}
