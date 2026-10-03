import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  AppearancePreferences,
  ArtistSummary,
  CollectionRecord,
  CollectionSummary,
  GalleryScope,
  ScopedArtworkRecord,
  SavedViewSummary,
  SavedCollectionView,
  SavedCollectionViewDraft,
  WorkQuery,
  WorkQueryResult,
  WorkRecord
} from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { AuthorBrowserCard, AuthorDetailPage } from "./AuthorGallery";
import { Button } from "./Button";
import { CollectionCard, CollectionDetailPage, SavedCollectionViewCard } from "./CollectionGallery";
import { DialogOverlay } from "./DialogOverlay";
import { SavedCollectionViewEditor } from "./SavedCollectionViewEditor";
import { SegmentedControl } from "./SegmentedControl";
import { WorkLibrary, WorkLightbox } from "./WorkLibrary";
import { authorDetailFromSummary, directoryScopeWorkQuery, galleryScopeKey, savedViewWorkQuery } from "./gallery-model";
import { hasWorkFilters, type WorkSortSnapshot } from "./work-presets";
import type { GalleryDetailScope, GalleryDetailSession, GalleryDetailSessionPatch } from "./gallery-detail-session";

export type GalleryMode = "flat" | "author-work" | "collections";

export function GalleryView({
  scopedArtworks,
  scope,
  scopeLoading,
  detailSession,
  onDetailSessionChange,
  mainScrollRef,
  onRegisterDetailCapture,
  directoryLoading,
  collectionSummaries,
  artistSummaries,
  artistCount,
  savedViewSummaries,
  savedViewsTotal,
  savedViewsHasMore,
  savedViewsLoading,
  workResult,
  workQuery,
  normalSort,
  workLoading,
  collections,
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
  onAddCollectionArtworks,
  onAssignWorkCollection,
  onUpdateCollectionCover,
  onRepairArtistAvatars,
  onModeChange,
  onScopeChange,
  onLoadMoreSavedViews,
  onRetryDirectory,
  onWorkQueryChange,
  onLoadMoreWorks,
  onWorkLibraryChanged,
  onAnalyzeWorks,
  onOpenInspiration,
  onOpenPixivArtist,
  onError
}: {
  scopedArtworks: ScopedArtworkRecord[];
  scope: GalleryScope | null;
  scopeLoading: boolean;
  detailSession: GalleryDetailSession | null;
  onDetailSessionChange: (scope: GalleryDetailScope, patch: GalleryDetailSessionPatch) => void;
  mainScrollRef: RefObject<HTMLElement | null>;
  onRegisterDetailCapture: (scope: GalleryDetailScope, capture: () => GalleryDetailSessionPatch) => () => void;
  directoryLoading: boolean;
  collectionSummaries: CollectionSummary[];
  artistSummaries: ArtistSummary[];
  artistCount: number;
  savedViewSummaries: SavedViewSummary[];
  savedViewsTotal: number;
  savedViewsHasMore: boolean;
  savedViewsLoading: boolean;
  workResult: WorkQueryResult;
  workQuery: WorkQuery;
  normalSort: WorkSortSnapshot;
  workLoading: boolean;
  collections: CollectionRecord[];
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
  onAddCollectionArtworks: (artworkIds: string[], collectionId: string) => Promise<void>;
  onAssignWorkCollection: (workId: string, collectionId: string) => Promise<void>;
  onUpdateCollectionCover: (collectionId: string, artworkId: string | null) => void;
  onRepairArtistAvatars: () => void;
  onModeChange: (mode: GalleryMode) => void;
  onScopeChange: (scope: GalleryScope | null) => void;
  onLoadMoreSavedViews: () => void;
  onRetryDirectory: () => void;
  onWorkQueryChange: (query: WorkQuery) => void;
  onLoadMoreWorks: () => void;
  onWorkLibraryChanged: () => Promise<void>;
  onAnalyzeWorks: (workIds: string[]) => void;
  onOpenInspiration: (workId: string, pageIndex: number) => void;
  onOpenPixivArtist: (artistId: string) => void;
  onError: (error: unknown) => void;
}) {
  const [lightbox, setLightbox] = useState<{ work: WorkRecord; initialAssetId: string } | null>(null);
  const [openingArtworkId, setOpeningArtworkId] = useState("");
  const openGeneration = useRef(0);
  const [isCreatingSavedView, setIsCreatingSavedView] = useState(false);
  const [editingSavedView, setEditingSavedView] = useState<SavedCollectionView | null>(null);
  const [deletingSavedView, setDeletingSavedView] = useState<SavedCollectionView | null>(null);

  const selectedAuthor = scope?.kind === "artist" ? artistSummaries.find((author) => author.artistId === scope.artistId) ?? null : null;
  const selectedCollection = scope?.kind === "collection" ? collectionSummaries.find((collection) => collection.id === scope.collectionId) ?? null : null;
  const authorDetail = useMemo(() => selectedAuthor ? authorDetailFromSummary(selectedAuthor, scopedArtworks) : null, [selectedAuthor, scopedArtworks]);
  const missingAvatarCount = artistSummaries.filter((author) => author.artist && !author.artist.avatarLocalPath).length;
  const scopeKey = galleryScopeKey(scope);

  function closeLightbox() {
    openGeneration.current += 1;
    setOpeningArtworkId("");
    setLightbox(null);
  }

  function cancelOpeningArtwork() {
    openGeneration.current += 1;
    setOpeningArtworkId("");
  }

  useEffect(() => {
    if (!openingArtworkId) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || document.querySelector(".dialog-overlay")) return;
      event.preventDefault();
      cancelOpeningArtwork();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [openingArtworkId]);

  async function openArtwork(artworkId: string) {
    const clicked = scopedArtworks.find((artwork) => artwork.id === artworkId);
    if (!clicked) return;
    const generation = ++openGeneration.current;
    setOpeningArtworkId(artworkId);
    try {
      const work = await window.sanctuary.getWork(clicked.libraryWorkId);
      if (generation !== openGeneration.current) return;
      if (!work || !work.assets.some((asset) => asset.id === clicked.assetId)) throw new Error("作品页面已不存在，请重新读取图库。");
      setLightbox({ work, initialAssetId: clicked.assetId });
    } catch (error) {
      if (generation === openGeneration.current) onError(error);
    } finally {
      if (generation === openGeneration.current) setOpeningArtworkId("");
    }
  }

  const showAllWorks = () => {
    onWorkQueryChange({ ...normalSort, offset: 0, ...(workQuery.limit ? { limit: workQuery.limit } : {}) });
    onModeChange("flat");
  };

  const viewScopeWorks = (target: Exclude<GalleryScope, { kind: "work" }>) => {
    onWorkQueryChange(directoryScopeWorkQuery(target, normalSort, workQuery.limit));
    onScopeChange(null);
    onModeChange("flat");
  };

  useEffect(() => {
    closeLightbox();
    return () => { openGeneration.current += 1; };
  }, [mode, scopeKey]);

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
              <Button busy={repairingAvatars} busyLabel="正在补全头像…" disabled={!artistSummaries.some((author) => author.artist)} onClick={onRepairArtistAvatars}>
                {missingAvatarCount > 0 ? `补全画师头像 (${missingAvatarCount})` : "重新检查头像"}
              </Button>
              {avatarRepairMessage && <small>{avatarRepairMessage}</small>}
            </div>
          )}
          {mode === "collections" && (
            <Button onClick={() => setIsCreatingSavedView(true)}>新建相册组合</Button>
          )}
          {mode === "collections" && <Button onClick={onCreateCollection}>新建相册</Button>}
          {mode !== "flat" && <Button busy={directoryLoading} busyLabel="正在读取目录…" onClick={onRetryDirectory}>刷新目录</Button>}
          <Button variant="primary" onClick={onImport} busy={busy} busyLabel="正在导入…">导入图片</Button>
        </div>
      </header>

      {error && <AppNotice tone="error">{error}</AppNotice>}
      {openingArtworkId && <AppNotice tone="info"><span>正在读取作品…</span><Button size="small" onClick={cancelOpeningArtwork}>取消读取</Button></AppNotice>}

      <section className="summary-row">
        <article><span>作品</span><strong>{workResult.total}</strong></article>
        <article><span>图片页</span><strong>{workResult.totalPages}</strong></article>
        <article><span>画师</span><strong>{artistCount}</strong></article>
        <article><span>相册</span><strong>{collections.length}</strong></article>
      </section>

      {(mode === "collections" && directoryLoading && collectionSummaries.length === 0) ||
       (mode === "author-work" && directoryLoading && artistSummaries.length === 0) ||
       (mode === "flat" && workLoading && !hasWorkFilters(workQuery) && workResult.total === 0) ? (
        <section className="library-loading" role="status">正在读取图库…</section>
      ) : mode === "flat" && workResult.total === 0 && !hasWorkFilters(workQuery) ? (
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
        scopeLoading && scopedArtworks.length === 0 && selectedCollection ? (
          <section className="library-loading" role="status">正在读取相册页面…</section>
        ) : selectedCollection ? (
          <CollectionDetailPage
            collection={selectedCollection}
            key={selectedCollection.id}
            artworks={scopedArtworks}
            collections={collections}
            onBack={() => onScopeChange(null)}
            onAssign={onAssignCollection}
            onAddArtworks={(ids) => onAddCollectionArtworks(ids, selectedCollection.id)}
            onOpenArtwork={(id) => void openArtwork(id)}
            onSetCover={(artworkId) => onUpdateCollectionCover(selectedCollection.id, artworkId)}
            lightboxOpen={Boolean(lightbox || openingArtworkId)}
            onFilterInGallery={() => viewScopeWorks({ kind: "collection", collectionId: selectedCollection.id })}
            session={detailSession?.kind === "collection" ? detailSession : null}
            onSessionChange={(patch) => onDetailSessionChange({ kind: "collection", collectionId: selectedCollection.id }, patch)}
            onRegisterCapture={(capture) => onRegisterDetailCapture({ kind: "collection", collectionId: selectedCollection.id }, capture)}
          />
        ) : (
          <div className="collections-view-container">
            {/* 1. Saved Collection Views Section */}
            <section className="saved-views-section">
              <div className="section-header-row">
                <div>
                  <h3 className="section-title">组合视图 ({savedViewsTotal})</h3>
                  <p className="section-subtext">把多个相册一起查看，可选择同时包含、任意包含或排除</p>
                </div>
                <Button variant="ghost" onClick={() => setIsCreatingSavedView(true)}>
                  + 新建组合
                </Button>
              </div>

              {savedViewsLoading && savedViewSummaries.length === 0 ? (
                <p role="status">正在读取组合视图…</p>
              ) : savedViewSummaries.length === 0 ? (
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
                  {savedViewSummaries.map((view) => (
                    <SavedCollectionViewCard
                      key={view.id}
                      view={view}
                      collections={collections}
                      onOpen={() => {
                        onWorkQueryChange(savedViewWorkQuery(view.effectiveQuery, normalSort, workQuery.limit));
                        onModeChange("flat");
                      }}
                      onEdit={() => setEditingSavedView(view)}
                      onDelete={() => setDeletingSavedView(view)}
                    />
                  ))}
                </div>
              )}
              {savedViewsHasMore && <Button busy={savedViewsLoading} busyLabel="正在读取…" onClick={onLoadMoreSavedViews}>继续加载组合视图（已显示 {savedViewSummaries.length} / {savedViewsTotal}）</Button>}
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
                {collectionSummaries.map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    onOpen={() => onScopeChange({ kind: "collection", collectionId: collection.id })}
                    onEdit={() => onEditCollection(collection)}
                    onFilter={() => viewScopeWorks({ kind: "collection", collectionId: collection.id })}
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
          normalSort={normalSort}
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
          {!selectedAuthor ? (
            <div className="author-browser-grid">
              {artistSummaries.map((author) => (
                <AuthorBrowserCard key={author.key} author={author} onOpen={() => onScopeChange({ kind: "artist", artistId: author.artistId })} />
              ))}
            </div>
          ) : scopeLoading && scopedArtworks.length === 0 ? (
            <section className="library-loading" role="status">正在读取画师页面…</section>
          ) : authorDetail && (
            <AuthorDetailPage
              key={selectedAuthor.key}
              author={authorDetail}
              collections={collections}
              onBack={() => onScopeChange(null)}
              onAssign={onAssignCollection}
              onOpenArtwork={(id) => void openArtwork(id)}
              onViewWorks={() => viewScopeWorks({ kind: "artist", artistId: selectedAuthor.artistId })}
              onOpenPixivArtist={onOpenPixivArtist}
              lightboxOpen={Boolean(lightbox || openingArtworkId)}
              session={detailSession?.kind === "artist" ? detailSession : null}
              onSessionChange={(patch) => onDetailSessionChange({ kind: "artist", artistId: selectedAuthor.artistId }, patch)}
              onRegisterCapture={(capture) => onRegisterDetailCapture({ kind: "artist", artistId: selectedAuthor.artistId }, capture)}
              mainScrollRef={mainScrollRef}
            />
          )}
        </section>
      )}
      {lightbox && (
        <WorkLightbox
          key={lightbox.work.id + ":" + lightbox.initialAssetId}
          work={lightbox.work}
          initialAssetId={lightbox.initialAssetId}
          onClose={closeLightbox}
          onGenerated={onWorkLibraryChanged}
          onError={onError}
          onOpenInspiration={(workId, pageIndex) => {
            closeLightbox();
            onOpenInspiration(workId, pageIndex);
          }}
        />
      )}

      {(isCreatingSavedView || editingSavedView) && (
        <SavedCollectionViewEditor
          editingView={editingSavedView}
          collections={collections}
          existingViews={savedViewSummaries}
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
            onWorkQueryChange(savedViewWorkQuery({ includedCollectionIds: query.collectionIds, matchMode: query.collectionMatchMode, excludedCollectionIds: query.excludedCollectionIds }, normalSort, workQuery.limit));
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
