import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AppearancePreferences,
  CollectionRecord,
  VisionEvaluationResult,
  WorkListItem,
  WorkDeletionPreview,
  WorkQuery,
  WorkQueryResult,
  WorkRecord
} from "@sanctuary/domain";
import { DialogOverlay } from "./DialogOverlay";
import { AppNotice } from "./AppNotice";
import { Button } from "./Button";
import { InteractiveCompassDial } from "./InteractiveCompassDial";
import { VisionRadarChart } from "./VisionRadarChart";


export function WorkLibrary({
  result,
  query,
  collections,
  appearance,
  loading,
  onQueryChange,
  onLoadMore,
  onAssignCollection,
  onLibraryChanged,
  onAnalyzeWorks,
  onError
}: {
  result: WorkQueryResult;
  query: WorkQuery;
  collections: CollectionRecord[];
  appearance: AppearancePreferences;
  loading: boolean;
  onQueryChange: (query: WorkQuery) => void;
  onLoadMore: () => void;
  onAssignCollection: (workId: string, collectionId: string) => Promise<void>;
  onLibraryChanged: () => Promise<void>;
  onAnalyzeWorks: (workIds: string[]) => void;
  onError: (error: unknown) => void;
}) {
  const [selectedWork, setSelectedWork] = useState<WorkRecord | null>(null);
  const [openingWorkId, setOpeningWorkId] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletionPreview, setDeletionPreview] = useState<WorkDeletionPreview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; undo?: () => Promise<void> } | null>(null);
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
    setOpeningWorkId(item.id);
    try {
      const work = await window.sanctuary.getWork(item.id);
      if (!work) throw new Error("作品记录不存在，可能已经被移出画廊。");
      setSelectedWork(work);
    } catch (error) {
      onError(error);
    } finally {
      setOpeningWorkId("");
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

  return (
    <>
      {featuredWork?.coverAsset && !query.search && appearance.ambientArtwork && appearance.displayProfile !== "efficient" && (
        <section className="work-ambient-hero">
          <img className="work-ambient-backdrop" src={workImageUrl(featuredWork.coverAsset.thumbnailPath ?? featuredWork.coverAsset.path)} alt="" aria-hidden="true" />
          <div className="work-ambient-copy">
            <span>{activeCollection ? "相册精选" : "最近保存"}</span>
            <strong>{featuredWork.title}</strong>
            <small>{featuredWork.artistName ?? "本地作品"} · {featuredWork.pageCount} 页</small>
            <button type="button" onClick={() => void openWork(featuredWork)}>继续欣赏</button>
          </div>
          <div className="work-ambient-interactive-slot">
            <InteractiveCompassDial mode="hero" />
          </div>
          <img className="work-ambient-cover" src={workImageUrl(featuredWork.coverAsset.thumbnailPath ?? featuredWork.coverAsset.path)} alt="" />
        </section>
      )}
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
          onChange={(event) => onQueryChange({
            ...query,
            sortBy: event.target.value as NonNullable<WorkQuery["sortBy"]>,
            offset: 0
          })}
        >
          <option value="savedAt">本地保存时间</option>
          <option value="publishedAt">Pixiv 发布时间</option>
          <option value="title">标题</option>
          <option value="artist">作者</option>
          <option value="pageCount">页数</option>
          <option value="byteLength">文件大小</option>
        </select>
        <button
          type="button"
          className="work-sort-direction"
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
          <button type="button" onClick={() => {
            const { collectionId: _collectionId, ...withoutCollection } = query;
            onQueryChange({ ...withoutCollection, offset: 0 });
          }}>查看全部作品</button>
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
          <button type="button" onClick={() => {
            const { collectionIds: _cids, collectionMatchMode: _cmm, excludedCollectionIds: _ecids, ...withoutCombo } = query;
            onQueryChange({ ...withoutCombo, offset: 0 });
          }}>查看全部作品</button>
        </section>
      )}

      <div className="work-result-note">
        <span>{result.total} 个作品 · {result.totalPages} 页</span>
        {loading && <span className="work-querying">正在更新…</span>}
      </div>

      {result.items.length === 0 && !loading ? (
        <section className="empty-state compact-empty">
          <p className="eyebrow">NO MATCHES</p>
          <h2>{query.search ? "没有匹配的作品" : "画廊还是空的"}</h2>
          <p>{query.search ? "换一个标题、作者或 Pixiv ID 试试。" : "从探索页保存作品，或导入本地图片。"}</p>
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
              onOpen={(shiftKey) => selecting ? toggleSelection(work.id, shiftKey) : void openWork(work)}
              onToggleSelection={(shiftKey) => toggleSelection(work.id, shiftKey)}
              onAssign={async (collectionId) => {
                await onAssignCollection(work.id, collectionId);
                const collectionName = collections.find((item) => item.id === collectionId)?.name ?? "相册";
                setNotice({
                  message: `已把《${work.title}》加入相册“${collectionName}”。`,
                  undo: async () => {
                    await window.sanctuary.removeWorkFromCollection(work.id, collectionId);
                    await onLibraryChanged();
                  }
                });
              }}
              onFavorite={async () => {
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
              }}
              onRemoveFromCollection={activeCollection ? async () => {
                await window.sanctuary.removeWorkFromCollection(work.id, activeCollection.id);
                await onLibraryChanged();
                setNotice({
                  message: `已把《${work.title}》移出相册“${activeCollection.name}”。`,
                  undo: async () => {
                    await window.sanctuary.addWorkToCollection(work.id, activeCollection.id);
                    await onLibraryChanged();
                  }
                });
              } : null}
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
            模型整理…
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
        <WorkLightbox work={selectedWork} onClose={() => setSelectedWork(null)} />
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

function WorkCard({
  work,
  collections,
  opening,
  selecting,
  selected,
  onOpen,
  onToggleSelection,
  onFavorite,
  onRemoveFromCollection,
  onAssign
}: {
  work: WorkListItem;
  collections: CollectionRecord[];
  opening: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: (shiftKey: boolean) => void;
  onToggleSelection: (shiftKey: boolean) => void;
  onFavorite: () => Promise<void>;
  onRemoveFromCollection: (() => Promise<void>) | null;
  onAssign: (collectionId: string) => Promise<void>;
}) {
  const [assigning, setAssigning] = useState(false);
  const coverPath = work.coverAsset?.thumbnailPath ?? work.coverAsset?.path ?? "";
  return (
    <article className={`work-library-card ${selected ? "selected" : ""}`} data-multi-page={work.pageCount > 1 ? "true" : undefined}>
      {selecting && (
        <button type="button" className="work-card-check" aria-label={selected ? `取消选择 ${work.title}` : `选择 ${work.title}`} onClick={(event) => onToggleSelection(event.shiftKey)}>
          {selected ? "✓" : ""}
        </button>
      )}
      <button className="work-cover-button" type="button" disabled={opening} onClick={(event) => onOpen(event.shiftKey)}>
        {coverPath ? (
          <LazyWorkImage path={coverPath} />
        ) : (
          <span className="work-cover-missing">◇<small>封面待生成</small></span>
        )}
        {work.pageCount > 1 && <span className="work-page-badge">▱ {work.pageCount}</span>}
        {opening && <span className="work-opening">正在打开…</span>}
      </button>
      {!selecting && (
        <button type="button" className={`work-card-favorite ${work.favorite ? "active" : ""}`} aria-label={work.favorite ? `取消喜欢 ${work.title}` : `喜欢 ${work.title}`} onClick={() => void onFavorite()}>
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
            disabled={assigning || collections.length === 0}
            onChange={async (event) => {
              const collectionId = event.target.value;
              if (!collectionId) return;
              setAssigning(true);
              try {
                await onAssign(collectionId);
              } finally {
                setAssigning(false);
              }
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
        {onRemoveFromCollection && <button type="button" className="work-remove-from-collection" onClick={() => void onRemoveFromCollection()}>移出当前相册</button>}
      </div>
    </article>
  );
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

function WorkLightbox({ work, onClose }: { work: WorkRecord; onClose: () => void }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [evaluations, setEvaluations] = useState<VisionEvaluationResult[]>([]);

  const panStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hudTimer = useRef<number | null>(null);
  const page = work.assets[pageIndex];

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImageLoaded(false);
    setHudVisible(true);
    if (window.sanctuary?.listVisionEvaluationsForWork) {
      window.sanctuary.listVisionEvaluationsForWork(work.id).then(setEvaluations).catch(() => setEvaluations([]));
    }
  }, [pageIndex, work.id]);

  useEffect(() => {
    document.body.classList.add("lightbox-open");
    return () => document.body.classList.remove("lightbox-open");
  }, []);

  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    if (hudTimer.current) window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => {
      if (!isPanning) setHudVisible(false);
    }, 3200);
  }, [isPanning]);

  useEffect(() => {
    resetHudTimer();
    return () => {
      if (hudTimer.current) window.clearTimeout(hudTimer.current);
    };
  }, [resetHudTimer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      resetHudTimer();
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") setPageIndex((value) => Math.max(0, value - 1));
      else if (event.key === "ArrowRight") setPageIndex((value) => Math.min(work.assets.length - 1, value + 1));
      else if (event.key === "0" || event.key === "r" || event.key === "R") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (event.key === "1") {
        setZoom((z) => (z === 1 ? 2 : 1));
        setPan({ x: 0, y: 0 });
      } else if (event.key === "+" || event.key === "=") {
        setZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))));
      } else if (event.key === "-" || event.key === "_") {
        setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, resetHudTimer, work.assets.length]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    resetHudTimer();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((current) => Math.max(0.5, Math.min(5, Number((current + delta).toFixed(2)))));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  };

  const handleDoubleClick = () => {
    setZoom((current) => {
      setPan({ x: 0, y: 0 });
      return current === 1 ? 2 : 1;
    });
  };

  if (!page) return null;

  return createPortal(
    <div
      className={`cinema-lightbox-theater ${hudVisible ? "hud-visible" : "hud-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label={work.title}
      onMouseMove={resetHudTimer}
    >
      <header className="cinema-hud-island">
        <div className="cinema-heading-group">
          <strong>{work.title}</strong>
          <small>{work.artistName ?? "本地作品"} {work.assets.length > 1 ? `· 第 ${pageIndex + 1}/${work.assets.length} 页` : ""}</small>
        </div>

        <div className="cinema-controls-group">
          <div className="zoom-capsule">
            <button type="button" title="缩小 (-)" onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}>-</button>
            <span className="zoom-readout" title="重置缩放 (0)" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</span>
            <button type="button" title="放大 (+)" onClick={() => setZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))}>+</button>
          </div>
          <button type="button" className={`cinema-btn-fit ${zoom === 1 ? "active" : ""}`} title="自适应 / 2x 缩放切换" onClick={handleDoubleClick}>
            {zoom === 1 ? "1:1 原图" : "自适应全貌"}
          </button>
          <button
            type="button"
            className={`cinema-btn-fit ${showRadar ? "active" : ""}`}
            title="切换 AI 视觉雷达图画像"
            onClick={() => setShowRadar((v) => !v)}
          >
            ✦ 雷达画像
          </button>
          <button type="button" className="cinema-btn-close" aria-label="关闭大图" title="关闭大图 (Esc)" onClick={onClose}>✕</button>
        </div>
      </header>

      {showRadar && (
        <aside className="cinema-radar-drawer" role="complementary" aria-label="画作多维视觉雷达图">
          <div className="radar-drawer-header">
            <h3>多维视觉画像</h3>
            <button type="button" className="radar-drawer-close" onClick={() => setShowRadar(false)} aria-label="关闭雷达图">✕</button>
          </div>
          {evaluations.length === 0 ? (
            <div className="radar-drawer-empty">
              <p>暂无多维视觉画像数据</p>
              <p className="hint">可在画廊或模型整理中对该作品执行深度视觉评估</p>
            </div>
          ) : (
            <div className="radar-drawer-content">
              {evaluations.map((ev) => (
                <VisionRadarChart key={ev.id} evaluation={ev} size={260} />
              ))}
            </div>
          )}
        </aside>
      )}

      <div
        className={`cinema-stage-viewport ${isPanning ? "panning" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          key={page.id}
          src={workImageUrl(page.path)}
          alt={work.title}
          className={`cinema-image-entity ${imageLoaded ? "loaded" : "loading"}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in"
          }}
          decoding="async"
          draggable={false}
          onLoad={() => setImageLoaded(true)}
        />
      </div>

      {pageIndex > 0 && (
        <button type="button" className="cinema-nav-arrow prev" aria-label="上一页" onClick={() => setPageIndex((v) => v - 1)}>‹</button>
      )}
      {pageIndex < work.assets.length - 1 && (
        <button type="button" className="cinema-nav-arrow next" aria-label="下一页" onClick={() => setPageIndex((v) => v + 1)}>›</button>
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
                onClick={() => setPageIndex(idx)}
              >
                <img src={workImageUrl(asset.thumbnailPath ?? asset.path)} alt="" loading="lazy" />
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

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatBytes(value: number): string {
  if (value <= 0) return "大小待补充";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
