import { useEffect, useState } from "react";
import type { ArtworkRecord } from "@sanctuary/domain";
import { artworkImageUrl } from "./ArtworkCard";

export function AquariumFloatingStage({
  items,
  onOpenArtwork,
  onSetCover,
  coverArtworkId,
  title = "深海水族馆"
}: {
  items: ArtworkRecord[];
  onOpenArtwork: (artworkId: string) => void;
  onSetCover?: ((artworkId: string) => void) | undefined;
  coverArtworkId?: string | null | undefined;
  title?: string | undefined;
}) {
  const [burstingId, setBurstingId] = useState<string | null>(null);

  // Pre-cache all collection artworks to memory for instant bubble and lightbox display
  useEffect(() => {
    if (!items || items.length === 0) return;
    items.forEach((item) => {
      const img = new Image();
      img.decoding = "sync";
      img.src = artworkImageUrl(item);
    });
  }, [items]);

  const handleBubbleClick = (artworkId: string) => {
    setBurstingId(artworkId);
    // Trigger open immediately for instantaneous responsiveness
    onOpenArtwork(artworkId);
    window.setTimeout(() => {
      setBurstingId(null);
    }, 300);
  };

  if (items.length === 0) {
    return (
      <div className="aquarium-empty-state">
        <div className="aquarium-empty-bubble">🫧</div>
        <h3>水族馆暂无画作气泡</h3>
        <p>向相册添加画作后，它们将化作晶莹水泡在此漂浮。</p>
      </div>
    );
  }

  return (
    <div className="aquarium-stage-viewport" role="region" aria-label={`${title} 沉浸水族馆`}>
      {/* Deep Ocean Light Rays & Caustics Shimmer */}
      <div className="aquarium-caustics-layer" />
      <div className="aquarium-deep-vignette" />

      {/* Floating Ambient Background Micro-Bubbles */}
      <div className="aquarium-ambient-bubbles" aria-hidden="true">
        {Array.from({ length: 14 }).map((_, idx) => (
          <span
            key={idx}
            className={`micro-bubble micro-${(idx % 4) + 1}`}
            style={{
              left: `${(idx * 7.1 + 3) % 94}%`,
              animationDelay: `${(idx * 0.9) % 5}s`,
              animationDuration: `${7 + (idx % 6) * 1.5}s`
            }}
          />
        ))}
      </div>

      {/* Top Ambient Floating HUD */}
      <header className="aquarium-floating-hud">
        <div className="aquarium-hud-pill">
          <span className="aquarium-pulse-dot">🫧</span>
          <span className="aquarium-hud-text">ABYSSAL AQUARIUM · 沉浸深海水族馆</span>
          <span className="aquarium-hud-count">{items.length} 颗灵感水泡</span>
        </div>
        <span className="aquarium-hud-hint">点击水泡戳破绽放 · 悬停感知表面张力</span>
      </header>

      {/* The Floating Bubbles Swarm Stage */}
      <div className="aquarium-bubbles-swarm">
        {items.map((artwork, idx) => {
          const isCover = coverArtworkId ? artwork.id === coverArtworkId : idx === 0;
          const isBursting = burstingId === artwork.id;
          const action = artwork.decision?.action ?? "allow";

          // Categorize bubble size hierarchy
          let sizeCategory: "hero" | "large" | "medium" | "small" = "medium";
          if (isCover || idx === 0) {
            sizeCategory = "hero";
          } else if (idx % 5 === 1) {
            sizeCategory = "large";
          } else if (idx % 3 === 1) {
            sizeCategory = "small";
          } else {
            sizeCategory = "medium";
          }

          // Staggered buoyancy physics parameters
          const driftDuration = 5 + (idx % 6) * 0.8;
          const driftDelay = (idx * 0.45) % 4.2;

          return (
            <div
              key={artwork.id}
              role="button"
              tabIndex={0}
              className={`aquarium-bubble size-${sizeCategory} ${isCover ? "is-cover-bubble" : ""} ${isBursting ? "is-bursting" : ""}`}
              style={{
                animationDuration: `${driftDuration}s`,
                animationDelay: `-${driftDelay}s`
              }}
              onClick={() => handleBubbleClick(artwork.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleBubbleClick(artwork.id);
                }
              }}
              title={`${artwork.source?.title ?? artwork.fileName} (点击戳破进全屏)`}
            >
              {/* Bubble Spherical Shell with Optical Refraction & Highlights */}
              <div className="bubble-sphere-shell">
                {/* Artwork Inside Water Lens */}
                <div className="bubble-lens-content">
                  {action === "hide" ? (
                    <div className="bubble-shield-box">◇</div>
                  ) : (
                    <img
                      src={artworkImageUrl(artwork)}
                      alt={artwork.fileName}
                      className={`bubble-artwork-img ${action === "blur" ? "blurred" : ""}`}
                      loading="eager"
                      decoding="sync"
                    />
                  )}
                </div>

                {/* Thin-Film Iridescence Rim (Prismatic Refraction) */}
                <div className="bubble-iridescent-rim" />

                {/* Double Specular Arcs (Light Reflections) */}
                <div className="bubble-specular-arc arc-top-left" />
                <div className="bubble-specular-arc arc-bottom-right" />

                {/* Surface Caustic Sheen */}
                <div className="bubble-surface-sheen" />

                {/* Ripple Shockwave Layer on Click/Pop */}
                {isBursting && <div className="bubble-pop-shockwave" />}
              </div>

              {/* Hover Floating Information Capsule */}
              <div className="bubble-info-capsule" onClick={(e) => e.stopPropagation()}>
                <strong className="capsule-title">
                  {artwork.source?.title ?? artwork.fileName}
                </strong>
                <small className="capsule-artist">
                  by {artwork.source?.authorName ?? "本地画师"}
                  {artwork.source?.pageIndex !== undefined ? ` · P.${artwork.source.pageIndex + 1}` : ""}
                </small>

                <div className="capsule-actions">
                  <button
                    type="button"
                    className="capsule-btn primary"
                    onClick={() => handleBubbleClick(artwork.id)}
                  >
                    🔍 影院
                  </button>
                  {onSetCover && (
                    <button
                      type="button"
                      className={`capsule-btn ${isCover ? "active" : ""}`}
                      onClick={() => onSetCover(artwork.id)}
                      disabled={isCover}
                    >
                      {isCover ? "★ 封面" : "设为封面"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
