import type { ArtistRecord, ArtworkRecord, CollectionRecord, SavedCollectionView, SavedCollectionViewQuery, WorkAssetRecord } from "./index.js";

export type GalleryScope =
  | { kind: "collection"; collectionId: string }
  | { kind: "artist"; artistId: string | null }
  | { kind: "work"; workId: string };

export interface ScopedArtworkRecord extends ArtworkRecord {
  libraryWorkId: string;
  assetId: string;
  pageIndex: number;
  thumbnailPath: string | null;
}

export interface CollectionSummary extends CollectionRecord {
  workCount: number;
  pageCount: number;
  bookPageCount: number;
  coverAsset: WorkAssetRecord | null;
}

export interface ArtistSummary {
  key: string;
  artistId: string | null;
  name: string;
  artist: ArtistRecord | null;
  workCount: number;
  pageCount: number;
  bookPageCount: number;
  previewAssets: WorkAssetRecord[];
}

export interface SavedViewSummary extends SavedCollectionView {
  effectiveQuery: SavedCollectionViewQuery;
  missingIncludedIds: string[];
  missingExcludedIds: string[];
  workCount: number;
  pageCount: number;
  previewAssets: WorkAssetRecord[];
}

export interface DirectoryPageQuery { offset?: number; limit?: number }
export interface ArtworkPageQuery extends DirectoryPageQuery {
  search?: string;
  excludedCollectionId?: string;
}
export interface SavedViewSummaryResult {
  items: SavedViewSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
export interface ArtworkPageQueryResult {
  items: ScopedArtworkRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
