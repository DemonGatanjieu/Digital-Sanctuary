import { useEffect, useMemo, useRef, useState } from "react";
import type { ScopedArtworkRecord } from "@sanctuary/domain";
import { Button } from "./Button";
import { DialogOverlay, isDialogComposition } from "./DialogOverlay";
import {
  addPickerSelection, ARTWORK_PICKER_PAGE_SIZE, ARTWORK_PICKER_SELECTION_LIMIT,
  ArtworkPickerController, initialArtworkPickerState, togglePickerSelection
} from "./paged-artwork-picker-model";

export function PagedArtworkPicker({ collection, onClose, onAdd }: {
  collection: { id: string; name: string };
  onClose: () => void;
  onAdd: (artworkIds: string[]) => Promise<void> | void;
}) {
  const [page, setPage] = useState(initialArtworkPickerState);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  const workspaceVersion = useRef(0);
  const controller = useMemo(() => new ArtworkPickerController(
    collection.id, (query) => window.sanctuary.queryArtworkPages(query), setPage
  ), [collection.id]);

  useEffect(() => {
    mountedRef.current = true;
    workspaceVersion.current += 1;
    submittingRef.current = false;
    setSubmitting(false);
    setSelectedIds(new Set());
    setSubmitError("");
    controller.start();
    return () => { mountedRef.current = false; workspaceVersion.current += 1; controller.dispose(); };
  }, [controller]);

  const changeSelection = (ids: readonly string[], toggle = false) => {
    setSubmitError("");
    setSelectedIds((previous) => (toggle ? togglePickerSelection(previous, ids[0]!) : addPickerSelection(previous, ids)).selected);
  };

  async function confirm() {
    if (!selectedIds.size || submittingRef.current) return;
    const version = workspaceVersion.current;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onAdd([...selectedIds]);
    } catch (error) {
      if (mountedRef.current && version === workspaceVersion.current) setSubmitError(error instanceof Error ? error.message : "加入相册暂时失败，请重试。");
    } finally {
      if (mountedRef.current && version === workspaceVersion.current) { submittingRef.current = false; setSubmitting(false); }
    }
  }

  const start = page.result.items.length ? page.offset + 1 : 0;
  const end = page.offset + page.result.items.length;
  const currentPage = Math.floor(page.offset / ARTWORK_PICKER_PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(page.result.total / ARTWORK_PICKER_PAGE_SIZE));

  return <DialogOverlay busy={submitting} onClose={onClose}>
    <section className="dialog-surface paged-artwork-picker" role="dialog" aria-modal="true" aria-labelledby="artwork-picker-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") event.stopPropagation();
        if (event.defaultPrevented || isDialogComposition(event.nativeEvent)) return;
        if (event.key === "Escape") { event.preventDefault(); if (!submitting) onClose(); }
      }}>
      <header className="paged-picker-heading">
        <div><h2 id="artwork-picker-title">挑选画作加入相册</h2><p>《{collection.name}》 · 按图片页挑选，翻页和搜索会保留选择。</p></div>
        <Button variant="ghost" className="paged-picker-close" aria-label="关闭画作选择器" disabled={submitting} onClick={onClose}>×</Button>
      </header>
      <div className="paged-picker-toolbar">
        <input type="search" autoFocus aria-label="搜索未入册画作" placeholder="搜索标题、文件名或画师…" value={page.search}
          disabled={submitting} onChange={(event) => controller.changeSearch(event.target.value)} />
        <Button disabled={page.loading || !!page.error || !page.result.items.length || submitting}
          onClick={() => changeSelection(page.result.items.map((item) => item.id))}>全选当前页</Button>
        <Button disabled={!selectedIds.size || submitting} onClick={() => { setSelectedIds(new Set()); setSubmitError(""); }}>清空选择</Button>
      </div>
      <div className="paged-picker-status" role="status" aria-live="polite">
        {page.loading ? "正在读取画作…" : page.error ? "读取失败，当前选择已保留。" : `第 ${start}–${end} 张，共 ${page.result.total} 张未入册画作`}
      </div>
      <div className="paged-picker-grid" aria-busy={page.loading}>
        {page.error ? <div className="paged-picker-empty"><p role="alert">{page.error}</p><Button onClick={() => controller.retry()} disabled={submitting}>重试读取</Button></div>
          : page.loading ? <div className="paged-picker-empty">正在读取…</div>
          : !page.result.items.length ? <div className="paged-picker-empty">{page.search.trim() ? "没有符合搜索条件的未入册画作。" : "目前没有可加入的未入册画作。"}</div>
          : page.result.items.map((artwork) => <PickerArtwork key={artwork.id} artwork={artwork} selected={selectedIds.has(artwork.id)}
            disabled={submitting || (!selectedIds.has(artwork.id) && selectedIds.size >= ARTWORK_PICKER_SELECTION_LIMIT)}
            onToggle={() => changeSelection([artwork.id], true)} />)}
      </div>
      <nav className="paged-picker-pagination" aria-label="画作选择分页">
        <Button disabled={page.loading || !!page.error || !page.offset || submitting} onClick={() => controller.goTo(Math.max(0, page.offset - ARTWORK_PICKER_PAGE_SIZE))}>上一页</Button>
        <span>第 {currentPage} / {pageCount} 页</span>
        <Button disabled={page.loading || !!page.error || !page.result.hasMore || submitting} onClick={() => controller.goTo(page.offset + ARTWORK_PICKER_PAGE_SIZE)}>下一页</Button>
      </nav>
      <footer className="paged-picker-footer">
        <div><strong>已选择 {selectedIds.size} 张</strong><small>每批最多 {ARTWORK_PICKER_SELECTION_LIMIT} 张，可跨页选择。</small>
          {selectedIds.size >= ARTWORK_PICKER_SELECTION_LIMIT && <p role="status">本批已选满，剩余画作可下一批加入。</p>}{submitError && <p role="alert">{submitError} 已保留选择，可重试。</p>}</div>
        <div className="paged-picker-actions"><Button disabled={submitting} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!selectedIds.size} busy={submitting} busyLabel="正在加入…" onClick={() => void confirm()}>确认加入 ({selectedIds.size})</Button></div>
      </footer>
    </section>
  </DialogOverlay>;
}

function PickerArtwork({ artwork, selected, disabled, onToggle }: {
  artwork: ScopedArtworkRecord; selected: boolean; disabled: boolean; onToggle: () => void;
}) {
  const title = artwork.source?.title ?? artwork.fileName;
  const path = artwork.thumbnailPath || artwork.path;
  return <button type="button" className={`paged-picker-artwork ${selected ? "selected" : ""}`} aria-pressed={selected}
    aria-label={`${selected ? "取消选择" : "选择"} ${title} 第 ${artwork.pageIndex + 1} 页`} disabled={disabled} onClick={onToggle}>
    <span className="paged-picker-thumbnail"><img src={`sanctuary-image://local/${encodeURIComponent(path)}`} alt="" loading="lazy" decoding="async" fetchPriority="low" />
      <span className="paged-picker-check" aria-hidden="true">{selected ? "✓" : ""}</span></span>
    <strong title={title}>{title}</strong><small>{artwork.source?.authorName || "未署名画师"} · 第 {artwork.pageIndex + 1} 页</small>
  </button>;
}
