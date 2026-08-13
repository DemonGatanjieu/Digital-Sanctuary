import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AppearancePreferences,
  CollectionRecord,
  WorkListItem,
  WorkDeletionPreview,
  WorkQuery,
  WorkQueryResult,
  WorkRecord
} from "@sanctuary/domain";

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
  const featuredWork = result.items[0] ?? null;

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

  function toggleSelection(workId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(workId) ? next.delete(workId) : next.add(workId);
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
            <span>{activeCollection ? "分类精选" : "最近保存"}</span>
            <strong>{featuredWork.title}</strong>
            <small>{featuredWork.artistName ?? "本地作品"} · {featuredWork.pageCount} 页</small>
            <button type="button" onClick={() => void openWork(featuredWork)}>继续欣赏</button>
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
              onOpen={() => selecting ? toggleSelection(work.id) : void openWork(work)}
              onToggleSelection={() => toggleSelection(work.id)}
              onAssign={async (collectionId) => {
                await onAssignCollection(work.id, collectionId);
                const collectionName = collections.find((item) => item.id === collectionId)?.name ?? "分类";
                setNotice({
                  message: `已把《${work.title}》加入“${collectionName}”。`,
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
                  message: `已把《${work.title}》移出“${activeCollection.name}”。`,
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
        <div className="work-load-more">
          <button className="secondary" type="button" disabled={loading} onClick={onLoadMore}>
            {loading ? "正在读取…" : `继续加载（已显示 ${result.items.length} / ${result.total}）`}
          </button>
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
              try {
                await Promise.all([...selectedIds].map((workId) =>
                  window.sanctuary.addWorkToCollection(workId, collectionId)
                ));
                await onLibraryChanged();
                const affectedIds = [...selectedIds];
                setNotice({
                  message: `已把 ${affectedIds.length} 个作品加入分类。`,
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
            <option value="">加入分类…</option>
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
          <button type="button" className="work-delete-button" disabled={selectedIds.size === 0} onClick={() => void previewDeletion()}>
            移出画廊…
          </button>
        </section>
      )}

      {notice && <div className="work-operation-notice" role="status"><span>{notice.message}</span><div>{notice.undo && <button type="button" className="work-undo-button" onClick={async () => { try { await notice.undo?.(); setNotice(null); } catch (error) { onError(error); } }}>撤销</button>}<button type="button" aria-label="关闭消息" onClick={() => setNotice(null)}>×</button></div></div>}

      {selectedWork && (
        <WorkLightbox work={selectedWork} onClose={() => setSelectedWork(null)} />
      )}
      {deletionPreview && createPortal(
        <div className="work-delete-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeletionPreview(null)}>
          <section className="work-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="work-delete-title">
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
              <button type="button" className="secondary" disabled={deleting} onClick={() => setDeletionPreview(null)}>取消</button>
              <button type="button" className="work-delete-confirm" disabled={deleting} onClick={() => void confirmDeletion()}>{deleting ? "正在处理…" : "确认处理"}</button>
            </footer>
          </section>
        </div>,
        document.body
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
  onOpen: () => void;
  onToggleSelection: () => void;
  onFavorite: () => Promise<void>;
  onRemoveFromCollection: (() => Promise<void>) | null;
  onAssign: (collectionId: string) => Promise<void>;
}) {
  const [assigning, setAssigning] = useState(false);
  const coverPath = work.coverAsset?.thumbnailPath ?? work.coverAsset?.path ?? "";
  return (
    <article className={`work-library-card ${selected ? "selected" : ""}`}>
      {selecting && (
        <button type="button" className="work-card-check" aria-label={selected ? `取消选择 ${work.title}` : `选择 ${work.title}`} onClick={onToggleSelection}>
          {selected ? "✓" : ""}
        </button>
      )}
      <button className="work-cover-button" type="button" disabled={opening} onClick={onOpen}>
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
            aria-label={`把《${work.title}》加入分类`}
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
            <option value="">{assigning ? "正在加入…" : "加入分类…"}</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {work.collectionIds.includes(collection.id) ? "✓ " : ""}{collection.name}
              </option>
            ))}
          </select>
        </div>
        {onRemoveFromCollection && <button type="button" className="work-remove-from-collection" onClick={() => void onRemoveFromCollection()}>移出当前分类</button>}
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
  const [actualSize, setActualSize] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const page = work.assets[pageIndex];

  useEffect(() => {
    document.body.classList.add("lightbox-open");
    closeRef.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove("lightbox-open");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setPageIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setPageIndex((value) => Math.min(work.assets.length - 1, value + 1));
      if (event.key === "0") setActualSize(false);
      if (event.key === "1") setActualSize(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, work.assets.length]);

  if (!page) return null;
  return createPortal(
    <div className="artwork-lightbox work-lightbox" role="dialog" aria-modal="true" aria-label={work.title}>
      <header className="lightbox-toolbar">
        <div className="lightbox-heading">
          <strong>{work.title}</strong>
          <small>{work.artistName ?? "本地作品"} · {work.pageCount} 页</small>
        </div>
        <div className="lightbox-actions">
          <button type="button" className={actualSize ? "active" : ""} onClick={() => setActualSize((value) => !value)}>
            {actualSize ? "适应窗口" : "1:1 原图"}
          </button>
          <button ref={closeRef} type="button" className="lightbox-close" aria-label="关闭大图" onClick={onClose}>×</button>
        </div>
      </header>
      <button className="lightbox-nav previous" type="button" aria-label="上一页" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}>‹</button>
      <div className={`lightbox-stage ${actualSize ? "actual-size" : "fit-window"}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <img src={workImageUrl(page.path)} alt="" draggable={false} onClick={() => setActualSize((value) => !value)} />
      </div>
      <button className="lightbox-nav next" type="button" aria-label="下一页" disabled={pageIndex >= work.assets.length - 1} onClick={() => setPageIndex((value) => value + 1)}>›</button>
      <footer className="lightbox-footer work-lightbox-footer">
        <span>{pageIndex + 1} / {work.assets.length}</span>
        <div className="work-page-strip">
          {work.assets.map((asset, index) => (
            <button key={asset.id} type="button" className={index === pageIndex ? "active" : ""} aria-label={`第 ${index + 1} 页`} onClick={() => setPageIndex(index)}>
              <img src={workImageUrl(asset.thumbnailPath ?? asset.path)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
        <span>← → 翻页 · Esc 关闭</span>
      </footer>
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
