import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { CollectionRecord, WorkDeletionPreview, WorkListItem, WorkQuery, WorkQueryResult, WorkRecord } from "@sanctuary/domain";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { GallerySearchField, GallerySearchStatus } from "./GallerySearchBar";
import { Icon } from "./Icon";
import { ExportImagesButton } from "./ImageOutputActions";
import { MenuItem, Popover, type PopoverAnchor } from "./Popover";
import { RenameWorkDialog } from "./RenameWorkDialog";
import { FilterChips, FilterMenuButton, SortMenuButton } from "./WorkFilters";
import { WorkContextMenu, WorkTile, type WorkTileHandlers } from "./WorkGrid";
import { WorkLightbox } from "./WorkLightbox";
import { pictureSearchScopeKey } from "./gallery-picture-search";
import type { GalleryPictureSearch } from "./useGalleryPictureSearch";
import { workFilterChips } from "./work-filters";
import { getWorkPreset, workEmptyMessage, type WorkSortSnapshot } from "./work-presets";

const EMPTY_RESULT: WorkQueryResult = { items: [], total: 0, totalPages: 0, offset: 0, limit: 60, hasMore: false };
type Notice = { message: string; undo?: () => Promise<void> };

export function WorkLibrary({
  pictureSearch,
  result: normalResult,
  query,
  normalSort,
  collections,
  loading: normalLoading,
  scopeTabs,
  importing,
  onImport,
  onQueryChange,
  onLoadMore: loadMoreWorks,
  onAssignCollection,
  onLibraryChanged: libraryChanged,
  onOpenInspiration,
  onError
}: {
  pictureSearch?: GalleryPictureSearch | undefined;
  result: WorkQueryResult;
  query: WorkQuery;
  normalSort: WorkSortSnapshot;
  collections: CollectionRecord[];
  loading: boolean;
  scopeTabs: ReactNode;
  importing: boolean;
  onImport: () => void;
  onQueryChange: (query: WorkQuery) => void;
  onLoadMore: () => void;
  onAssignCollection: (workId: string, collectionId: string) => Promise<void>;
  onLibraryChanged: () => Promise<void>;
  onOpenInspiration: (workId: string, pageIndex: number, sources?: Array<{ workId: string; pageIndex: number }>) => void;
  onError: (error: unknown) => void;
}) {
  // Picture search swaps in its own result set while keeping the gallery filters as its scope.
  const searchingPictures = Boolean(pictureSearch?.mode === "picture" && (pictureSearch.snapshot || pictureSearch.pending || pictureSearch.error));
  const stalePictureScope = Boolean(pictureSearch?.snapshot && pictureSearchScopeKey(pictureSearch.snapshot.progress.galleryQuery ?? {}) !== pictureSearchScopeKey(query));
  const result: WorkQueryResult = searchingPictures ? (stalePictureScope ? EMPTY_RESULT : pictureSearch?.snapshot?.result ?? EMPTY_RESULT) : normalResult;
  const loading = searchingPictures ? Boolean(pictureSearch?.pending || (pictureSearch?.running && !stalePictureScope)) : normalLoading;
  const onLoadMore = searchingPictures ? () => void pictureSearch?.loadMore() : loadMoreWorks;
  const onLibraryChanged = async () => { await libraryChanged(); if (searchingPictures) await pictureSearch?.refresh(); };
  const searchSession = `${searchingPictures}|${pictureSearch?.snapshot?.progress.id}|${pictureSearch?.relevance}|${stalePictureScope}`;

  useEffect(() => {
    if (query.search && pictureSearch?.mode === "picture") { pictureSearch.setMode("name"); pictureSearch.setDraft(query.search); }
  }, [query.search]);

  const [selectedWork, setSelectedWork] = useState<{ work: WorkRecord; assetId?: string } | null>(null);
  const [renamingWork, setRenamingWork] = useState<{ id: string; title: string } | null>(null);
  const [openingWorkId, setOpeningWorkId] = useState("");
  const [busyWorkId, setBusyWorkId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletionPreview, setDeletionPreview] = useState<WorkDeletionPreview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menu, setMenu] = useState<{ work: WorkListItem; anchor: PopoverAnchor } | null>(null);
  const [albumMenu, setAlbumMenu] = useState<HTMLElement | null>(null);
  const activeCollection = collections.find((collection) => collection.id === query.collectionId) ?? null;
  const preset = getWorkPreset(query);
  const artistName = query.artistId ? normalResult.items.find((item) => item.artistId === query.artistId)?.artistName : null;
  const chips = useMemo(() => workFilterChips(query, collections, normalSort, artistName), [query, collections, normalSort, artistName]);
  const lastSelectedWorkId = useRef<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const openRequestRef = useRef(0);

  useEffect(() => { exitSelection(); openRequestRef.current += 1; setOpeningWorkId(""); }, [searchSession]);
  useEffect(() => () => { openRequestRef.current += 1; }, []);
  useEffect(() => {
    if (!notice || notice.undo) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !result.hasMore || loading || !("IntersectionObserver" in window)) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (!requested && entries.some((entry) => entry.isIntersecting)) { requested = true; onLoadMore(); }
    }, { rootMargin: "900px 0px", threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, onLoadMore, result.hasMore, result.items.length]);

  function exitSelection() {
    setSelectedIds(new Set());
    setSelecting(false);
    lastSelectedWorkId.current = null;
  }

  async function openWork(item: WorkListItem) {
    const request = ++openRequestRef.current;
    setOpeningWorkId(item.id);
    try {
      const work = await window.sanctuary.getWork(item.id);
      if (request !== openRequestRef.current) return;
      if (!work) throw new Error("作品记录不存在，可能已经被移出图库。");
      setSelectedWork({ work, ...(item.matchedPage !== undefined && item.coverAsset ? { assetId: item.coverAsset.id } : {}) });
    } catch (error) {
      if (request === openRequestRef.current) onError(error);
    } finally {
      if (request === openRequestRef.current) setOpeningWorkId("");
    }
  }

  function toggleSelection(workId: string, shiftKey = false) {
    setSelecting(true);
    setSelectedIds((current) => {
      const next = new Set(current);
      const anchorIndex = lastSelectedWorkId.current ? result.items.findIndex((work) => work.id === lastSelectedWorkId.current) : -1;
      const targetIndex = result.items.findIndex((work) => work.id === workId);
      if (shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
        for (let index = Math.min(anchorIndex, targetIndex); index <= Math.max(anchorIndex, targetIndex); index += 1) {
          const id = result.items[index]?.id;
          if (id) next.add(id);
        }
      } else if (next.has(workId)) next.delete(workId);
      else next.add(workId);
      lastSelectedWorkId.current = workId;
      return next;
    });
  }

  async function previewDeletion(ids: string[]) {
    if (!ids.length) return;
    try { setDeletionPreview(await window.sanctuary.previewWorkDeletion(ids)); } catch (error) { onError(error); }
  }

  async function confirmDeletion() {
    if (!deletionPreview) return;
    setDeleting(true);
    try {
      const outcome = await window.sanctuary.confirmWorkDeletion(deletionPreview.token);
      setDeletionPreview(null);
      exitSelection();
      await onLibraryChanged();
      setNotice({ message: outcome.failures.length > 0
        ? `已移出 ${outcome.completedWorkIds.length} 件，${outcome.failures.length} 件失败。`
        : `已移出 ${outcome.completedWorkIds.length} 件。图库保存的文件已进入回收站。` });
    } catch (error) {
      onError(error);
    } finally {
      setDeleting(false);
    }
  }

  /** One mutation per work at a time; a returned notice may carry an undo. */
  async function mutateWork(work: WorkListItem, operation: () => Promise<Notice | void>) {
    if (busyWorkId) return;
    setBusyWorkId(work.id);
    try { const next = await operation(); if (next) setNotice(next); }
    catch (error) { onError(error); }
    finally { setBusyWorkId(""); }
  }
  const favorite = (work: WorkListItem) => mutateWork(work, async () => {
    const next = !work.favorite;
    await window.sanctuary.updateWorkFavorite([work.id], next);
    await onLibraryChanged();
    return { message: next ? `已喜欢《${work.title}》` : `已取消喜欢《${work.title}》`,
      undo: async () => { await window.sanctuary.updateWorkFavorite([work.id], !next); await onLibraryChanged(); } };
  });
  const addToAlbum = (work: WorkListItem, collectionId: string) => mutateWork(work, async () => {
    await onAssignCollection(work.id, collectionId);
    const name = collections.find((item) => item.id === collectionId)?.name ?? "相册";
    return { message: `已把《${work.title}》加入“${name}”`,
      undo: async () => { await window.sanctuary.removeWorkFromCollection(work.id, collectionId); await onLibraryChanged(); } };
  });
  const removeFromAlbum = (work: WorkListItem) => activeCollection && mutateWork(work, async () => {
    await window.sanctuary.removeWorkFromCollection(work.id, activeCollection.id);
    await onLibraryChanged();
    return { message: `已把《${work.title}》移出“${activeCollection.name}”`,
      undo: async () => { await window.sanctuary.addWorkToCollection(work.id, activeCollection.id); await onLibraryChanged(); } };
  });
  const useCover = (work: WorkListItem, action: "copy" | "reveal") => work.coverAsset && mutateWork(work, async () => {
    await window.sanctuary.useImage({ workId: work.id, assetId: work.coverAsset!.id }, action);
    if (action === "copy") return { message: work.pageCount > 1 && work.matchedPage === undefined ? "已复制封面。复制全部页面请先选择作品。" : "图片已复制，可以粘贴使用" };
  });

  // Tiles are memoized; route events through a ref so appending a page does not re-render existing tiles.
  const latest = useRef({ selecting, toggleSelection, openWork, favorite, onError });
  useLayoutEffect(() => { latest.current = { selecting, toggleSelection, openWork, favorite, onError }; });
  const handlers = useMemo<WorkTileHandlers>(() => ({
    onOpen: (work: WorkListItem, event: MouseEvent) => {
      const current = latest.current;
      if (current.selecting || event.ctrlKey || event.metaKey) current.toggleSelection(work.id, event.shiftKey);
      else void current.openWork(work);
    },
    onToggleSelection: (workId, shiftKey) => latest.current.toggleSelection(workId, shiftKey),
    onFavorite: (work) => void latest.current.favorite(work),
    onContextMenu: (work, anchor) => setMenu({ work, anchor }),
    onDragError: (error) => latest.current.onError(error)
  }), []);

  const selectedList = [...selectedIds];
  const allLoadedSelected = result.items.length > 0 && result.items.every((work) => selectedIds.has(work.id));
  const empty = result.items.length === 0 && !loading;
  const emptyMessage = workEmptyMessage(query);

  return (
    <>
      <header className="gallery-toolbar">
        <div className="gallery-toolbar-row">
          {scopeTabs}
          {pictureSearch ? <GallerySearchField search={pictureSearch} query={query} onQueryChange={onQueryChange} /> : (
            <label className="ui-search gallery-search-field"><Icon name="search" size={16} />
              <input type="search" aria-label="搜索图库" value={query.search ?? ""} placeholder="搜索标题、画师或 Pixiv ID"
                onChange={(event) => onQueryChange({ ...query, search: event.target.value, offset: 0 })} /></label>
          )}
          <div className="gallery-toolbar-actions">
            <FilterMenuButton query={query} collections={collections} normalSort={normalSort} activeCount={chips.length} onQueryChange={onQueryChange} />
            <SortMenuButton query={query} onQueryChange={onQueryChange}
              disabledReason={searchingPictures ? "相似度" : preset === "recent" ? "浏览时间" : undefined} />
            <button type="button" className="ui-tool-button" aria-label={selecting ? "完成选择" : "选择作品"} aria-pressed={selecting} disabled={searchingPictures && Boolean(pictureSearch?.running)}
              onClick={() => selecting ? exitSelection() : setSelecting(true)}>
              <Icon name="select" size={16} /><span>{selecting ? "完成" : "选择"}</span>
            </button>
            <Button variant="primary" busy={importing} busyLabel="正在导入…" onClick={onImport}><Icon name="plus" size={16} />导入</Button>
          </div>
        </div>
        {pictureSearch && <GallerySearchStatus search={pictureSearch} query={query} />}
        <FilterChips chips={chips} query={query} normalSort={normalSort} onQueryChange={onQueryChange} />
      </header>

      <div className="work-result-meta">
        <span>{result.total} 件{searchingPictures ? ` · ${result.totalPages} 张${pictureSearch?.relevance === "all" ? "候选" : "匹配"}图片` : result.totalPages > result.total ? ` · ${result.totalPages} 页` : ""}</span>
        {loading && <span className="work-querying">正在更新…</span>}
      </div>

      {empty ? (
        <section className="gallery-empty">
          <h2>{searchingPictures ? (stalePictureScope ? "按当前范围重新找图" : pictureSearch?.error || pictureSearch?.snapshot?.progress.error ? "找图暂未完成"
            : pictureSearch?.snapshot?.progress.phase === "cancelled" ? "已停止找图" : pictureSearch?.snapshot?.relevance.hiddenWorks ? "没有较相关的图片" : "没有可用的搜索结果") : emptyMessage.title}</h2>
          <p>{searchingPictures ? (!stalePictureScope && pictureSearch?.snapshot?.relevance.hiddenWorks ? "换一种描述，或在上方显示弱相关结果。" : "在搜索框描述画面后按回车。") : emptyMessage.description}</p>
          {chips.length > 0 && <Button onClick={() => onQueryChange(chips.reduce((next, chip) => chip.clear(next), query))}>清除筛选</Button>}
        </section>
      ) : (
        <section className="work-grid" aria-busy={loading} aria-label="作品">
          {result.items.map((work) => (
            <WorkTile key={work.id} work={work} selecting={selecting} selected={selectedIds.has(work.id)}
              opening={openingWorkId === work.id} busy={busyWorkId === work.id} handlers={handlers} />
          ))}
        </section>
      )}

      {result.hasMore && (
        <div className="work-load-more" ref={loadMoreRef}>
          <Button variant="ghost" busy={loading} busyLabel="正在读取…" onClick={onLoadMore}>继续加载（{result.items.length}/{result.total}）</Button>
        </div>
      )}

      {menu && (
        <WorkContextMenu work={menu.work} anchor={menu.anchor} collections={collections} activeCollectionName={activeCollection?.name}
          onClose={() => setMenu(null)}
          actions={{
            open: () => void openWork(menu.work),
            favorite: () => void favorite(menu.work),
            addToAlbum: (collectionId) => void addToAlbum(menu.work, collectionId),
            removeFromAlbum: activeCollection ? () => void removeFromAlbum(menu.work) : undefined,
            copy: () => void useCover(menu.work, "copy"),
            reveal: () => void useCover(menu.work, "reveal"),
            rename: () => setRenamingWork({ id: menu.work.id, title: menu.work.title }),
            select: () => toggleSelection(menu.work.id),
            remove: () => void previewDeletion([menu.work.id])
          }} />
      )}

      {selecting && (
        <section className="work-selection-bar" aria-live="polite" aria-label="批量操作">
          <strong>已选 {selectedIds.size} 件</strong>
          <button type="button" className="ui-tool-button" disabled={!result.items.length}
            onClick={() => setSelectedIds(allLoadedSelected ? new Set() : new Set(result.items.map((work) => work.id)))}>
            {allLoadedSelected ? "取消全选" : "全选已加载"}
          </button>
          <span className="work-selection-divider" />
          <button type="button" className="ui-tool-button" disabled={!result.items.some((work) => selectedIds.has(work.id) && !work.favorite)}
            onClick={async () => {
              const ids = result.items.filter((work) => selectedIds.has(work.id) && !work.favorite).map((work) => work.id);
              try {
                await window.sanctuary.updateWorkFavorite(ids, true); await onLibraryChanged();
                setNotice({ message: `已喜欢 ${ids.length} 件`, undo: async () => { await window.sanctuary.updateWorkFavorite(ids, false); await onLibraryChanged(); } });
              } catch (error) { onError(error); }
            }}><Icon name="heart" size={16} /><span>喜欢</span></button>
          <button type="button" className="ui-tool-button" aria-haspopup="menu" aria-expanded={Boolean(albumMenu)} disabled={!selectedIds.size || !collections.length}
            onClick={(event) => setAlbumMenu(albumMenu ? null : event.currentTarget)}><Icon name="album" size={16} /><span>加入相册</span></button>
          <ExportImagesButton targets={selectedList.map((workId) => ({ workId }))} label="复制原图到…" disabled={!selectedIds.size} />
          <button type="button" className="ui-tool-button" disabled={!selectedIds.size || selectedIds.size > 4} title={selectedIds.size > 4 ? "一次最多带 4 张图去创作" : undefined}
            onClick={() => {
              // Each selected work goes in as the page currently shown on its tile.
              const sources = selectedList.map((workId) => ({ workId, pageIndex: result.items.find((work) => work.id === workId)?.coverAsset?.pageIndex ?? 0 }));
              onOpenInspiration(sources[0]!.workId, sources[0]!.pageIndex, sources);
            }}><Icon name="create" size={16} /><span>拿去创作</span></button>
          <button type="button" className="ui-tool-button work-selection-danger" disabled={!selectedIds.size} onClick={() => void previewDeletion(selectedList)}><Icon name="remove" size={16} /><span>移出图库</span></button>
          <span className="work-selection-divider" />
          <button type="button" className="ui-icon-button" aria-label="退出选择" title="退出选择" onClick={exitSelection}><Icon name="close" size={16} /></button>
        </section>
      )}
      {albumMenu && (
        <Popover anchor={albumMenu} label="加入相册" onClose={() => setAlbumMenu(null)}>
          {collections.map((collection) => <MenuItem key={collection.id} icon="album" label={collection.name} onSelect={async () => {
            setAlbumMenu(null);
            const ids = [...selectedIds];
            try {
              await Promise.all(ids.map((workId) => window.sanctuary.addWorkToCollection(workId, collection.id)));
              await onLibraryChanged();
              setNotice({ message: `已把 ${ids.length} 件加入“${collection.name}”`,
                undo: async () => { await Promise.all(ids.map((workId) => window.sanctuary.removeWorkFromCollection(workId, collection.id))); await onLibraryChanged(); } });
            } catch (error) { onError(error); }
          }} />)}
        </Popover>
      )}

      {notice && (
        <div className="ui-toast-region">
          <AppNotice tone="success" actionLabel={notice.undo ? "撤销" : undefined} onDismiss={() => setNotice(null)}
            onAction={notice.undo ? async () => { try { await notice.undo?.(); setNotice(null); } catch (error) { onError(error); } } : undefined}>
            {notice.message}
          </AppNotice>
        </div>
      )}

      {renamingWork && <RenameWorkDialog key={renamingWork.id} work={renamingWork} onClose={() => setRenamingWork(null)} onSaved={async (title) => {
        setNotice({ message: `已改名为《${title}》` });
        try { await onLibraryChanged(); } catch { throw new Error("名称已保存，列表刷新失败。请稍后重新进入图库查看。"); }
      }} />}

      {selectedWork && (
        <WorkLightbox work={selectedWork.work} {...(selectedWork.assetId ? { initialAssetId: selectedWork.assetId } : {})}
          onClose={() => setSelectedWork(null)} onGenerated={onLibraryChanged} onOpenInspiration={onOpenInspiration} onError={onError} />
      )}

      {deletionPreview && <WorkDeleteDialog preview={deletionPreview} deleting={deleting} onCancel={() => setDeletionPreview(null)} onConfirm={() => void confirmDeletion()} />}
    </>
  );
}

function WorkDeleteDialog({ preview, deleting, onCancel, onConfirm }: { preview: WorkDeletionPreview; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <DialogOverlay busy={deleting} onClose={onCancel}>
      <section className="dialog-surface work-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="work-delete-title">
        <h2 id="work-delete-title">移出 {preview.items.length} 件作品？</h2>
        <div className="work-delete-summary">
          <div><strong>{preview.managedWorkCount}</strong><span>图库保存</span><small>文件移至回收站</small></div>
          <div><strong>{preview.externalWorkCount}</strong><span>外部引用</span><small>只移除记录，不动原文件</small></div>
          <div><strong>{preview.fileCount}</strong><span>图片文件</span><small>{formatBytes(preview.byteLength)}</small></div>
        </div>
        <div className="work-delete-list">
          {preview.items.slice(0, 6).map((item) => (
            <div key={item.id}><span>{item.title}</span><small>{item.ownership === "managed" ? "移至回收站" : "仅移除记录"} · {item.fileCount} 页</small></div>
          ))}
          {preview.items.length > 6 && <p>以及另外 {preview.items.length - 6} 件</p>}
        </div>
        <footer>
          <Button disabled={deleting} onClick={onCancel}>取消</Button>
          <Button variant="danger" busy={deleting} busyLabel="正在移出…" onClick={onConfirm}>移出</Button>
        </footer>
      </section>
    </DialogOverlay>
  );
}

function formatBytes(value: number): string {
  if (value <= 0) return "大小待补充";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
