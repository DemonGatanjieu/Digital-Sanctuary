import { ArtworkToolsMenu } from "./ArtworkToolsMenu";
import { WorkInformationDrawer } from "./WorkInformationDrawer";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AppearancePreferences,
  CollectionRecord,
  VisionEvaluationResult,
  WorkListItem,
  WorkDeletionPreview,
  WorkQuery,
  WorkQueryResult,
  WorkRecord,
  GenerationProvenance
} from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";
import { RadarEvaluationPanel } from "./RadarEvaluationPanel";
import { ElementInspectorDrawer } from "./ElementInspectorDrawer";
import { useCinemaViewer } from "./useCinemaViewer";
import { SegmentedControl } from "./SegmentedControl";
import { applyWorkPreset, getWorkPreset, workEmptyMessage, type WorkSortSnapshot } from "./work-presets";
import { initialWorkPageIndex, isReadableWorkAsset } from "./work-reading";
import { useWorkReading } from "./useWorkReading";


export function WorkLibrary({
  result,
  query,
  normalSort,
  collections,
  appearance,
  loading,
  onQueryChange,
  onLoadMore,
  onAssignCollection,
  onLibraryChanged,
  onAnalyzeWorks,
  onOpenInspiration,
  onError
}: {
  result: WorkQueryResult;
  query: WorkQuery;
  normalSort: WorkSortSnapshot;
  collections: CollectionRecord[];
  appearance: AppearancePreferences;
  loading: boolean;
  onQueryChange: (query: WorkQuery) => void;
  onLoadMore: () => void;
  onAssignCollection: (workId: string, collectionId: string) => Promise<void>;
  onLibraryChanged: () => Promise<void>;
  onAnalyzeWorks: (workIds: string[]) => void;
  onOpenInspiration: (workId: string, pageIndex: number) => void;
  onError: (error: unknown) => void;
}) {
  const [selectedWork, setSelectedWork] = useState<WorkRecord | null>(null);
  const [openingWorkId, setOpeningWorkId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletionPreview, setDeletionPreview] = useState<WorkDeletionPreview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; undo?: () => Promise<void> } | null>(null);
  const preset = getWorkPreset(query);
  const emptyMessage = workEmptyMessage(query);
  const showAllWorks = () => onQueryChange({ ...normalSort, offset: 0, ...(query.limit ? { limit: query.limit } : {}) });
  const activeCollection = collections.find((collection) => collection.id === query.collectionId) ?? null;
  const isCombinationFilter = Boolean(
    (query.collectionIds && query.collectionIds.length > 0) ||
    (query.excludedCollectionIds && query.excludedCollectionIds.length > 0)
  );

  const combinationSummary = useMemo(() => {
    if (!isCombinationFilter) return "";
    const incNames = (query.collectionIds ?? []).map(
      (id) => collections.find((c) => c.id === id)?.name ?? "未知分类"
    );
    const excNames = (query.excludedCollectionIds ?? []).map(
      (id) => collections.find((c) => c.id === id)?.name ?? "未知分类"
    );
    const op = query.collectionMatchMode === "all" ? " + " : " | ";
    let str = "";
    if (incNames.length > 0) str += incNames.join(op);
    else str += "全库作品";
    if (excNames.length > 0) str += " - " + excNames.join(" - ");
    return str;
  }, [isCombinationFilter, query.collectionIds, query.excludedCollectionIds, query.collectionMatchMode, collections]);

  const featuredWork = result.items[0] ?? null;
  const lastSelectedWorkId = useRef<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const openRequestRef = useRef(0);
  useEffect(() => () => { openRequestRef.current += 1; }, []);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !result.hasMore || loading || !("IntersectionObserver" in window)) return;
    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!requested && entries.some((entry) => entry.isIntersecting)) {
          requested = true;
          onLoadMore();
        }
      },
      { rootMargin: "700px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, onLoadMore, result.hasMore, result.items.length]);

  async function openWork(item: WorkListItem) {
    const request = ++openRequestRef.current;
    setOpeningWorkId(item.id);
    try {
      const work = await window.sanctuary.getWork(item.id);
      if (request !== openRequestRef.current) return;
      if (!work) throw new Error("作品记录不存在，可能已经被移出画廊。");
      setSelectedWork(work);
    } catch (error) {
      if (request === openRequestRef.current) onError(error);
    } finally {
      if (request === openRequestRef.current) setOpeningWorkId("");
    }
  }

  function toggleSelection(workId: string, shiftKey = false) {
    setSelectedIds((current) => {
      const next = new Set(current);
      const anchorId = lastSelectedWorkId.current;
      const anchorIndex = anchorId ? result.items.findIndex((work) => work.id === anchorId) : -1;
      const targetIndex = result.items.findIndex((work) => work.id === workId);
      if (shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
        for (let index = Math.min(anchorIndex, targetIndex); index <= Math.max(anchorIndex, targetIndex); index += 1) {
          const id = result.items[index]?.id;
          if (id) next.add(id);
        }
      } else {
        next.has(workId) ? next.delete(workId) : next.add(workId);
      }
      lastSelectedWorkId.current = workId;
      return next;
    });
  }

  async function previewDeletion() {
    if (selectedIds.size === 0) return;
    try {
      setDeletionPreview(await window.sanctuary.previewWorkDeletion([...selectedIds]));
    } catch (error) {
      onError(error);
    }
  }

  async function confirmDeletion() {
    if (!deletionPreview) return;
    setDeleting(true);
    try {
      const result = await window.sanctuary.confirmWorkDeletion(deletionPreview.token);
      setDeletionPreview(null);
      setSelectedIds(new Set());
      setSelecting(false);
      lastSelectedWorkId.current = null;
      await onLibraryChanged();
      setNotice({ message: result.failures.length > 0
        ? `已处理 ${result.completedWorkIds.length} 个作品，${result.failures.length} 个失败。`
        : `已处理 ${result.completedWorkIds.length} 个作品。托管文件已进入系统回收站。` });
    } catch (error) {
      onError(error);
    } finally {
      setDeleting(false);
    }
  }

  // Stable delegates let existing cards skip page appends/status updates while always seeing current handlers and selection state.
  const handleOpenWork = useStableWorkCallback((work: WorkListItem, shiftKey: boolean) => {
    if (selecting) toggleSelection(work.id, shiftKey);
    else void openWork(work);
  });
  const handleToggleSelection = useStableWorkCallback((workId: string, shiftKey: boolean) => toggleSelection(workId, shiftKey));
  const handleAssignWork = useStableWorkCallback(async (work: WorkListItem, collectionId: string) => {
    await onAssignCollection(work.id, collectionId);
    const collectionName = collections.find((item) => item.id === collectionId)?.name ?? "相册";
    setNotice({
      message: `已把《${work.title}》加入相册“${collectionName}”。`,
      undo: async () => {
        await window.sanctuary.removeWorkFromCollection(work.id, collectionId);
        await onLibraryChanged();
      }
    });
  });
  const handleFavoriteWork = useStableWorkCallback(async (work: WorkListItem) => {
    const next = !work.favorite;
    await window.sanctuary.updateWorkFavorite([work.id], next);
    await onLibraryChanged();
    setNotice({
      message: next ? `已喜欢《${work.title}》。` : `已取消喜欢《${work.title}》。`,
      undo: async () => {
        await window.sanctuary.updateWorkFavorite([work.id], !next);
        await onLibraryChanged();
      }
    });
  });
  const handleRemoveFromCollection = useStableWorkCallback(async (work: WorkListItem) => {
    if (!activeCollection) return;
    await window.sanctuary.removeWorkFromCollection(work.id, activeCollection.id);
    await onLibraryChanged();
    setNotice({
      message: `已把《${work.title}》移出相册“${activeCollection.name}”。`,
      undo: async () => {
        await window.sanctuary.addWorkToCollection(work.id, activeCollection.id);
        await onLibraryChanged();
      }
    });
  });
  const handleMutationError = useStableWorkCallback((error: unknown) => onError(error));

  return (
    <>
      {featuredWork?.coverAsset && !query.search && appearance.ambientArtwork && appearance.displayProfile !== "efficient" && (
        <section className="work-ambient-hero">
          <img className="work-ambient-backdrop" src={workImageUrl(featuredWork.coverAsset.thumbnailPath ?? featuredWork.coverAsset.path)} alt="" aria-hidden="true" />
          <div className="work-ambient-copy">
            <span>{activeCollection ? "相册精选" : preset === "recent" ? "最近浏览" : preset === "favorites" ? "喜欢的作品" : "作品精选"}</span>
            <strong>{featuredWork.title}</strong>
            <small>{featuredWork.artistName ?? "本地作品"} · {featuredWork.pageCount} 页</small>
            <button type="button" onClick={() => void openWork(featuredWork)}>继续欣赏</button>
          </div>
          <img className="work-ambient-cover" src={workImageUrl(featuredWork.coverAsset.thumbnailPath ?? featuredWork.coverAsset.path)} alt="" />
        </section>
      )}
      <div className="work-preset-row">
        <SegmentedControl
          label="常用筛选"
          value={preset}
          options={[
            { value: "all", label: "全部" },
            { value: "favorites", label: "喜欢" },
            { value: "recent", label: "最近浏览", title: "按最近看过的时间排列，打开作品继续上次读到的页" },
            { value: "uncollected", label: "未分相册" }
          ]}
          onChange={(next) => onQueryChange(applyWorkPreset(query, next, normalSort))}
        />
        {preset === "recent" && <small>按最近浏览排列 · 自动记住读到的页</small>}
      </div>

      <section className="work-library-controls" aria-label="画廊搜索与排序">
        <label className="work-search">
          <span>⌕</span>
          <input
            type="search"
            value={query.search ?? ""}
            placeholder="搜索标题、作者或 Pixiv ID"
            onChange={(event) => onQueryChange({ ...query, search: event.target.value, offset: 0 })}
          />
        </label>
        <select
          aria-label="作品类型"
          value={query.workType ?? ""}
          onChange={(event) => {
            const { workType: _currentWorkType, ...withoutWorkType } = query;
            onQueryChange(event.target.value
              ? {
                  ...withoutWorkType,
                  workType: event.target.value as NonNullable<WorkQuery["workType"]>,
                  offset: 0
                }
              : { ...withoutWorkType, offset: 0 });
          }}
        >
          <option value="">全部类型</option>
          <option value="illustration">插画</option>
          <option value="manga">漫画</option>
          <option value="ugoira">动图</option>
          <option value="local">本地导入</option>
          <option value="unknown">待补充</option>
        </select>
        <select
          aria-label="排序字段"
          value={query.sortBy ?? "savedAt"}
          disabled={preset === "recent"}
          onChange={(event) => onQueryChange({
            ...query,
            sortBy: event.target.value as NonNullable<WorkQuery["sortBy"]>,
            offset: 0
          })}
        >
          <option value="savedAt">本地保存时间</option>
          {preset === "recent" && <option value="lastViewedAt">最近浏览时间</option>}
          <option value="publishedAt">Pixiv 发布时间</option>
          <option value="title">标题</option>
          <option value="artist">作者</option>
          <option value="pageCount">页数</option>
          <option value="byteLength">文件大小</option>
        </select>
        <button
          type="button"
          className="work-sort-direction"
          disabled={preset === "recent"}
          title={query.direction === "asc" ? "当前升序" : "当前降序"}
          onClick={() => onQueryChange({
            ...query,
            direction: query.direction === "asc" ? "desc" : "asc",
            offset: 0
          })}
        >
          {query.direction === "asc" ? "升序 ↑" : "降序 ↓"}
        </button>
        <button
          type="button"
          className={`work-select-toggle ${selecting ? "active" : ""}`}
          onClick={() => {
            setSelecting((value) => !value);
            setSelectedIds(new Set());
            lastSelectedWorkId.current = null;
          }}
        >
          {selecting ? "退出选择" : "选择"}
        </button>
      </section>

      {activeCollection && (
        <section className="work-collection-context">
          <div><span>当前分类</span><strong>{activeCollection.name}</strong>{activeCollection.description && <small>{activeCollection.description}</small>}</div>
          <button type="button" onClick={showAllWorks}>查看全部作品</button>
        </section>
      )}

      {isCombinationFilter && (
        <section className="work-collection-context work-combination-context">
          <div>
            <span>当前组合</span>
            <strong>{combinationSummary}</strong>
            <small className="combo-mode-label">
              {query.collectionMatchMode === "all" ? "全部满足 (AND)" : "任意满足 (OR)"}
            </small>
          </div>
          <button type="button" onClick={showAllWorks}>查看全部作品</button>
        </section>
      )}

      <div className="work-result-note">
        <span>{result.total} 个作品 · {result.totalPages} 页</span>
        {loading && <span className="work-querying">正在更新…</span>}
      </div>

      {result.items.length === 0 && !loading ? (
        <section className="empty-state compact-empty">
          <p className="eyebrow">NO MATCHES</p>
          <h2>{emptyMessage.title}</h2>
          <p>{emptyMessage.description}</p>
        </section>
      ) : (
        <section className="work-library-grid" aria-busy={loading}>
          {result.items.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              collections={collections}
              opening={openingWorkId === work.id}
              selecting={selecting}
              selected={selectedIds.has(work.id)}
              onOpen={handleOpenWork}
              onToggleSelection={handleToggleSelection}
              onAssign={handleAssignWork}
              onFavorite={handleFavoriteWork}
              onRemoveFromCollection={activeCollection ? handleRemoveFromCollection : null}
              onMutationError={handleMutationError}
            />
          ))}
        </section>
      )}

      {result.hasMore && (
        <div className="work-load-more" ref={loadMoreRef}>
          <Button busy={loading} busyLabel="正在读取…" onClick={onLoadMore}>
            继续加载（已显示 {result.items.length} / {result.total}）
          </Button>
        </div>
      )}

      {selecting && (
        <section className="work-selection-bar" aria-live="polite">
          <div><strong>已选择 {selectedIds.size} 个作品</strong><span>批量操作以作品为单位，包含其全部页面。</span></div>
          <select
            value=""
            disabled={selectedIds.size === 0 || collections.length === 0}
            onChange={async (event) => {
              const collectionId = event.target.value;
              if (!collectionId) return;
              const albumName = collections.find((c) => c.id === collectionId)?.name ?? "相册";
              try {
                await Promise.all([...selectedIds].map((workId) =>
                  window.sanctuary.addWorkToCollection(workId, collectionId)
                ));
                await onLibraryChanged();
                const affectedIds = [...selectedIds];
                setNotice({
                  message: `已把 ${affectedIds.length} 个作品批量加入相册《${albumName}》。`,
                  undo: async () => {
                    await Promise.all(affectedIds.map((workId) =>
                      window.sanctuary.removeWorkFromCollection(workId, collectionId)
                    ));
                    await onLibraryChanged();
                  }
                });
              } catch (error) {
                onError(error);
              }
            }}
          >
            <option value="">加入相册…</option>
            {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
          <button
            type="button"
            className="work-favorite-selected"
            disabled={!result.items.some((work) => selectedIds.has(work.id) && !work.favorite)}
            onClick={async () => {
              const affectedIds = result.items.filter((work) => selectedIds.has(work.id) && !work.favorite).map((work) => work.id);
              if (!affectedIds.length) return;
              try {
                await window.sanctuary.updateWorkFavorite(affectedIds, true);
                await onLibraryChanged();
                setNotice({
                  message: `已喜欢 ${affectedIds.length} 个作品。`,
                  undo: async () => {
                    await window.sanctuary.updateWorkFavorite(affectedIds, false);
                    await onLibraryChanged();
                  }
                });
              } catch (error) {
                onError(error);
              }
            }}
          >
            ♡ 喜欢
          </button>
          <button type="button" className="work-analyze-selected" disabled={selectedIds.size === 0} onClick={() => onAnalyzeWorks([...selectedIds])}>
            推荐相册分类…
          </button>
          <button type="button" className="work-delete-button" disabled={selectedIds.size === 0} onClick={() => void previewDeletion()}>
            移出画廊…
          </button>
        </section>
      )}

      {notice && (
        <AppNotice
          tone="success"
          className="work-operation-notice"
          actionLabel={notice.undo ? "撤销" : undefined}
          onAction={notice.undo ? async () => {
            try {
              await notice.undo?.();
              setNotice(null);
            } catch (error) {
              onError(error);
            }
          } : undefined}
          onDismiss={() => setNotice(null)}
        >
          {notice.message}
        </AppNotice>
      )}

      {selectedWork && (
        <WorkLightbox work={selectedWork} onClose={() => setSelectedWork(null)} onGenerated={onLibraryChanged} onOpenInspiration={onOpenInspiration} onError={onError} />
      )}
      {deletionPreview && (
        <DialogOverlay busy={deleting} onClose={() => setDeletionPreview(null)}>
          <section className="dialog-surface work-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="work-delete-title">
            <p className="eyebrow">DELETE PREVIEW</p>
            <h2 id="work-delete-title">确认处理 {deletionPreview.items.length} 个作品？</h2>
            <div className="work-delete-summary">
              <div><strong>{deletionPreview.managedWorkCount}</strong><span>托管作品</span><small>文件移至 Windows 回收站</small></div>
              <div><strong>{deletionPreview.externalWorkCount}</strong><span>外部导入</span><small>只移除索引，不碰原文件</small></div>
              <div><strong>{deletionPreview.fileCount}</strong><span>图片文件</span><small>{formatBytes(deletionPreview.byteLength)}</small></div>
            </div>
            <div className="work-delete-list">
              {deletionPreview.items.slice(0, 6).map((item) => (
                <div key={item.id}><span>{item.title}</span><small>{item.ownership === "managed" ? "移至回收站" : "仅移除索引"} · {item.fileCount} 页</small></div>
              ))}
              {deletionPreview.items.length > 6 && <p>以及另外 {deletionPreview.items.length - 6} 个作品</p>}
            </div>
            <p className="work-delete-warning">不会永久删除托管文件；需要恢复时可前往 Windows 回收站。</p>
            <footer>
              <Button disabled={deleting} onClick={() => setDeletionPreview(null)}>取消</Button>
              <Button variant="danger" busy={deleting} busyLabel="正在处理…" onClick={() => void confirmDeletion()}>确认处理</Button>
            </footer>
          </section>
        </DialogOverlay>
      )}
    </>
  );
}

const WorkCard = memo(function WorkCard({
  work,
  collections,
  opening,
  selecting,
  selected,
  onOpen,
  onToggleSelection,
  onFavorite,
  onRemoveFromCollection,
  onAssign,
  onMutationError
}: {
  work: WorkListItem;
  collections: CollectionRecord[];
  opening: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: (work: WorkListItem, shiftKey: boolean) => void;
  onToggleSelection: (workId: string, shiftKey: boolean) => void;
  onFavorite: (work: WorkListItem) => Promise<void>;
  onRemoveFromCollection: ((work: WorkListItem) => Promise<void>) | null;
  onAssign: (work: WorkListItem, collectionId: string) => Promise<void>;
  onMutationError: (error: unknown) => void;
}) {
  const [mutating, setMutating] = useState<"assign" | "favorite" | "remove" | null>(null);
  const mutationRef = useRef(false);
  const assigning = mutating === "assign";
  async function mutate(action: "assign" | "favorite" | "remove", operation: () => Promise<void>) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setMutating(action);
    try { await operation(); }
    catch (error) { onMutationError(error); }
    finally { mutationRef.current = false; setMutating(null); }
  }
  const coverPath = work.coverAsset?.thumbnailPath ?? work.coverAsset?.path ?? "";
  return (
    <article className={`work-library-card ${selected ? "selected" : ""}`} data-multi-page={work.pageCount > 1 ? "true" : undefined}>
      {selecting && (
        <button type="button" className="work-card-check" aria-label={selected ? `取消选择 ${work.title}` : `选择 ${work.title}`} onClick={(event) => onToggleSelection(work.id, event.shiftKey)}>
          {selected ? "✓" : ""}
        </button>
      )}
      <button className="work-cover-button" type="button" disabled={opening} onClick={(event) => onOpen(work, event.shiftKey)}>
        {coverPath ? (
          <LazyWorkImage path={coverPath} />
        ) : (
          <span className="work-cover-missing">◇<small>封面待生成</small></span>
        )}
        {work.pageCount > 1 && <span className="work-page-badge">▱ {work.pageCount}</span>}
        {opening && <span className="work-opening">正在打开…</span>}
      </button>
      {!selecting && (
        <button type="button" className={`work-card-favorite ${work.favorite ? "active" : ""}`} aria-label={work.favorite ? `取消喜欢 ${work.title}` : `喜欢 ${work.title}`} disabled={mutating !== null} aria-busy={mutating === "favorite"} onClick={() => void mutate("favorite", () => onFavorite(work))}>
          {work.favorite ? "♥" : "♡"}
        </button>
      )}
      <div className="work-card-copy">
        <strong title={work.title}>{work.title}</strong>
        <span title={work.artistName ?? "本地作品"}>{work.artistName ?? "本地作品"}</span>
        <div className="work-card-foot">
          <time dateTime={work.savedAt}>{formatDate(work.savedAt)}</time>
          <select
            value=""
            aria-label={`把《${work.title}》加入相册`}
            disabled={mutating !== null || collections.length === 0}
            onChange={(event) => {
              const collectionId = event.target.value;
              if (collectionId) void mutate("assign", () => onAssign(work, collectionId));
            }}
          >
            <option value="">{assigning ? "正在加入…" : "加入相册…"}</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {work.collectionIds.includes(collection.id) ? "✓ " : ""}{collection.name}
              </option>
            ))}
          </select>
        </div>
        {onRemoveFromCollection && <button type="button" className="work-remove-from-collection" disabled={mutating !== null} aria-busy={mutating === "remove"} onClick={() => void mutate("remove", () => onRemoveFromCollection(work))}>移出当前相册</button>}
      </div>
    </article>
  );
});

function useStableWorkCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}

function LazyWorkImage({ path }: { path: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [load, setLoad] = useState(false);
  useEffect(() => {
    const image = imageRef.current;
    if (!image || load) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setLoad(true);
      observer.disconnect();
    }, { rootMargin: "700px 0px" });
    observer.observe(image);
    return () => observer.disconnect();
  }, [load]);
  return (
    <img
      ref={imageRef}
      src={load ? workImageUrl(path) : undefined}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

export function WorkLightbox({ work, initialAssetId, onClose, onGenerated, onOpenInspiration, onError }: { work: WorkRecord; initialAssetId?: string; onClose: () => void; onGenerated: () => Promise<void> | void; onOpenInspiration: (workId: string, pageIndex: number) => void; onError: (error: unknown) => void }) {
  const [pageIndex, setPageIndex] = useState(() => initialWorkPageIndex(work, initialAssetId));
  const [showRadar, setShowRadar] = useState(false);
  const [evaluations, setEvaluations] = useState<VisionEvaluationResult[]>([]);
  const [provenance, setProvenance] = useState<GenerationProvenance | null>(null);
  const [showProvenance, setShowProvenance] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showInformation, setShowInformation] = useState(false);
  const page = work.assets[pageIndex];
  const interactionSuspended = showInspector || showRadar || showProvenance || showInformation;
  const viewerPages = useMemo(() => work.assets.map((asset) => ({ url: workImageUrl(asset.path), width: asset.width, height: asset.height, byteLength: asset.byteLength })), [work.assets]);
  const viewer = useCinemaViewer({
    imageKey: page?.id ?? work.id, pages: viewerPages, pageIndex, onPageChange: setPageIndex, onClose,
    interactionSuspended,
    onDismissOverlay: showInspector ? undefined : showInformation ? () => setShowInformation(false) : showRadar ? () => setShowRadar(false) : showProvenance ? () => setShowProvenance(false) : undefined
  });
  const { zoom, nativeMode, isPanning, hudVisible, imageLoaded, imageFailed, resetHudTimer } = viewer;
  useWorkReading({ workId: work.id, assetId: page && isReadableWorkAsset(page) ? page.id : null, imageLoaded, onSaved: onGenerated, onError });

  useEffect(() => {
    let active = true;
    setEvaluations([]);
    setProvenance(null);
    if (window.sanctuary?.listVisionEvaluationsForWork) {
      window.sanctuary.listVisionEvaluationsForWork(work.id).then((values) => { if (active) setEvaluations(values); }).catch(() => {});
    }
    void window.sanctuary.getGenerationProvenance(work.id).then((value) => { if (active) setProvenance(value); }).catch(() => {});
    return () => { active = false; };
  }, [work.id]);

  if (!page) return null;

  return createPortal(
    <div
      ref={viewer.theaterRef}
      className={`cinema-lightbox-theater ${hudVisible ? "hud-visible" : "hud-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label={work.title}
      data-display-profile={viewer.displayProfile}
      data-reduced-motion={viewer.reducedMotion}
      onMouseMove={resetHudTimer}
      onFocusCapture={resetHudTimer}
      tabIndex={-1}
    >
      <header className="cinema-hud-island">
        <div className="cinema-heading-group">
          <strong>{work.title}</strong>
          <small>{work.artistName ?? "本地作品"} {work.assets.length > 1 ? `· 第 ${pageIndex + 1}/${work.assets.length} 页` : ""}</small>
        </div>

        <div className="cinema-controls-group">
          <div className="zoom-capsule">
            <button type="button" title="缩小 (-)" onClick={() => viewer.changeZoom(zoom - 0.25)}>-</button>
            <button type="button" className="zoom-readout" title="原始像素比例 · 点击自适应全貌 (0)" onClick={viewer.resetZoom}>{viewer.zoomPercent}%</button>
            <button type="button" title="放大 (+)" onClick={() => viewer.changeZoom(zoom + 0.25)}>+</button>
          </div>
          <button type="button" className={`cinema-btn-fit ${zoom === 1 ? "active" : ""}`} title="自适应 / 原始像素 (每像素对应 1 CSS px；双击或按 1)" onClick={viewer.toggleNativeZoom}>
            {nativeMode ? "自适应全貌" : "1:1 原图"}
          </button>
          <ArtworkToolsMenu>
          <button type="button" className="cinema-btn-fit" onClick={() => { setShowInformation(true); setShowRadar(false); setShowInspector(false); setShowProvenance(false); }}>作品信息与相册</button>
          <button
            type="button"
            className={`cinema-btn-fit ${showRadar ? "active" : ""}`}
            title="切换 AI 视觉雷达图画像"
            onClick={() => { setShowRadar((v) => !v); setShowInformation(false); setShowInspector(false); setShowProvenance(false); }}
          >
            ✦ 雷达画像
          </button>
          <button
            type="button"
            className={`cinema-btn-fit ${showInspector ? "active" : ""}`}
            title="查看当前页 WD 标签并打开提示词调音台"
            onClick={() => { setShowInspector((value) => !value); setShowInformation(false); setShowRadar(false); setShowProvenance(false); }}
          >
            ◇ 元素透视
          </button>
          <button
            type="button"
            className="cinema-btn-fit"
            title="把当前图片带到本地灵感台"
            onClick={() => { onClose(); onOpenInspiration(work.id, pageIndex); }}
          >
            ✦ 一起创作
          </button>
          </ArtworkToolsMenu>
          {provenance && (
            <button type="button" className={`cinema-btn-fit ${showProvenance ? "active" : ""}`} title="查看 ComfyUI 生成来源" onClick={() => { setShowProvenance((value) => !value); setShowRadar(false); setShowInspector(false); }}>
              ✦ 生成来源
            </button>
          )}
          <button type="button" className="cinema-btn-close" aria-label="关闭大图" title="关闭大图 (Esc)" onClick={onClose}>✕</button>
        </div>
      </header>

      {showRadar && (
        <aside className="cinema-radar-drawer" role="complementary" aria-label="画作多维视觉雷达图">
          <div className="radar-drawer-header">
            <h3>多维视觉画像</h3>
            <button type="button" className="radar-drawer-close" onClick={() => setShowRadar(false)} aria-label="关闭雷达图">✕</button>
          </div>
          <RadarEvaluationPanel
            workId={work.id}
            evaluations={evaluations}
            onEvaluationsChange={setEvaluations}
          />
        </aside>
      )}
      {showInformation && <WorkInformationDrawer workId={work.id} pageIndex={page.pageIndex} onClose={() => setShowInformation(false)}
        onInspector={() => { setShowInformation(false); setShowInspector(true); }} onRadar={() => { setShowInformation(false); setShowRadar(true); }}
        onInspiration={() => { onClose(); onOpenInspiration(work.id, pageIndex); }} onChanged={onGenerated} />}

      {showProvenance && provenance && (
        <aside className="cinema-radar-drawer generation-provenance-drawer" role="complementary" aria-label="生成来源与工作流摘要">
          <div className="radar-drawer-header">
            <h3>ComfyUI 生成来源</h3>
            <button type="button" className="radar-drawer-close" onClick={() => setShowProvenance(false)} aria-label="关闭来源信息">✕</button>
          </div>
          <div className="generation-provenance-content">
            <p><strong>工作流</strong><span>{provenance.templateName}</span></p>
            <p><strong>来源作品</strong><span>{provenance.sourceWorkId}</span></p>
            <p><strong>正向提示词</strong><code>{provenance.positivePrompt || "（空）"}</code></p>
            <p><strong>负向提示词</strong><code>{provenance.negativePrompt || "（空）"}</code></p>
            <p><strong>工作流摘要</strong><code>{JSON.stringify(provenance.workflowSummary, null, 2)}</code></p>
          </div>
        </aside>
      )}

      {showInspector && (
        <ElementInspectorDrawer
          target={{ workId: work.id, title: work.title, pageIndex }}
          onClose={() => setShowInspector(false)}
          onGenerated={onGenerated}
        />
      )}

      <div
        ref={viewer.stageRef}
        className={`cinema-stage-viewport ${isPanning ? "panning" : ""}`}
        onPointerDown={viewer.handlePointerDown}
        onPointerMove={viewer.handlePointerMove}
        onPointerUp={viewer.handlePointerUp}
        onPointerCancel={viewer.handlePointerUp}
        onLostPointerCapture={viewer.handlePointerUp}
        onDoubleClick={viewer.handleDoubleClick}
      >
        {!imageLoaded && !imageFailed && <div className="cinema-loading-spinner" role="status" aria-label="正在读取原图" />}
        {imageFailed && <div className="cinema-load-error" role="alert">原图读取失败，请检查本地文件是否存在。</div>}
        <img
          ref={viewer.imageRef}
          key={page.id}
          src={workImageUrl(page.path)}
          alt={work.title}
          className="cinema-image-entity"
          aria-busy={!imageLoaded}
          hidden={imageFailed}
          style={{
            cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in"
          }}
          decoding="async"
          draggable={false}
          onLoad={viewer.onImageLoad}
          onError={viewer.onImageError}
        />
      </div>

      {pageIndex > 0 && (
        <button type="button" className="cinema-nav-arrow prev" aria-label="上一页" disabled={interactionSuspended} onClick={() => setPageIndex((v) => v - 1)}>‹</button>
      )}
      {pageIndex < work.assets.length - 1 && (
        <button type="button" className="cinema-nav-arrow next" aria-label="下一页" disabled={interactionSuspended} onClick={() => setPageIndex((v) => v + 1)}>›</button>
      )}

      {work.assets.length > 1 && (
        <div className="cinema-bottom-filmstrip">
          <div className="filmstrip-track">
            {work.assets.map((asset, idx) => (
              <button
                key={asset.id}
                type="button"
                className={`filmstrip-thumb-btn ${idx === pageIndex ? "active" : ""}`}
                title={`第 ${idx + 1} 页`}
                aria-label={`第 ${idx + 1} 页`}
                aria-current={idx === pageIndex ? "page" : undefined}
                disabled={interactionSuspended}
                onClick={() => setPageIndex(idx)}
              >
                <img src={workImageUrl(asset.thumbnailPath ?? asset.path)} alt="" loading="lazy" decoding="async" />
                <span className="thumb-page-badge">{idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

function workImageUrl(path: string): string {
  return `sanctuary-image://local/${encodeURIComponent(path)}`;
}

const workDateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "时间未知"
    : workDateFormatter.format(date);
}

function formatBytes(value: number): string {
  if (value <= 0) return "大小待补充";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
