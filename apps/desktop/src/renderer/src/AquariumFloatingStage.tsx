import { useEffect, useState, useId } from "react";
import type { ArtworkRecord } from "@sanctuary/domain";
import { artworkImageUrl } from "./ArtworkCard";

export type OceanDepth = "sunlit" | "twilight" | "abyssal";

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
  const [oceanDepth, setOceanDepth] = useState<OceanDepth>("twilight");
  const [isTidalPulsing, setIsTidalPulsing] = useState(false);
  const stageId = useId();

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
    }, 450);
  };

  const triggerTidalPulse = () => {
    if (isTidalPulsing) return;
    setIsTidalPulsing(true);
    window.setTimeout(() => {
      setIsTidalPulsing(false);
    }, 1400);
  };

  if (items.length === 0) {
    return (
      <div className="aquarium-empty-state">
        <div className="aquarium-empty-halo">
          <div className="aquarium-empty-bubble">🫧</div>
        </div>
        <h3>水族馆暂无画作气泡</h3>
        <p>向相册添加画作后，它们将化作晶莹水泡在此漂游浮动。</p>
      </div>
    );
  }

  return (
    <div
      className={`aquarium-stage-viewport depth-${oceanDepth} ${isTidalPulsing ? "is-tidal-pulsing" : ""}`}
      role="region"
      aria-label={`${title} 沉浸水族馆`}
    >
      {/* Volumetric Sunbeams & Deep Sea God Rays */}
      <div className="aquarium-god-rays" aria-hidden="true">
        <span className="god-ray ray-1" />
        <span className="god-ray ray-2" />
        <span className="god-ray ray-3" />
        <span className="god-ray ray-4" />
        <span className="god-ray ray-5" />
      </div>

      {/* Deep Ocean Light Rays & Caustics Shimmer */}
      <div className="aquarium-caustics-layer" aria-hidden="true" />
      <div className="aquarium-deep-vignette" aria-hidden="true" />

      {/* Tidal Wave Surge Overlay (Triggers on Pulse) */}
      {isTidalPulsing && <div className="aquarium-tidal-wave" aria-hidden="true" />}

      {/* Floating Ambient Background Micro-Bubbles */}
      <div className="aquarium-ambient-bubbles" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, idx) => (
          <span
            key={`${stageId}-bubble-${idx}`}
            className={`micro-bubble micro-${(idx % 5) + 1}`}
            style={{
              left: `${(idx * 5.7 + 2) % 96}%`,
              animationDelay: `${(idx * 0.75) % 6}s`,
              animationDuration: `${6.5 + (idx % 7) * 1.3}s`
            }}
          />
        ))}
      </div>

      {/* Bioluminescent Marine Dust & Plankton Motes */}
      <div className="aquarium-plankton-layer" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, idx) => (
          <span
            key={`${stageId}-mote-${idx}`}
            className="plankton-mote"
            style={{
              top: `${(idx * 8.3 + 5) % 92}%`,
              left: `${(idx * 11.7 + 3) % 94}%`,
              animationDelay: `${(idx * 0.45) % 4}s`,
              animationDuration: `${3.5 + (idx % 4) * 1.2}s`
            }}
          />
        ))}
      </div>

      {/* Top Ambient Floating HUD & Ocean Controls */}
      <header className="aquarium-floating-hud">
        <div className="aquarium-hud-pill">
          <span className="aquarium-pulse-dot">🫧</span>
          <span className="aquarium-hud-text">{title} · 深海水族</span>
          <span className="aquarium-hud-count">{items.length} 颗灵感水泡</span>
        </div>

        {/* Ocean Depth Atmosphere Switcher */}
        <div className="aquarium-depth-switcher" role="group" aria-label="水深氛围调色">
          <button
            type="button"
            className={`aquarium-depth-btn ${oceanDepth === "sunlit" ? "active" : ""}`}
            onClick={() => setOceanDepth("sunlit")}
            title="浅海日光 · 0~30m 蔚蓝清澈阳光光斑"
          >
            ☀️ 浅海日光
          </button>
          <button
            type="button"
            className={`aquarium-depth-btn ${oceanDepth === "twilight" ? "active" : ""}`}
            onClick={() => setOceanDepth("twilight")}
            title="暮光幽蓝 · 100~500m 靛蓝深海沉浸静谧"
          >
            🌌 暮光幽蓝
          </button>
          <button
            type="button"
            className={`aquarium-depth-btn ${oceanDepth === "abyssal" ? "active" : ""}`}
            onClick={() => setOceanDepth("abyssal")}
            title="幽邃深渊 · 1000m+ 暗夜荧光水母幻境"
          >
            🪼 幽邃深渊
          </button>
        </div>

        {/* Tidal Pulse Trigger */}
        <div className="aquarium-hud-actions">
          <button
            type="button"
            className={`aquarium-tide-btn ${isTidalPulsing ? "pulsing" : ""}`}
            onClick={triggerTidalPulse}
            title="唤醒深海潮汐，引发全域水流波动"
          >
            <span className="tide-icon">🌊</span>
            <span>唤醒潮汐</span>
          </button>
          <span className="aquarium-hud-hint">点击水泡破茧绽放 · 悬停感知表面张力</span>
        </div>
      </header>

      {/* The Floating Bubbles Swarm Stage */}
      <div className={`aquarium-bubbles-swarm ${isTidalPulsing ? "swarm-pulsing" : ""}`}>
        {items.map((artwork, idx) => {
          const isCover = coverArtworkId ? artwork.id === coverArtworkId : idx === 0;
          const isBursting = burstingId === artwork.id;

          // Categorize bubble size hierarchy
          let sizeCategory: "hero" | "large" | "medium" | "small" = "medium";
          if (isCover || idx === 0) {
            sizeCategory = "hero";
          } else if (idx % 6 === 1 || idx % 6 === 4) {
            sizeCategory = "large";
          } else if (idx % 4 === 2) {
            sizeCategory = "small";
          } else {
            sizeCategory = "medium";
          }

          // Staggered multi-harmonic buoyancy parameters
          const driftDuration = 5.2 + (idx % 6) * 0.85;
          const driftDelay = (idx * 0.61) % 4.8;
          const lateralDuration = 6.8 + (idx % 4) * 1.1;

          return (
            <div
              key={artwork.id}
              role="button"
              tabIndex={0}
              className={`aquarium-bubble size-${sizeCategory} ${isCover ? "is-cover-bubble" : ""} ${isBursting ? "is-bursting" : ""}`}
              style={{
                animationDuration: `${driftDuration}s, ${lateralDuration}s`,
                animationDelay: `-${driftDelay}s, -${driftDelay * 0.7}s`
              }}
              onClick={() => handleBubbleClick(artwork.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleBubbleClick(artwork.id);
                }
              }}
              title={`${artwork.source?.title ?? artwork.fileName} (点击破茧进入影院大图)`}
            >
              {/* Cover Artwork Glowing Orbit Halo */}
              {isCover && (
                <>
                  <div className="bubble-orbit-halo" aria-hidden="true" />
                  <div className="bubble-cover-crown" title="相册/馆藏封面">
                    ★ 封面
                  </div>
                </>
              )}

              {/* Bubble Spherical Shell with Optical Refraction & Highlights */}
              <div className="bubble-sphere-shell">
                {/* Artwork Inside Liquid Lens */}
                <div className="bubble-lens-content">
                  <img
                    src={artworkImageUrl(artwork)}
                    alt={artwork.fileName}
                    className="bubble-artwork-img"
                    loading="eager"
                    decoding="sync"
                  />
                  {/* Spherical Inner Convex Vignette */}
                  <div className="bubble-lens-shadow" />
                </div>

                {/* Thin-Film Iridescence Rim (Prismatic Refraction with rainbow tint) */}
                <div className="bubble-iridescent-rim" />

                {/* Multi-Angle Specular Arcs (Liquid Light Reflections) */}
                <div className="bubble-specular-arc arc-top-left" />
                <div className="bubble-specular-arc arc-bottom-right" />
                <div className="bubble-specular-arc arc-edge-glint" />

                {/* Surface Caustic Sheen */}
                <div className="bubble-surface-sheen" />

                {/* Ripple Shockwave & Splash Drops on Click/Pop */}
                {isBursting && (
                  <>
                    <div className="bubble-pop-shockwave" />
                    <div className="bubble-pop-droplets">
                      <span className="splash-drop drop-1" />
                      <span className="splash-drop drop-2" />
                      <span className="splash-drop drop-3" />
                      <span className="splash-drop drop-4" />
                      <span className="splash-drop drop-5" />
                    </div>
                  </>
                )}
              </div>

              {/* Hover Floating Pearl Information Capsule */}
              <div className="bubble-info-capsule" onClick={(e) => e.stopPropagation()}>
                <div className="capsule-pearl-indicator" />
                <strong className="capsule-title">
                  {artwork.source?.title ?? artwork.fileName}
                </strong>
                <small className="capsule-artist">
                  {artwork.source?.authorName ? `by ${artwork.source.authorName}` : "本地作品"}
                  {artwork.source?.pageIndex !== undefined ? ` · P.${artwork.source.pageIndex + 1}` : ""}
                </small>

                <div className="capsule-actions">
                  <button
                    type="button"
                    className="capsule-btn primary"
                    onClick={() => handleBubbleClick(artwork.id)}
                  >
                    🔍 影院沉浸
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
