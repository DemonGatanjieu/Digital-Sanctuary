import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { ArtworkRecord, VisionEvaluationResult } from "@sanctuary/domain";
import { artworkImageUrl } from "./ArtworkCard";
import { VisionRadarChart } from "./VisionRadarChart";

export function ArtworkLightbox({
  artwork,
  pages,
  onClose,
  onSelect
}: {
  artwork: ArtworkRecord;
  pages: ArtworkRecord[];
  onClose: () => void;
  onSelect: (artwork: ArtworkRecord) => void;
}) {
  const currentIndex = Math.max(0, pages.findIndex((page) => page.id === artwork.id));
  const previous = pages[currentIndex - 1];
  const next = pages[currentIndex + 1];

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [imageFailed, setImageFailed] = useState<boolean>(false);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const [showRadar, setShowRadar] = useState<boolean>(false);
  const [evaluations, setEvaluations] = useState<VisionEvaluationResult[]>([]);

  const panStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hudTimer = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Reset zoom & pan when artwork changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImageLoaded(false);
    setImageFailed(false);
    setHudVisible(true);
    if (window.sanctuary?.listVisionEvaluationsForWork) {
      window.sanctuary.listVisionEvaluationsForWork(artwork.id).then(setEvaluations).catch(() => setEvaluations([]));
    }
  }, [artwork.id]);

  // Lock body scroll
  useEffect(() => {
    document.body.classList.add("lightbox-open");
    return () => document.body.classList.remove("lightbox-open");
  }, []);

  // Preload adjacent pages
  useEffect(() => {
    for (const candidate of [previous, next]) {
      if (!candidate) continue;
      const img = new Image();
      img.src = artworkImageUrl(candidate);
    }
  }, [next, previous]);

  // Auto-hide HUD on idle mouse movement
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

  // Keyboard navigation & zoom
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      resetHudTimer();
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && previous) onSelect(previous);
      else if (event.key === "ArrowRight" && next) onSelect(next);
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
  }, [next, onClose, onSelect, previous, resetHudTimer]);

  // Wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    resetHudTimer();
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setZoom((current) => {
      const nextZoom = Math.min(5, Math.max(0.4, current + delta));
      if (nextZoom <= 1) setPan({ x: 0, y: 0 });
      return Number(nextZoom.toFixed(2));
    });
  };

  // Pan dragging handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    resetHudTimer();
    if (zoom > 1) {
      setIsPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    resetHudTimer();
    if (isPanning && zoom > 1) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  };

  // Double click toggles fit / 2x zoom
  const handleDoubleClick = () => {
    setZoom((current) => {
      if (current === 1) {
        setPan({ x: 0, y: 0 });
        return 2;
      }
      setPan({ x: 0, y: 0 });
      return 1;
    });
  };

  return createPortal(
    <div
      className={`cinema-lightbox-theater ${hudVisible ? "hud-visible" : "hud-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label={artwork.source?.title ?? artwork.fileName}
      onMouseMove={resetHudTimer}
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
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            >
              -
            </button>
            <span
              className="zoom-readout"
              title="重置缩放 (快捷键 0)"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              title="放大 (快捷键 +)"
              onClick={() => setZoom((z) => Math.min(5, Number((z + 0.25).toFixed(2))))}
            >
              +
            </button>
          </div>

          <button
            type="button"
            className={`cinema-btn-fit ${zoom === 1 ? "active" : ""}`}
            title="自适应全屏 / 1:1 原图切换 (双击图片或按 1)"
            onClick={handleDoubleClick}
          >
            {zoom === 1 ? "1:1 原图" : "自适应全貌"}
          </button>

          <button
            type="button"
            className={`cinema-btn-fit ${showRadar ? "active" : ""}`}
            title="查看多维视觉雷达图画像"
            onClick={() => setShowRadar((prev) => !prev)}
          >
            📊 雷达画像 {evaluations.length > 0 ? `(${evaluations.length})` : ""}
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
          <div className="radar-drawer-content">
            {evaluations.length === 0 ? (
              <div className="radar-drawer-empty">
                <p>该画作尚未生成视觉雷达评估。</p>
                <p className="hint">前往“任务中心”选择技术画像或专业套件即可一键生成。</p>
              </div>
            ) : (
              evaluations.map((ev) => (
                <div key={ev.id} className="radar-drawer-item">
                  <VisionRadarChart evaluation={ev} size={260} />
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Main Full-Aspect Canvas Stage */}
      <div
        ref={stageRef}
        className={`cinema-stage-viewport ${isPanning ? "panning" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {!imageLoaded && !imageFailed && (
          <div className="cinema-loading-spinner" aria-label="正在读取原图全貌..." />
        )}
        {imageFailed && (
          <div className="cinema-load-error">原图读取失败，请检查本地文件是否存在。</div>
        )}
        {!imageFailed && (
          <img
            ref={imageRef}
            key={artwork.id}
            src={artworkImageUrl(artwork)}
            alt={artwork.source?.title ?? artwork.fileName}
            className={`cinema-image-entity ${artwork.decision?.action === "blur" ? "blurred " : ""}${imageLoaded ? "loaded" : "loading"}`}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "zoom-in"
            }}
            decoding="async"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
        )}
      </div>

      {/* Left/Right Navigation Arrows */}
      {previous && (
        <button
          type="button"
          className="cinema-nav-arrow prev"
          aria-label="上一页 (←)"
          title="上一页 (←)"
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
                onClick={() => onSelect(page)}
              >
                <img src={artworkImageUrl(page)} alt="" loading="lazy" />
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
