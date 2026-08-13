import type { ArtistRecord, ArtworkRecord } from "@sanctuary/domain";

export interface AuthorGalleryGroup {
  key: string;
  id: string;
  name: string;
  pageCount: number;
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
  return artwork.source?.pageIndex ?? inferPixivWorkFromFileName(artwork.fileName)?.pageIndex ?? 0;
}

export function artworkWorkPages(
  artworks: readonly ArtworkRecord[],
  selected: ArtworkRecord
): ArtworkRecord[] {
  const selectedWorkId = selected.source?.workId ?? inferPixivWorkFromFileName(selected.fileName)?.workId;
  if (!selectedWorkId) return [selected];
  return artworks
    .filter((artwork) =>
      (artwork.source?.workId ?? inferPixivWorkFromFileName(artwork.fileName)?.workId) === selectedWorkId
    )
    .sort((left, right) => artworkPageIndex(left) - artworkPageIndex(right));
}
