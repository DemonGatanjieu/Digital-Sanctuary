import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ArtworkRecord } from "@sanctuary/domain";
import { artworkImageUrl } from "./ArtworkCard";

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
  const [actualSize, setActualSize] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActualSize(false);
    setImageLoaded(false);
    setImageFailed(false);
  }, [artwork.id]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !imageLoaded) return;
    requestAnimationFrame(() => {
      stage.scrollTo({
        left: actualSize ? Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2) : 0,
        top: actualSize ? Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2) : 0
      });
    });
  }, [actualSize, artwork.id, imageLoaded]);

  useEffect(() => {
    document.body.classList.add("lightbox-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove("lightbox-open");
  }, []);

  useEffect(() => {
    for (const candidate of [previous, next]) {
      if (!candidate) continue;
      const image = new Image();
      image.src = artworkImageUrl(candidate);
    }
  }, [next, previous]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && previous) onSelect(previous);
      else if (event.key === "ArrowRight" && next) onSelect(next);
      else if (event.key === "0") setActualSize(false);
      else if (event.key === "1") setActualSize(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, onClose, onSelect, previous]);

  return createPortal(
    <div className="artwork-lightbox" role="dialog" aria-modal="true" aria-label={artwork.source?.title ?? artwork.fileName}>
      <header className="lightbox-toolbar">
        <div className="lightbox-heading">
          <strong>{artwork.source?.title ?? artwork.fileName}</strong>
          <small>{artwork.source?.authorName ?? "本地作品"}</small>
        </div>
        <div className="lightbox-actions">
          <button
            type="button"
            className={actualSize ? "active" : ""}
            aria-pressed={actualSize}
            title={actualSize ? "适应窗口（快捷键 0）" : "按原始像素查看（快捷键 1）"}
            onClick={() => setActualSize((current) => !current)}
          >
            {actualSize ? "适应窗口" : "1:1 原图"}
          </button>
          <button ref={closeButtonRef} type="button" className="lightbox-close" aria-label="关闭大图" onClick={onClose}>×</button>
        </div>
      </header>
      <button className="lightbox-nav previous" aria-label="上一页" disabled={!previous} onClick={() => previous && onSelect(previous)}>‹</button>
      <div
        ref={stageRef}
        className={`lightbox-stage ${actualSize ? "actual-size" : "fit-window"}`}
        onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      >
        {!imageLoaded && !imageFailed && <span className="lightbox-loader" aria-label="正在读取原图" />}
        {imageFailed && <div className="lightbox-load-error">原图读取失败，请关闭后重试。</div>}
        {!imageFailed && (
          <img
            key={artwork.id}
            src={artworkImageUrl(artwork)}
            alt=""
            className={`${artwork.decision?.action === "blur" ? "blurred " : ""}${imageLoaded ? "loaded" : "loading"}`}
            decoding="async"
            draggable={false}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
            onClick={() => setActualSize((current) => !current)}
          />
        )}
      </div>
      <button className="lightbox-nav next" aria-label="下一页" disabled={!next} onClick={() => next && onSelect(next)}>›</button>
      <footer className="lightbox-footer">
        <span>{pages.length > 1 ? `${currentIndex + 1} / ${pages.length}` : "单页作品"}</span>
        <span>点击图片切换适应窗口 / 1:1</span>
        <span>← → 翻页 · Esc 关闭</span>
      </footer>
    </div>,
    document.body
  );
}
