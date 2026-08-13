import { useEffect, useMemo, useState } from "react";
import type {
  AppearancePreferences,
  ArtistRecord,
  ArtworkRecord,
  CollectionRecord,
  WorkQuery,
  WorkQueryResult
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { ArtworkLightbox } from "./ArtworkLightbox";
import { AuthorBrowserCard, AuthorDetailPage } from "./AuthorGallery";
import { Button } from "./Button";
import { CollectionCard, CollectionDetailPage } from "./CollectionGallery";
import { SegmentedControl } from "./SegmentedControl";
import { WorkLibrary } from "./WorkLibrary";
import { artworkWorkPages, buildAuthorGroups } from "./gallery-model";

export type GalleryMode = "flat" | "author-work" | "collections";

export function GalleryView({
  artworks,
  workResult,
  workQuery,
  workLoading,
  collections,
  artists,
  appearance,
  mode,
  busy,
  repairingAvatars,
  avatarRepairMessage,
  error,
  onImport,
  onCreateCollection,
  onEditCollection,
  onAssignCollection,
  onAssignWorkCollection,
  onUpdateCollectionCover,
  onRepairArtistAvatars,
  onModeChange,
  onWorkQueryChange,
  onLoadMoreWorks,
  onWorkLibraryChanged,
  onAnalyzeWorks,
  onError
}: {
  artworks: ArtworkRecord[];
  workResult: WorkQueryResult;
  workQuery: WorkQuery;
  workLoading: boolean;
  collections: CollectionRecord[];
  artists: ArtistRecord[];
  appearance: AppearancePreferences;
  mode: GalleryMode;
  busy: boolean;
  repairingAvatars: boolean;
  avatarRepairMessage: string;
  error: string;
  onImport: () => void;
  onCreateCollection: () => void;
  onEditCollection: (collection: CollectionRecord) => void;
  onAssignCollection: (artworkId: string, collectionId: string) => void;
  onAssignWorkCollection: (workId: string, collectionId: string) => Promise<void>;
  onUpdateCollectionCover: (collectionId: string, artworkId: string | null) => void;
  onRepairArtistAvatars: () => void;
  onModeChange: (mode: GalleryMode) => void;
  onWorkQueryChange: (query: WorkQuery) => void;
  onLoadMoreWorks: () => void;
  onWorkLibraryChanged: () => Promise<void>;
  onAnalyzeWorks: (workIds: string[]) => void;
  onError: (error: unknown) => void;
}) {
  const authorGroups = useMemo(() => buildAuthorGroups(artworks, artists), [artworks, artists]);
  const [selectedAuthorKey, setSelectedAuthorKey] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedArtworkId, setSelectedArtworkId] = useState("");
  const selectedAuthor = authorGroups.find((author) => author.key === selectedAuthorKey) ?? null;
  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId) ?? null;
  const selectedArtwork = artworks.find((artwork) => artwork.id === selectedArtworkId) ?? null;
  const lightboxPages = useMemo(
    () => selectedArtwork ? artworkWorkPages(artworks, selectedArtwork) : [],
    [artworks, selectedArtwork]
  );
  const missingPixivMetadata = artworks.filter(
    (artwork) => !artwork.source && /^\d+_p\d+\./i.test(artwork.fileName)
  ).length;
  const missingAvatarCount = artists.filter((artist) => !artist.avatarLocalPath).length;
  const showAllWorks = () => {
    const { collectionId: _collectionId, ...withoutCollection } = workQuery;
    onWorkQueryChange({ ...withoutCollection, offset: 0 });
    onModeChange("flat");
  };

  useEffect(() => {
    if (mode !== "author-work") setSelectedAuthorKey("");
    if (mode !== "collections") setSelectedCollectionId("");
  }, [mode]);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL-FIRST LIBRARY</p>
          <h1>你的数字庇护所</h1>
        </div>
        <div className="header-actions">
          <SegmentedControl
            label="画廊布局"
            value={mode}
            options={[
              { value: "flat", label: "平铺" },
              { value: "collections", label: "分类" },
              { value: "author-work", label: "作者 · 作品" }
            ]}
            onChange={(nextMode) => nextMode === "flat" ? showAllWorks() : onModeChange(nextMode)}
          />
          {mode === "author-work" && (
            <div className="avatar-repair-control">
              <Button busy={repairingAvatars} busyLabel="正在补全头像…" disabled={artists.length === 0} onClick={onRepairArtistAvatars}>
                {missingAvatarCount > 0 ? `补全作者头像 (${missingAvatarCount})` : "重新检查头像"}
              </Button>
              {avatarRepairMessage && <small>{avatarRepairMessage}</small>}
            </div>
          )}
          <Button onClick={onCreateCollection}>新建分类</Button>
          <Button variant="primary" onClick={onImport} busy={busy} busyLabel="正在审查…">导入图片</Button>
        </div>
      </header>

      {error && <AppNotice tone="error">{error}</AppNotice>}

      <section className="summary-row">
        <article><span>作品</span><strong>{workResult.total}</strong></article>
        <article><span>图片页</span><strong>{workResult.totalPages}</strong></article>
        <article><span>作者</span><strong>{artists.length}</strong></article>
        <article><span>分类</span><strong>{collections.length}</strong></article>
      </section>

      {workResult.total === 0 && !workQuery.search ? (
        <section className="empty-state">
          <div className="empty-orbit"><span>✦</span></div>
          <p className="eyebrow">FIRST VERTICAL SLICE</p>
          <h2>从一张真正喜欢的图片开始</h2>
          <p>图片保留在原位置；纯净领域只建立索引、审查结果和分类关系。</p>
          <Button variant="primary" onClick={onImport} busy={busy} busyLabel="正在审查…">选择本地图片</Button>
        </section>
      ) : mode === "collections" ? (
        selectedCollection ? (
          <CollectionDetailPage
            collection={selectedCollection}
            artworks={artworks}
            collections={collections}
            onBack={() => setSelectedCollectionId("")}
            onAssign={onAssignCollection}
            onOpenArtwork={setSelectedArtworkId}
            onSetCover={(artworkId) => onUpdateCollectionCover(selectedCollection.id, artworkId)}
          />
        ) : (
          <section className="collections-grid">
            {collections.length === 0 && (
              <div className="empty-state">
                <p className="eyebrow">NO COLLECTIONS</p>
                <h2>暂无分类</h2>
                <p>点击上方“新建分类”来组织你的画廊</p>
              </div>
            )}
            {collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                artworks={artworks}
                onOpen={() => {
                  onWorkQueryChange({ ...workQuery, collectionId: collection.id, offset: 0 });
                  onModeChange("flat");
                }}
                onEdit={() => onEditCollection(collection)}
              />
            ))}
          </section>
        )
      ) : mode === "flat" ? (
        <WorkLibrary
          result={workResult}
          query={workQuery}
          collections={collections}
          appearance={appearance}
          loading={workLoading}
          onQueryChange={onWorkQueryChange}
          onLoadMore={onLoadMoreWorks}
          onAssignCollection={onAssignWorkCollection}
          onLibraryChanged={onWorkLibraryChanged}
          onAnalyzeWorks={onAnalyzeWorks}
          onError={onError}
        />
      ) : (
        <section className="author-gallery">
          {missingPixivMetadata > 0 && (
            <div className="metadata-hint">
              还有 {missingPixivMetadata} 页旧下载缺少作者信息。再次执行“下载全部收藏”会命中去重，只补作者资料并恢复为用户信任。
            </div>
          )}
          {!selectedAuthor ? (
            <div className="author-browser-grid">
              {authorGroups.map((author) => (
                <AuthorBrowserCard key={author.key} author={author} onOpen={() => setSelectedAuthorKey(author.key)} />
              ))}
            </div>
          ) : (
            <AuthorDetailPage
              author={selectedAuthor}
              collections={collections}
              onBack={() => setSelectedAuthorKey("")}
              onAssign={onAssignCollection}
              onOpenArtwork={setSelectedArtworkId}
            />
          )}
        </section>
      )}
      {selectedArtwork && (
        <ArtworkLightbox
          artwork={selectedArtwork}
          pages={lightboxPages}
          onClose={() => setSelectedArtworkId("")}
          onSelect={(artwork) => setSelectedArtworkId(artwork.id)}
        />
      )}
    </>
  );
}
