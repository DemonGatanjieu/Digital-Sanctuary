import type { ArtistRecord, ArtistSummary, ArtworkRecord, GalleryScope, SavedCollectionViewQuery, ScopedArtworkRecord, WorkQuery } from "@sanctuary/domain";
import type { WorkSortSnapshot } from "./work-presets";

export interface AuthorGalleryGroup {
  key: string;
  id: string;
  name: string;
  pageCount: number;
  workCount?: number;
  artistRecord?: ArtistRecord;
  works: Array<{
    key: string;
    workId: string;
    title: string;
    pages: ArtworkRecord[];
  }>;
}

export function buildAuthorGroups(
  artworks: readonly ArtworkRecord[],
  artists: readonly ArtistRecord[]
): AuthorGalleryGroup[] {
  const authors = new Map<string, AuthorGalleryGroup>();
  for (const artwork of artworks) {
    const inferred = inferPixivWorkFromFileName(artwork.fileName);
    const authorId = artwork.source?.authorId ?? "";
    const authorName = artwork.source?.authorName ?? "待补充作者信息";
    const authorKey = authorId ? `pixiv:${authorId}` : "pixiv:unknown";
    const workId = artwork.source?.workId ?? inferred?.workId ?? artwork.id;
    const workKey = `${authorKey}:work:${workId}`;
    let author = authors.get(authorKey);
    if (!author) {
      const artistRecord = artists.find((candidate) => candidate.id === authorId);
      author = { key: authorKey, id: authorId, name: authorName, pageCount: 0, works: [] };
      if (artistRecord) author.artistRecord = artistRecord;
      authors.set(authorKey, author);
    }
    let work = author.works.find((candidate) => candidate.key === workKey);
    if (!work) {
      work = {
        key: workKey,
        workId,
        title: artwork.source?.title ?? (inferred ? `Pixiv 作品 ${workId}` : artwork.fileName),
        pages: []
      };
      author.works.push(work);
    }
    work.pages.push(artwork);
    author.pageCount += 1;
  }
  for (const author of authors.values()) {
    for (const work of author.works) {
      work.pages.sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
    }
  }
  return [...authors.values()];
}

export function inferPixivWorkFromFileName(fileName: string): { workId: string; pageIndex: number } | null {
  const match = fileName.match(/^(\d+)_p(\d+)\.[^.]+$/i);
  const workId = match?.[1];
  const pageIndex = Number(match?.[2]);
  return workId && Number.isSafeInteger(pageIndex) ? { workId, pageIndex } : null;
}

export function artworkPageIndex(artwork: ArtworkRecord): number {
  return (artwork as Partial<ScopedArtworkRecord>).pageIndex ?? artwork.source?.pageIndex ?? inferPixivWorkFromFileName(artwork.fileName)?.pageIndex ?? 0;
}

export function artworkLibraryWorkId(artwork: ArtworkRecord): string {
  const canonical = (artwork as Partial<ScopedArtworkRecord>).libraryWorkId;
  if (canonical) return canonical;
  const sourceWorkId = artwork.source?.workId ?? inferPixivWorkFromFileName(artwork.fileName)?.workId;
  return sourceWorkId ? `pixiv:${sourceWorkId}` : `local:${artwork.id}`;
}

export function artworkWorkPages(
  artworks: readonly ArtworkRecord[],
  selected: ArtworkRecord
): ArtworkRecord[] {
  if ((selected as Partial<ScopedArtworkRecord>).libraryWorkId) {
    return artworks.filter((artwork) => artworkLibraryWorkId(artwork) === artworkLibraryWorkId(selected))
      .sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
  }
  const selectedWorkId = selected.source?.workId ?? inferPixivWorkFromFileName(selected.fileName)?.workId;
  if (!selectedWorkId) return [selected];
  return artworks
    .filter((artwork) =>
      (artwork.source?.workId ?? inferPixivWorkFromFileName(artwork.fileName)?.workId) === selectedWorkId
    )
    .sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
}

/** Directory counts come from SQL; only the selected scope is grouped into physical book pages. */
export function authorDetailFromSummary(summary: ArtistSummary, pages: readonly ScopedArtworkRecord[]): AuthorGalleryGroup {
  const works = new Map<string, AuthorGalleryGroup["works"][number]>();
  for (const page of pages) {
    let work = works.get(page.libraryWorkId);
    if (!work) {
      work = { key: page.libraryWorkId, workId: page.source?.workId ?? page.libraryWorkId, title: page.source?.title ?? page.fileName, pages: [] };
      works.set(page.libraryWorkId, work);
    }
    work.pages.push(page);
  }
  for (const work of works.values()) work.pages.sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
  return { key: summary.key, id: summary.artistId ?? "", name: summary.name, pageCount: summary.pageCount,
    workCount: summary.workCount, works: [...works.values()], ...(summary.artist ? { artistRecord: summary.artist } : {}) };
}

export function galleryScopeKey(scope: GalleryScope | null): string {
  if (!scope) return "";
  if (scope.kind === "collection") return `collection:${scope.collectionId}`;
  if (scope.kind === "artist") return scope.artistId === null ? "artist:null" : `artist:id:${scope.artistId}`;
  return `work:${scope.workId}`;
}

/** Opening a saved view starts from its exact effective conditions, matching its SQL count and cover preview. */
export function savedViewWorkQuery(query: SavedCollectionViewQuery, sort: WorkSortSnapshot, limit?: number): WorkQuery {
  return { ...sort, collectionIds: query.includedCollectionIds, collectionMatchMode: query.matchMode,
    excludedCollectionIds: query.excludedCollectionIds, offset: 0, ...(limit ? { limit } : {}) };
}

export function directoryScopeWorkQuery(scope: Exclude<GalleryScope, { kind: "work" }>, sort: WorkSortSnapshot, limit?: number): WorkQuery {
  const condition = scope.kind === "collection" ? { collectionId: scope.collectionId } :
    scope.artistId === null ? { unattributed: true } : { artistId: scope.artistId };
  return { ...sort, ...condition, offset: 0, ...(limit ? { limit } : {}) };
}
