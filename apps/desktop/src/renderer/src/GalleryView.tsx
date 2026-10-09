import type { GalleryPictureSearch } from "./useGalleryPictureSearch";
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
import { Icon } from "./Icon";
import { AuthorDetailPage } from "./AuthorGallery";
import { Button } from "./Button";
import { CollectionDetailPage } from "./CollectionGallery";
import { AuthorBrowserCard, CollectionCard, SavedCollectionViewCard } from "./DirectoryCards";
import { DialogOverlay } from "./DialogOverlay";
import { SavedCollectionViewEditor } from "./SavedCollectionViewEditor";
import { WorkLibrary } from "./WorkLibrary";
import { WorkLightbox } from "./WorkLightbox";
import { authorDetailFromSummary, directoryScopeWorkQuery, galleryScopeKey, savedViewWorkQuery } from "./gallery-model";
import { hasWorkFilters, type WorkSortSnapshot } from "./work-presets";
import type { GalleryDetailScope, GalleryDetailSession, GalleryDetailSessionPatch } from "./gallery-detail-session";

export type GalleryMode = "flat" | "author-work" | "collections";

export function GalleryView({
  pictureSearch,
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
  pictureSearch?: GalleryPictureSearch;
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

  const scopeTabs = (
    <nav className="gallery-scope" aria-label="浏览方式">
      {([["flat", "作品"], ["collections", "相册"], ["author-work", "画师"]] as const).map(([value, label]) => (
        <button key={value} type="button" data-scope={value} aria-current={mode === value ? "page" : undefined}
          onClick={() => value === "flat" ? showAllWorks() : onModeChange(value)}>{label}</button>
      ))}
    </nav>
  );

  useEffect(() => {
    closeLightbox();
    return () => { openGeneration.current += 1; };
  }, [mode, scopeKey]);

  return (
    <>
      {mode !== "flat" && !selectedCollection && !selectedAuthor && (
        <header className="gallery-toolbar">
          <div className="gallery-toolbar-row">
            {scopeTabs}
            <div className="gallery-toolbar-actions">
              {mode === "author-work" && (
                <>
                  {avatarRepairMessage && <small className="gallery-toolbar-note">{avatarRepairMessage}</small>}
                  {missingAvatarCount > 0 && <Button variant="ghost" busy={repairingAvatars} busyLabel="正在补全头像…" onClick={onRepairArtistAvatars}>补全头像（{missingAvatarCount}）</Button>}
                </>
              )}
              {mode === "collections" && <Button variant="ghost" onClick={() => setIsCreatingSavedView(true)}>新建组合</Button>}
              {mode === "collections" && <Button variant="primary" onClick={onCreateCollection}><Icon name="plus" size={16} />新建相册</Button>}
              <button type="button" className="ui-icon-button" aria-label="刷新目录" title="刷新目录" disabled={directoryLoading} onClick={onRetryDirectory}><Icon name="refresh" size={16} /></button>
            </div>
          </div>
        </header>
      )}

      {error && <AppNotice tone="error">{error}</AppNotice>}
      {openingArtworkId && <AppNotice tone="info"><span>正在读取作品…</span><Button size="small" onClick={cancelOpeningArtwork}>取消</Button></AppNotice>}

      {(mode === "collections" && directoryLoading && collectionSummaries.length === 0) ||
       (mode === "author-work" && directoryLoading && artistSummaries.length === 0) ||
       (mode === "flat" && workLoading && !hasWorkFilters(workQuery) && workResult.total === 0) ? (
        <section className="library-loading" role="status">正在读取图库…</section>
      ) : mode === "flat" && workResult.total === 0 && !hasWorkFilters(workQuery) ? (
        <section className="gallery-empty gallery-empty--first">
          <h2>图库还是空的</h2>
          <p>导入本地图片，或去探索页保存喜欢的作品。原图保留在原位置。</p>
          <div className="gallery-empty-actions">
            <Button variant="primary" onClick={onImport} busy={busy} busyLabel="正在导入…"><Icon name="plus" size={16} />导入图片</Button>
            <Button onClick={onOpenExplore}>去探索</Button>
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
          <div className="directory-page">
            {(savedViewsTotal > 0 || savedViewsLoading) && (
              <section className="directory-section" aria-label="相册组合">
                <h2>相册组合 <small>{savedViewsTotal}</small></h2>
                {savedViewsLoading && savedViewSummaries.length === 0 ? <p role="status" className="directory-status">正在读取…</p> : (
                  <div className="directory-grid">
                    {savedViewSummaries.map((view) => (
                      <SavedCollectionViewCard key={view.id} view={view} collections={collections}
                        onOpen={() => { onWorkQueryChange(savedViewWorkQuery(view.effectiveQuery, normalSort, workQuery.limit)); onModeChange("flat"); }}
                        onEdit={() => setEditingSavedView(view)} onDelete={() => setDeletingSavedView(view)} />
                    ))}
                  </div>
                )}
                {savedViewsHasMore && <Button variant="ghost" busy={savedViewsLoading} busyLabel="正在读取…" onClick={onLoadMoreSavedViews}>继续加载（{savedViewSummaries.length}/{savedViewsTotal}）</Button>}
              </section>
            )}
            <section className="directory-section" aria-label="相册">
              {(savedViewsTotal > 0 || savedViewsLoading) && <h2>相册 <small>{collections.length}</small></h2>}
              {collections.length === 0 ? (
                <div className="gallery-empty">
                  <h2>还没有相册</h2>
                  <p>相册用来归类作品，一件作品可以放进多个相册。</p>
                  <div className="gallery-empty-actions"><Button variant="primary" onClick={onCreateCollection}><Icon name="plus" size={16} />新建相册</Button></div>
                </div>
              ) : (
                <div className="directory-grid">
                  {collectionSummaries.map((collection) => (
                    <CollectionCard key={collection.id} collection={collection}
                      onOpen={() => onScopeChange({ kind: "collection", collectionId: collection.id })}
                      onEdit={() => onEditCollection(collection)}
                      onFilter={() => viewScopeWorks({ kind: "collection", collectionId: collection.id })} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )
      ) : mode === "flat" ? (
        <WorkLibrary
          pictureSearch={pictureSearch}
          result={workResult}
          query={workQuery}
          normalSort={normalSort}
          collections={collections}
          loading={workLoading}
          scopeTabs={scopeTabs}
          importing={busy}
          onImport={onImport}
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
            <div className="directory-grid">
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
