import { useEffect, useRef, useState } from "react";
import type { ArtworkRecord, CollectionRecord, FilterAction } from "@sanctuary/domain";

const actionText: Record<FilterAction, string> = {
  allow: "清晰",
  blur: "已模糊",
  hide: "已隐藏"
};

export function ArtworkCard({
  artwork,
  collections,
  onAssign,
  onOpen
}: {
  artwork: ArtworkRecord;
  collections: CollectionRecord[];
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpen: (artworkId: string) => void;
}) {
  const action = artwork.decision?.action ?? "blur";
  const imageUrl = artworkImageUrl(artwork);
  const reason = artwork.decision?.reasons[0];
  const analysisFailed = artwork.assessment?.status === "error";
  const trustedByUser = artwork.decision?.action === "allow" && !artwork.assessment;
  const detail = trustedByUser
    ? "Pixiv 主动下载 · 用户信任"
    : analysisFailed
      ? `分析失败 · ${artwork.assessment?.error ?? "未知错误"}`
      : reason
        ? `${reason.label} · ${Math.round(reason.confidence * 100)}%`
        : artwork.assessment?.engine ?? "等待审查";

  return (
    <article className={`art-card action-${action}`}>
      {action === "hide" ? (
        <div className="art-preview">
          <div className="shield"><span>◇</span><strong>内容已隐藏</strong></div>
          <span className={`decision-badge ${action}`}>{actionText[action]}</span>
        </div>
      ) : (
        <button
          className="art-preview art-preview-button"
          aria-label={`放大 ${artwork.source?.title ?? artwork.fileName}`}
          onClick={() => onOpen(artwork.id)}
        >
          <LazyArtworkImage src={imageUrl} className={action === "blur" ? "blurred" : ""} />
          {action !== "allow" && (
            <span className={`decision-badge ${action}`}>
              {analysisFailed ? "分析失败" : actionText[action]}
            </span>
          )}
        </button>
      )}
      <div className="art-meta">
        <strong title={artwork.fileName}>{artwork.fileName}</strong>
        <small title={detail}>{detail}</small>
        <select
          aria-label="加入分类"
          defaultValue=""
          onChange={(event) => onAssign(artwork.id, event.target.value)}
        >
          <option value="">加入分类…</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {artwork.collectionIds.includes(collection.id) ? "✓ " : ""}{collection.name}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

export function artworkImageUrl(artwork: ArtworkRecord): string {
  return `sanctuary-image://local/${encodeURIComponent(artwork.path)}`;
}

export function LazyArtworkImage({ src, className = "" }: { src: string; className?: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || shouldLoad) return;
    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "800px 0px", threshold: 0.01 }
    );
    observer.observe(image);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <img
      ref={imageRef}
      src={shouldLoad ? src : undefined}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      data-lazy-state={shouldLoad ? "loaded" : "waiting"}
    />
  );
}
