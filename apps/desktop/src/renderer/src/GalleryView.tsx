import { useEffect, useMemo, useState } from "react";
import type {
  AppearancePreferences,
  ArtistRecord,
  ArtworkRecord,
  CollectionRecord,
  SavedCollectionView,
  SavedCollectionViewDraft,
  WorkQuery,
  WorkQueryResult
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { ArtworkLightbox } from "./ArtworkLightbox";
import { AuthorBrowserCard, AuthorDetailPage } from "./AuthorGallery";
import { Button } from "./Button";
import { CollectionCard, CollectionDetailPage, SavedCollectionViewCard } from "./CollectionGallery";
import { DialogOverlay } from "./DialogOverlay";
import { SavedCollectionViewEditor } from "./SavedCollectionViewEditor";
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
  savedCollectionViews,
  artists,
  appearance,
  mode,
  busy,
  repairingAvatars,
  avatarRepairMessage,
  error,
  onImport,
  onOpenExplore,
  onCreateCollection,
  onEditCollection,
  onSaveSavedView,
  onDeleteSavedView,
  onAssignCollection,
  onAssignWorkCollection,
  onUpdateCollectionCover,
  onRepairArtistAvatars,
  onModeChange,
  onWorkQueryChange,
  onLoadMoreWorks,
  onWorkLibraryChanged,
  onAnalyzeWorks,
  onOpenInspiration,
  onOpenPixivArtist,
  onError
}: {
  artworks: ArtworkRecord[];
  workResult: WorkQueryResult;
  workQuery: WorkQuery;
  workLoading: boolean;
  collections: CollectionRecord[];
  savedCollectionViews: SavedCollectionView[];
  artists: ArtistRecord[];
  appearance: AppearancePreferences;
  mode: GalleryMode;
  busy: boolean;
  repairingAvatars: boolean;
  avatarRepairMessage: string;
  error: string;
  onImport: () => void;
  onOpenExplore: () => void;
  onCreateCollection: () => void;
  onEditCollection: (collection: CollectionRecord) => void;
  onSaveSavedView: (draft: SavedCollectionViewDraft, id?: string) => Promise<void>;
  onDeleteSavedView: (id: string) => Promise<void>;
  onAssignCollection: (artworkId: string, collectionId: string) => Promise<void> | void;
  onAssignWorkCollection: (workId: string, collectionId: string) => Promise<void>;
  onUpdateCollectionCover: (collectionId: string, artworkId: string | null) => void;
  onRepairArtistAvatars: () => void;
  onModeChange: (mode: GalleryMode) => void;
  onWorkQueryChange: (query: WorkQuery) => void;
  onLoadMoreWorks: () => void;
  onWorkLibraryChanged: () => Promise<void>;
  onAnalyzeWorks: (workIds: string[]) => void;
  onOpenInspiration: (workId: string, pageIndex: number) => void;
  onOpenPixivArtist: (artistId: string) => void;
  onError: (error: unknown) => void;
}) {
  const authorGroups = useMemo(() => buildAuthorGroups(artworks, artists), [artworks, artists]);
  const [selectedAuthorKey, setSelectedAuthorKey] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedArtworkId, setSelectedArtworkId] = useState("");
  const [isCreatingSavedView, setIsCreatingSavedView] = useState(false);
  const [editingSavedView, setEditingSavedView] = useState<SavedCollectionView | null>(null);
  const [deletingSavedView, setDeletingSavedView] = useState<SavedCollectionView | null>(null);

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
    const {
      collectionId: _collectionId,
      collectionIds: _collectionIds,
      collectionMatchMode: _collectionMatchMode,
      excludedCollectionIds: _excludedCollectionIds,
      ...withoutCollection
    } = workQuery;
    onWorkQueryChange({ ...withoutCollection, offset: 0 });
    onModeChange("flat");
  };

  useEffect(() => {
    if (mode !== "author-work") setSelectedAuthorKey("");
    if (mode !== "collections") setSelectedCollectionId("");
  }, [mode]);

  return (
    <>
      <header className="topbar gallery-heading">
        <div>
          <p className="eyebrow">LOCAL-FIRST LIBRARY</p>
          <h1>图库</h1>
          <p className="page-description">保存喜欢的作品，按作品、相册或画师浏览。</p>
        </div>
        <div className="header-actions">
          <SegmentedControl
            label="画廊布局"
            value={mode}
            options={[
              { value: "flat", label: "全部作品" },
              { value: "collections", label: "相册" },
              { value: "author-work", label: "画师" }
            ]}
            onChange={(nextMode) => nextMode === "flat" ? showAllWorks() : onModeChange(nextMode)}
          />
          {mode === "author-work" && (
            <div className="avatar-repair-control">
              <Button busy={repairingAvatars} busyLabel="正在补全头像…" disabled={artists.length === 0} onClick={onRepairArtistAvatars}>
                {missingAvatarCount > 0 ? `补全画师头像 (${missingAvatarCount})` : "重新检查头像"}
              </Button>
              {avatarRepairMessage && <small>{avatarRepairMessage}</small>}
            </div>
          )}
          {mode === "collections" && (
            <Button onClick={() => setIsCreatingSavedView(true)}>新建相册组合</Button>
          )}
          {mode === "collections" && <Button onClick={onCreateCollection}>新建相册</Button>}
          <Button variant="primary" onClick={onImport} busy={busy} busyLabel="正在导入…">导入图片</Button>
        </div>
      </header>

      {error && <AppNotice tone="error">{error}</AppNotice>}

      <section className="summary-row">
        <article><span>作品</span><strong>{workResult.total}</strong></article>
        <article><span>图片页</span><strong>{workResult.totalPages}</strong></article>
        <article><span>画师</span><strong>{artists.length}</strong></article>
        <article><span>相册</span><strong>{collections.length}</strong></article>
      </section>

      {workLoading && (workResult.total === 0 || (mode !== "flat" && artworks.length === 0)) ? (
        <section className="library-loading" role="status">正在读取图库…</section>
      ) : workResult.total === 0 && !workQuery.search ? (
        <section className="empty-state">
          <div className="empty-orbit"><span>✦</span></div>
          <p className="eyebrow">YOUR FIRST ARTWORK</p>
          <h2>从一张真正喜欢的图片开始</h2>
          <p>导入本地图片，或去 Pixiv 保存作品。导入的图片保留在原位置，之后可随时整理到相册。</p>
          <div className="library-start-actions">
            <Button variant="primary" onClick={onImport} busy={busy} busyLabel="正在导入…">导入本地图片</Button>
            <Button onClick={onOpenExplore}>去 Pixiv 找作品</Button>
          </div>
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
            lightboxOpen={Boolean(selectedArtwork)}
            onFilterInGallery={() => {
              const {
                collectionIds: _cids,
                collectionMatchMode: _cmm,
                excludedCollectionIds: _ecids,
                ...restQuery
              } = workQuery;
              onWorkQueryChange({ ...restQuery, collectionId: selectedCollection.id, offset: 0 });
              onModeChange("flat");
            }}
          />
        ) : (
          <div className="collections-view-container">
            {/* 1. Saved Collection Views Section */}
            <section className="saved-views-section">
              <div className="section-header-row">
                <div>
                  <h3 className="section-title">组合视图 ({savedCollectionViews.length})</h3>
                  <p className="section-subtext">把多个相册一起查看，可选择同时包含、任意包含或排除</p>
                </div>
                <Button variant="ghost" onClick={() => setIsCreatingSavedView(true)}>
                  + 新建组合
                </Button>
              </div>

              {savedCollectionViews.length === 0 ? (
                <div className="saved-views-empty-card" onClick={() => setIsCreatingSavedView(true)}>
                  <div className="saved-views-empty-icon">⚡</div>
                  <div className="saved-views-empty-text">
                    <strong>还没有创建组合视图</strong>
                    <p>点击“新建组合”，即可同时组合多个分类进行“全部满足”、“任意满足”或“排除”筛选。</p>
                  </div>
                  <Button type="button">新建组合</Button>
                </div>
              ) : (
                <div className="collections-grid saved-views-grid">
                  {savedCollectionViews.map((view) => (
                    <SavedCollectionViewCard
                      key={view.id}
                      view={view}
                      collections={collections}
                      artworks={artworks}
                      onOpen={() => {
                        const { collectionId: _cid, ...restQuery } = workQuery;
                        const existingCollectionIds = new Set(collections.map((collection) => collection.id));
                        onWorkQueryChange({
                          ...restQuery,
                          collectionIds: view.includedCollectionIds.filter((id) => existingCollectionIds.has(id)),
                          collectionMatchMode: view.matchMode,
                          excludedCollectionIds: view.excludedCollectionIds.filter((id) => existingCollectionIds.has(id)),
                          offset: 0
                        });
                        onModeChange("flat");
                      }}
                      onEdit={() => setEditingSavedView(view)}
                      onDelete={() => setDeletingSavedView(view)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 2. Normal Collections Section */}
            <section className="normal-collections-section">
              <div className="section-header-row">
                <div>
                  <h3 className="section-title">全部普通相册 ({collections.length})</h3>
                  <p className="section-subtext">用于归纳管理图片的实体相册</p>
                </div>
                <Button onClick={onCreateCollection}>
                  + 新建相册
                </Button>
              </div>

              <div className="collections-grid">
                {collections.length === 0 && (
                  <div className="empty-state">
                    <p className="eyebrow">NO COLLECTIONS</p>
                    <h2>暂无相册</h2>
                    <p>点击上方“新建相册”来组织你的画廊</p>
                  </div>
                )}
                {collections.map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    artworks={artworks}
                    onOpen={() => setSelectedCollectionId(collection.id)}
                    onEdit={() => onEditCollection(collection)}
                    onFilter={() => {
                      const {
                        collectionIds: _cids,
                        collectionMatchMode: _cmm,
                        excludedCollectionIds: _ecids,
                        ...restQuery
                      } = workQuery;
                      onWorkQueryChange({ ...restQuery, collectionId: collection.id, offset: 0 });
                      onModeChange("flat");
                    }}
                  />
                ))}
              </div>
            </section>
          </div>
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
          onOpenInspiration={onOpenInspiration}
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
              onOpenPixivArtist={onOpenPixivArtist}
              lightboxOpen={Boolean(selectedArtwork)}
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
          onOpenInspiration={(workId, pageIndex) => {
            setSelectedArtworkId("");
            onOpenInspiration(workId, pageIndex);
          }}
        />
      )}

      {(isCreatingSavedView || editingSavedView) && (
        <SavedCollectionViewEditor
          editingView={editingSavedView}
          collections={collections}
          existingViews={savedCollectionViews}
          onClose={() => {
            setIsCreatingSavedView(false);
            setEditingSavedView(null);
          }}
          onSave={async (draft, viewId) => {
            await onSaveSavedView(draft, viewId);
            setIsCreatingSavedView(false);
            setEditingSavedView(null);
          }}
          onApplyTemporarily={(query) => {
            const { collectionId: _cid, ...restQuery } = workQuery;
            onWorkQueryChange({
              ...restQuery,
              collectionIds: query.collectionIds,
              collectionMatchMode: query.collectionMatchMode,
              excludedCollectionIds: query.excludedCollectionIds,
              offset: 0
            });
            onModeChange("flat");
          }}
        />
      )}

      {deletingSavedView && (
        <DialogOverlay onClose={() => setDeletingSavedView(null)}>
          <section className="dialog-shell" aria-labelledby="delete-saved-view-title">
            <header className="dialog-header">
              <div>
                <p className="eyebrow">DELETE VIEW</p>
                <h2 id="delete-saved-view-title">删除组合视图“{deletingSavedView.name}”</h2>
              </div>
              <button type="button" className="dialog-close" onClick={() => setDeletingSavedView(null)} aria-label="关闭">✕</button>
            </header>
            <div className="dialog-body">
              <p>确定要删除这个组合视图吗？</p>
              <p className="dialog-subtext"><strong>说明：</strong>只删除这个组合视图，不会删除作品或原分类。</p>
            </div>
            <footer className="dialog-footer">
              <Button type="button" onClick={() => setDeletingSavedView(null)}>取消</Button>
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  await onDeleteSavedView(deletingSavedView.id);
                  setDeletingSavedView(null);
                }}
              >
                确认删除
              </Button>
            </footer>
          </section>
        </DialogOverlay>
      )}
    </>
  );
}
