import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ArtworkRecord, VisionEvaluationResult, WorkRecord } from "@sanctuary/domain";
import { artworkImageUrl } from "./ArtworkCard";
import { RadarEvaluationPanel } from "./RadarEvaluationPanel";
import { ElementInspectorDrawer } from "./ElementInspectorDrawer";
import { artworkLibraryWorkId, artworkPageIndex } from "./gallery-model";
import { useCinemaViewer } from "./useCinemaViewer";
import { artworkReadingAsset } from "./work-reading";
import { useWorkReading } from "./useWorkReading";

export function ArtworkLightbox({
  artwork,
  pages,
  onClose,
  onSelect,
  onOpenInspiration,
  onReadingSaved,
  onError
}: {
  artwork: ArtworkRecord;
  pages: ArtworkRecord[];
  onClose: () => void;
  onSelect: (artwork: ArtworkRecord) => void;
  onOpenInspiration: (workId: string, pageIndex: number) => void;
  onReadingSaved: () => Promise<void> | void;
  onError: (error: unknown) => void;
}) {
  const currentIndex = Math.max(0, pages.findIndex((page) => page.id === artwork.id));
  const previous = pages[currentIndex - 1];
  const next = pages[currentIndex + 1];
  const libraryWorkId = artworkLibraryWorkId(artwork);
  const sourcePageIndex = artworkPageIndex(artwork);

  const [showRadar, setShowRadar] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const interactionSuspended = showInspector || showRadar;
  const [evaluations, setEvaluations] = useState<VisionEvaluationResult[]>([]);
  const readingLookup = useRef<{ workId: string; promise: Promise<WorkRecord | null> } | null>(null);
  const resolveReadingAssetId = useCallback(async () => {
    if (readingLookup.current?.workId !== libraryWorkId) {
      readingLookup.current = { workId: libraryWorkId, promise: window.sanctuary.getWork(libraryWorkId) };
    }
    return artworkReadingAsset(await readingLookup.current.promise, artwork)?.id ?? null;
  }, [libraryWorkId, artwork.id, artwork.path]);
  const viewerPages = useMemo(() => pages.map((page) => ({ url: artworkImageUrl(page) })), [pages]);
  const viewer = useCinemaViewer({
    imageKey: artwork.id + ":" + artwork.path, pages: viewerPages, pageIndex: currentIndex,
    onPageChange: (index) => { const page = pages[index]; if (page && page.id !== artwork.id) onSelect(page); }, onClose,
    interactionSuspended,
    onDismissOverlay: showInspector ? undefined : showRadar ? () => setShowRadar(false) : undefined
  });
  const { zoom, nativeMode, isPanning, imageLoaded, imageFailed, hudVisible, resetHudTimer } = viewer;
  // Preserve the clicked page, and retain its mapping until a brief successfully displayed visit has flushed.
  useWorkReading({ workId: libraryWorkId, assetId: null, resolveAssetId: resolveReadingAssetId, imageLoaded, onSaved: onReadingSaved, onError });

  useEffect(() => {
    let active = true;
    setEvaluations([]);
    if (window.sanctuary?.listVisionEvaluationsForWork) {
      window.sanctuary.listVisionEvaluationsForWork(libraryWorkId).then((values) => { if (active) setEvaluations(values); }).catch(() => {});
    }
    return () => { active = false; };
  }, [libraryWorkId]);

  return createPortal(
    <div
      ref={viewer.theaterRef}
      className={`cinema-lightbox-theater ${hudVisible ? "hud-visible" : "hud-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label={artwork.source?.title ?? artwork.fileName}
      data-display-profile={viewer.displayProfile}
      data-reduced-motion={viewer.reducedMotion}
      onMouseMove={resetHudTimer}
      onFocusCapture={resetHudTimer}
      tabIndex={-1}
    >
      {/* Floating Top Floating HUD Pill */}
      <header className="cinema-hud-island">
        <div className="cinema-heading-group">
          <strong>{artwork.source?.title ?? artwork.fileName}</strong>
          <small>{artwork.source?.authorName ?? "本地作品"} {pages.length > 1 ? `· 第 ${currentIndex + 1}/${pages.length} 页` : ""}</small>
        </div>

        <div className="cinema-controls-group">
          {/* Zoom controls */}
          <div className="zoom-capsule">
            <button
              type="button"
              title="缩小 (快捷键 -)"
              onClick={() => viewer.changeZoom(zoom - 0.25)}
            >
              -
            </button>
            <button type="button"
              className="zoom-readout"
              title="原始像素比例 · 点击自适应全貌 (0)"
              onClick={viewer.resetZoom}
            >
              {viewer.zoomPercent}%
            </button>
            <button
              type="button"
              title="放大 (快捷键 +)"
              onClick={() => viewer.changeZoom(zoom + 0.25)}
            >
              +
            </button>
          </div>

          <button
            type="button"
            className={`cinema-btn-fit ${zoom === 1 ? "active" : ""}`}
            title="自适应 / 原始像素 (每像素对应 1 CSS px；双击或按 1)"
            onClick={viewer.toggleNativeZoom}
          >
            {nativeMode ? "自适应全貌" : "1:1 原图"}
          </button>

          <button
            type="button"
            className={`cinema-btn-fit ${showRadar ? "active" : ""}`}
            title="查看多维视觉雷达图画像"
            onClick={() => { setShowRadar((prev) => !prev); if (!showRadar) setShowInspector(false); }}
          >
            📊 雷达画像 {evaluations.length > 0 ? `(${evaluations.length})` : ""}
          </button>

          <button
            type="button"
            className={`cinema-btn-fit ${showInspector ? "active" : ""}`}
            title="查看当前画作 AI 视觉标签并设置拦截黑名单"
            onClick={() => { setShowInspector((prev) => !prev); if (!showInspector) setShowRadar(false); }}
          >
            🔍 元素透视
          </button>

          <button
            type="button"
            className="cinema-btn-fit"
            title="把当前图片带到本地灵感台"
            onClick={() => { onClose(); onOpenInspiration(libraryWorkId, sourcePageIndex); }}
          >
            ✦ 一起创作
          </button>

          <button
            type="button"
            className="cinema-btn-close"
            aria-label="关闭全屏大图"
            title="关闭大图 (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>

      {/* Element Inspector Drawer */}
      {showInspector && (
        <ElementInspectorDrawer
          target={{
            workId: libraryWorkId,
            title: artwork.source?.title ?? artwork.fileName,
            pageIndex: sourcePageIndex
          }}
          onClose={() => setShowInspector(false)}
        />
      )}

      {/* Radar Overlay Drawer */}
      {showRadar && (
        <aside className="cinema-radar-drawer" aria-label="画作多维画像面板">
          <div className="radar-drawer-header">
            <h3>画作多维视觉雷达画像</h3>
            <button
              type="button"
              className="radar-drawer-close"
              onClick={() => setShowRadar(false)}
            >
              ✕
            </button>
          </div>
          <RadarEvaluationPanel
            workId={libraryWorkId}
            evaluations={evaluations}
            onEvaluationsChange={setEvaluations}
          />
        </aside>
      )}

      {/* Main Full-Aspect Canvas Stage */}
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
        {!imageLoaded && !imageFailed && (
          <div className="cinema-loading-spinner" aria-label="正在读取原图全貌..." />
        )}
        {imageFailed && (
          <div className="cinema-load-error">原图读取失败，请检查本地文件是否存在。</div>
        )}
        <img
            ref={viewer.imageRef}
            key={`${artwork.id}:${artwork.path}`}
            src={artworkImageUrl(artwork)}
            alt={artwork.source?.title ?? artwork.fileName}
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

      {/* Left/Right Navigation Arrows */}
      {previous && (
        <button
          type="button"
          className="cinema-nav-arrow prev"
          aria-label="上一页 (←)"
          title="上一页 (←)"
          disabled={interactionSuspended}
          onClick={() => onSelect(previous)}
        >
          ‹
        </button>
      )}
      {next && (
        <button
          type="button"
          className="cinema-nav-arrow next"
          aria-label="下一页 (→)"
          title="下一页 (→)"
          disabled={interactionSuspended}
          onClick={() => onSelect(next)}
        >
          ›
        </button>
      )}

      {/* Bottom Multi-page Filmstrip Carousel */}
      {pages.length > 1 && (
        <div className="cinema-bottom-filmstrip">
          <div className="filmstrip-track">
            {pages.map((page, idx) => (
              <button
                key={page.id}
                type="button"
                className={`filmstrip-thumb-btn ${page.id === artwork.id ? "active" : ""}`}
                title={`第 ${idx + 1} 页`}
                aria-label={`第 ${idx + 1} 页`}
                aria-current={page.id === artwork.id ? "page" : undefined}
                disabled={interactionSuspended}
                onClick={() => onSelect(page)}
              >
                <img src={artworkImageUrl(page)} alt="" loading="lazy" decoding="async" />
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
