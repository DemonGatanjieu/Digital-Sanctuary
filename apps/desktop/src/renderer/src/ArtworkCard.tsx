import { useEffect, useRef, useState } from "react";
import type { ArtworkRecord, CollectionRecord } from "@sanctuary/domain";

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
  const imageUrl = artworkImageUrl(artwork);
  const reason = artwork.decision?.reasons[0];
  const analysisFailed = artwork.assessment?.status === "error";
  const detail = !artwork.assessment
    ? "本地资源 · 原图可见"
    : analysisFailed
      ? "AI 分析暂不可用 · 不影响本地画廊"
      : reason
        ? `AI 记录：${reason.label} · ${Math.round(reason.confidence * 100)}%`
        : artwork.assessment?.engine
          ? `AI 记录：${artwork.assessment.engine}`
          : "本地画廊 · 原图可见";

  return (
    <article className="art-card">
      <button
        className="art-preview art-preview-button"
        aria-label={`放大 ${artwork.source?.title ?? artwork.fileName}`}
        onClick={() => onOpen(artwork.id)}
      >
        <LazyArtworkImage src={imageUrl} />
      </button>
      <div className="art-meta">
        <strong title={artwork.fileName}>{artwork.fileName}</strong>
        <small title={detail}>{detail}</small>
        <select
          aria-label="加入相册"
          defaultValue=""
          onChange={(event) => onAssign(artwork.id, event.target.value)}
        >
          <option value="">加入相册…</option>
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
