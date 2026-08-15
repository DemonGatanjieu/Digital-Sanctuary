import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtworkRecord, CollectionRecord, SavedCollectionView } from "@sanctuary/domain";
import { ArtworkCard, artworkImageUrl } from "./ArtworkCard";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import {
  getPhotobookArtworkIndex,
  getPhotobookSpreadForArtworkIndex,
  getPhotobookTotalSpreads,
  normalizePhotoMountStyle,
  resolvePhotobookKeyboardAction,
  type PhotoMountStyle
} from "./photobook-navigation";
import { SegmentedControl } from "./SegmentedControl";

export function CollectionDetailPage({
  collection,
  artworks,
  collections,
  onBack,
  onAssign,
  onOpenArtwork,
  onSetCover,
  onFilterInGallery,
  lightboxOpen = false
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => Promise<void> | void;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover: (artworkId: string) => void;
  onFilterInGallery?: () => void;
  lightboxOpen?: boolean;
}) {
  const items = artworks.filter((artwork) => artwork.collectionIds.includes(collection.id));
  const coverArtwork = artworks.find((a) => a.id === collection.coverArtworkId) ?? items[0];
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const [viewMode, setViewMode] = useState<"flip" | "grid" | "toc">("flip");
  const [isPickingWorks, setIsPickingWorks] = useState(false);
  const [isPhotobookTocOpen, setIsPhotobookTocOpen] = useState(false);

  // Global ESC key listener to exit full-screen game artbook
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isPickingWorks || lightboxOpen) return;
      if (isPhotobookTocOpen) {
        e.preventDefault();
        setIsPhotobookTocOpen(false);
      } else {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPickingWorks, isPhotobookTocOpen, lightboxOpen, onBack]);

  useEffect(() => {
    if (viewMode !== "flip") setIsPhotobookTocOpen(false);
  }, [viewMode]);

  return (
    <section className="album-fullscreen-theater" role="dialog" aria-modal="true" aria-label={`相册《${collection.name}》`}>
      {/* Ambient Blurred Art Backdrop (Game-like Cinema Stage) */}
      <div
        className="theater-ambient-backdrop"
        style={{ backgroundImage: coverUrl ? `url(${coverUrl})` : undefined }}
      />
      <div className="theater-ambient-overlay" />

      {/* Top Game HUD Navigation Bar */}
      <header className="theater-hud-header">
        <div className="theater-hud-left">
          <button className="theater-game-back-btn" onClick={onBack} title="退出相册返回书架 (ESC)">
            <span className="key-badge">ESC</span>
            <span>✕ 返回书架</span>
          </button>
          <div className="theater-album-title-block">
            <span className="theater-sub-tag">DIGITAL SANCTUARY · MEMORIAL ALBUM</span>
            <h1 className="theater-album-title">{collection.name}</h1>
          </div>
        </div>

        <div className="theater-hud-center">
          <SegmentedControl
            compact
            label="画册模式"
            value={viewMode}
            options={[
              { value: "flip", label: "📖 翻页画册", title: "实体画册双页对开翻页质感" },
              { value: "grid", label: "🖼️ 典藏网格", title: "全景网格速览" },
              { value: "toc", label: "📑 篇目目录", title: "书籍篇目索引" }
            ]}
            onChange={(val) => setViewMode(val as "flip" | "grid" | "toc")}
          />
        </div>

        <div className="theater-hud-right">
          {onFilterInGallery && (
            <button className="theater-action-pill" onClick={onFilterInGallery} title="在画廊大网格中筛选此相册">
              在画廊中筛选
            </button>
          )}
          <button className="theater-action-pill primary" onClick={() => setIsPickingWorks(true)} title="从全库挑选作品收录入相册">
            + 添加画作 ({items.length})
          </button>
        </div>
      </header>

      {/* Main Theater Content Area */}
      <main className="theater-stage-canvas">
        {items.length === 0 ? (
          <div className="theater-empty-state">
            <div className="theater-empty-book-icon">📖</div>
            <h2>《{collection.name}》尚未收录画作</h2>
            <p>{collection.description || "暂无题记。您可以直接从画廊中挑选精美作品收录至本相册。"}</p>
            <Button variant="primary" style={{ marginTop: 16 }} onClick={() => setIsPickingWorks(true)}>
              + 立即从画廊挑选作品入册
            </Button>
          </div>
        ) : viewMode === "flip" ? (
          /* 3D Real Photobook Double-Spread Flip Theater */
          <PhotobookFlipSpread
            collection={collection}
            items={items}
            onOpenArtwork={onOpenArtwork}
            onSetCover={onSetCover}
            onOpenPicker={() => setIsPickingWorks(true)}
            isTocOpen={isPhotobookTocOpen}
            onTocOpenChange={setIsPhotobookTocOpen}
            interactionSuspended={isPickingWorks || lightboxOpen}
          />
        ) : viewMode === "toc" ? (
          /* Table of Contents Mode (画册目录索引模式) */
          <div className="theater-toc-scroll-box">
            <div className="album-toc-container">
              <div className="album-toc-header">
                <span>INDEX / 索引编号</span>
                <span>TITLE & ARTIST / 作品篇目</span>
                <span>PREVIEW / 预览缩略图</span>
                <span>ACTION / 选项</span>
              </div>
              <div className="album-toc-list">
                {items.map((artwork, idx) => {
                  const numStr = String(idx + 1).padStart(2, "0");
                  const isCover = collection.coverArtworkId === artwork.id;
                  return (
                    <div
                      key={artwork.id}
                      className={`album-toc-row ${isCover ? "is-cover" : ""}`}
                      onClick={() => onOpenArtwork(artwork.id)}
                    >
                      <div className="toc-index-cell">
                        <span className="toc-number">№ {numStr}</span>
                        {isCover && <span className="toc-cover-tag">封面</span>}
                      </div>

                      <div className="toc-title-cell">
                        <strong className="toc-title">{artwork.source?.title ?? artwork.fileName}</strong>
                        <small className="toc-artist">
                          by {artwork.source?.authorName ?? "本地画师"}
                          {artwork.source?.pageIndex !== undefined ? ` · 第 ${artwork.source.pageIndex + 1} 页` : ""}
                        </small>
                      </div>

                      <div className="toc-thumb-cell">
                        <img src={artworkImageUrl(artwork)} alt="" loading="lazy" />
                      </div>

                      <div className="toc-action-cell" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`toc-set-cover-btn ${isCover ? "active" : ""}`}
                          onClick={() => onSetCover(artwork.id)}
                          disabled={isCover}
                        >
                          {isCover ? "当前封面" : "设为相册封面"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Grid Mode (画册网格画廊模式) */
          <div className="theater-grid-scroll-box">
            <div className="gallery-grid collection-detail-grid">
              {items.map((artwork) => (
                <div className="collection-artwork" key={artwork.id}>
                  <ArtworkCard artwork={artwork} collections={collections} onAssign={onAssign} onOpen={onOpenArtwork} />
                  <button
                    type="button"
                    className={`collection-cover-action ${collection.coverArtworkId === artwork.id ? "active" : ""}`}
                    onClick={() => onSetCover(artwork.id)}
                    disabled={collection.coverArtworkId === artwork.id}
                  >
                    {collection.coverArtworkId === artwork.id ? "当前封面" : "设为相册封面"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Game Hotkey Legend Bar */}
      <footer className="theater-hud-footer">
        <div className="game-key-prompt-row">
          <span className="key-prompt"><kbd>←</kbd> <kbd>A</kbd> 上一页</span>
          <span className="key-prompt"><kbd>→</kbd> <kbd>D</kbd> <kbd>Space</kbd> 下一页</span>
          <span className="key-prompt"><kbd>Click</kbd> 点击左右页翻页</span>
          <span className="key-prompt"><kbd>ESC</kbd> 退出相册</span>
        </div>
        <div className="theater-footer-stats">
          <span>共收录 <strong>{items.length}</strong> 幅典藏画作</span>
        </div>
      </footer>

      {/* Add Works from Library Modal Picker */}
      {isPickingWorks && (
        <AddWorksToAlbumDialog
          collection={collection}
          allArtworks={artworks}
          onClose={() => setIsPickingWorks(false)}
          onAdd={async (selectedArtworkIds) => {
            for (const id of selectedArtworkIds) {
              await onAssign(id, collection.id);
            }
            setIsPickingWorks(false);
          }}
        />
      )}
    </section>
  );
}

/* ==========================================================================
   Photobook Flip Spread View (拟真画册对开翻页书台)
   ========================================================================== */

export type PhotobookTurnEffect = "3d-flip" | "slide" | "fade" | "deck-stack";

function normalizeTurnEffect(val: string | null): PhotobookTurnEffect {
  if (val === "slide" || val === "fade" || val === "deck-stack" || val === "3d-flip") {
    return val;
  }
  return "3d-flip";
}

const TURN_EFFECTS: Array<{ id: PhotobookTurnEffect; label: string; icon: string; description: string }> = [
  { id: "3d-flip", label: "3D 翻页", icon: "📖", description: "立体物理纸张翻折，典藏精装书手感" },
  { id: "slide", label: "平移动画", icon: "↔️", description: "极速丝滑横向平移，平稳零晃动，超高帧率" },
  { id: "fade", label: "柔光渐隐", icon: "✨", description: "电影级柔和淡入淡出，沉浸式呼吸感" },
  { id: "deck-stack", label: "层叠抽拉", icon: "🃏", description: "画作相纸层叠滑出，触感交互体验" }
];

const MOUNT_STYLES: Array<{ id: PhotoMountStyle; label: string; icon: string; description: string }> = [
  { id: "corners", label: "典藏相角", icon: "🔲", description: "四角金属/复古相角扣件 + 相纸细腻白边 + 立体双层悬浮阴影" },
  { id: "washi-tape", label: "和纸手账", icon: "🏷️", description: "半透明磨砂和纸胶贴 + 微角度手账同人画集感" },
  { id: "gallery-float", label: "画廊浮雕", icon: "🖼️", description: "极简无框悬浮 + 精密相纸倒角高光与环境光遮蔽" },
  { id: "polaroid", label: "复古拍立得", icon: "📷", description: "经典下宽拍立得相纸留白 + 手写体篇目题记与艺术印戳" }
];

export interface PhotobookAlbumInfo {
  id?: string;
  name: string;
  description?: string;
  coverArtworkId?: string | null;
}

export function PhotobookFlipSpread({
  collection,
  items,
  onOpenArtwork,
  onSetCover,
  onOpenPicker,
  isTocOpen,
  onTocOpenChange,
  interactionSuspended = false
}: {
  collection: PhotobookAlbumInfo | CollectionRecord;
  items: ArtworkRecord[];
  onOpenArtwork: (artworkId: string) => void;
  onSetCover?: ((artworkId: string) => void) | undefined;
  onOpenPicker?: (() => void) | undefined;
  isTocOpen: boolean;
  onTocOpenChange: (open: boolean) => void;
  interactionSuspended?: boolean | undefined;
}) {
  const [mountStyle, setMountStyle] = useState<PhotoMountStyle>(() => {
    return normalizePhotoMountStyle(localStorage.getItem("sanctuary_photobook_mount_style"));
  });

  const [turnEffect, setTurnEffect] = useState<PhotobookTurnEffect>(() => {
    return normalizeTurnEffect(localStorage.getItem("sanctuary_photobook_turn_effect"));
  });

  const changeMountStyle = (style: PhotoMountStyle) => {
    setMountStyle(style);
    try {
      localStorage.setItem("sanctuary_photobook_mount_style", style);
    } catch {
      // Ignore storage errors
    }
  };

  const changeTurnEffect = (effect: PhotobookTurnEffect) => {
    setTurnEffect(effect);
    try {
      localStorage.setItem("sanctuary_photobook_turn_effect", effect);
    } catch {
      // Ignore storage errors
    }
  };

  // Calculate total spreads: Spread 0 (Preface + Art 0), Spread 1+ (Art 2K-1 + Art 2K)
  const totalSpreads = getPhotobookTotalSpreads(items.length);

  // Unified Atomic Spread State Machine (Guarantees zero-desync between current spread and transition)
  const [spreadState, setSpreadState] = useState<{
    currentSpread: number;
    isAnimating: boolean;
    direction: "forward" | "backward";
    fromSpread: number;
    toSpread: number;
  }>({
    currentSpread: 0,
    isAnimating: false,
    direction: "forward",
    fromSpread: 0,
    toSpread: 0
  });

  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
  }, []);

  // Pre-cache all collection artworks into browser memory immediately to guarantee zero decoding flash
  useEffect(() => {
    if (!items || items.length === 0) return;
    items.forEach((item) => {
      const img = new Image();
      img.decoding = "sync";
      img.src = artworkImageUrl(item);
    });
  }, [items]);

  useEffect(() => {
    const safeSpread = Math.min(spreadState.currentSpread, Math.max(0, totalSpreads - 1));
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setSpreadState({
      currentSpread: safeSpread,
      isAnimating: false,
      direction: "forward",
      fromSpread: safeSpread,
      toSpread: safeSpread
    });
  }, [totalSpreads]);


  const finishFlip = (targetSpread: number) => {
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setSpreadState((prev) => ({
      currentSpread: targetSpread,
      isAnimating: false,
      direction: prev.direction,
      fromSpread: targetSpread,
      toSpread: targetSpread
    }));
  };

  const flipToSpread = (targetSpread: number) => {
    if (
      targetSpread < 0 ||
      targetSpread >= totalSpreads ||
      targetSpread === spreadState.currentSpread ||
      spreadState.isAnimating
    )
      return;
    const direction = targetSpread > spreadState.currentSpread ? "forward" : "backward";
    setSpreadState({
      currentSpread: spreadState.currentSpread,
      isAnimating: true,
      direction,
      fromSpread: spreadState.currentSpread,
      toSpread: targetSpread
    });

    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    const timeoutDuration = turnEffect === "fade" ? 450 : (turnEffect === "slide" ? 520 : (turnEffect === "deck-stack" ? 560 : 650));
    fallbackTimerRef.current = window.setTimeout(() => {
      finishFlip(targetSpread);
    }, timeoutDuration);
  };

  const flipNext = () => flipToSpread(Math.min(totalSpreads - 1, spreadState.currentSpread + 1));
  const flipPrev = () => flipToSpread(Math.max(0, spreadState.currentSpread - 1));

  const flipToArtwork = (artIdx: number) => {
    flipToSpread(getPhotobookSpreadForArtworkIndex(artIdx));
  };

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const action = resolvePhotobookKeyboardAction({
        key: e.key,
        code: e.code,
        targetIsEditable: Boolean(target?.closest("input, textarea, select, [contenteditable='true']")),
        interactionSuspended,
        tocOpen: isTocOpen
      });

      if (action === "toggle-toc") {
        e.preventDefault();
        onTocOpenChange(!isTocOpen);
      } else if (action === "next") {
        e.preventDefault();
        flipNext();
      } else if (action === "previous") {
        e.preventDefault();
        flipPrev();
      } else if (action === "home") {
        e.preventDefault();
        flipToSpread(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [spreadState.currentSpread, isTocOpen, totalSpreads, spreadState.isAnimating, interactionSuspended]);

  if (items.length === 0) return null;

  // Active spread display indices (Atomic synchronization)
  let displayLeftSpread = spreadState.currentSpread;
  let displayRightSpread = spreadState.currentSpread;

  if (spreadState.isAnimating) {
    if (turnEffect === "3d-flip") {
      displayLeftSpread = spreadState.direction === "forward" ? spreadState.fromSpread : spreadState.toSpread;
      displayRightSpread = spreadState.direction === "forward" ? spreadState.toSpread : spreadState.fromSpread;
    } else if (turnEffect === "slide" || turnEffect === "fade") {
      displayLeftSpread = spreadState.fromSpread;
      displayRightSpread = spreadState.fromSpread;
    } else if (turnEffect === "deck-stack") {
      displayLeftSpread = spreadState.toSpread;
      displayRightSpread = spreadState.toSpread;
    }
  }

  return (
    <div className="photobook-stage-deck">
      {/* Top Floating Toolbar (Quick TOC Button, Turn Effect Switcher & Mount Switcher) */}
      <div className="photobook-toolbar-header">
        <div className="photobook-toolbar-left">
          <button
            type="button"
            className={`photobook-toc-trigger-btn ${isTocOpen ? "active" : ""}`}
            onClick={() => onTocOpenChange(!isTocOpen)}
            title="查看画集完整篇目索引目录 (快捷键: T / M)"
          >
            <span className="btn-icon">📑</span>
            <span className="btn-text">篇目索引</span>
            <span className="btn-count">{items.length} 篇</span>
          </button>
        </div>

        <div className="photobook-toolbar-right">
          {/* Turn Effect Switcher */}
          <div className="photobook-mount-switcher photobook-effect-switcher">
            <span className="mount-switcher-label">✨ 翻页效果</span>
            <div className="mount-switcher-options">
              {TURN_EFFECTS.map((eff) => (
                <button
                  key={eff.id}
                  type="button"
                  className={`mount-style-pill ${turnEffect === eff.id ? "active" : ""}`}
                  onClick={() => changeTurnEffect(eff.id)}
                  title={eff.description}
                >
                  <span className="mount-pill-icon">{eff.icon}</span>
                  <span className="mount-pill-text">{eff.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Mount Style Switcher */}
          <div className="photobook-mount-switcher">
            <span className="mount-switcher-label">🎴 装裱风格</span>
            <div className="mount-switcher-options">
              {MOUNT_STYLES.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  className={`mount-style-pill ${mountStyle === st.id ? "active" : ""}`}
                  onClick={() => changeMountStyle(st.id)}
                  title={st.description}
                >
                  <span className="mount-pill-icon">{st.icon}</span>
                  <span className="mount-pill-text">{st.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3D Open Hardcover Double Spread (Permanent Double Page Deck) */}
      <div className={`photobook-double-spread ${spreadState.isAnimating ? `is-animating flip-${spreadState.direction} effect-${turnEffect}` : ""}`}>
        {/* Left Page (Verso) */}
        <section className="photobook-page page-verso" onClick={flipPrev} title="点击左页翻至上一展对 (← / A)">
          <div className="page-paper-texture" />
          <div className="page-corner-curl corner-verso" onClick={(e) => { e.stopPropagation(); flipPrev(); }} title="点击翻至上一展对" />
          
          <PhotobookSpreadPageContent
            side="left"
            spreadIndex={displayLeftSpread}
            collection={collection}
            items={items}
            mountStyle={mountStyle}
            totalSpreads={totalSpreads}
            onOpenArtwork={onOpenArtwork}
            onSetCover={onSetCover}
            onOpenToc={() => onTocOpenChange(true)}
            onFlipToSpread={flipToSpread}
            onFlipPrev={flipPrev}
            onFlipNext={flipNext}
          />
        </section>

        {/* Central Book Spine Gutter Seam */}
        <div className="photobook-spine-crease" />

        {/* Right Page (Recto) */}
        <section
          className="photobook-page page-recto"
          onClick={flipNext}
          title="点击右页翻至下一展对 (→ / D / 空格)"
        >
          <div className="page-paper-texture" />
          <div className="page-corner-curl corner-recto" onClick={(e) => { e.stopPropagation(); flipNext(); }} title="点击翻至下一展对" />

          <PhotobookSpreadPageContent
            side="right"
            spreadIndex={displayRightSpread}
            collection={collection}
            items={items}
            mountStyle={mountStyle}
            totalSpreads={totalSpreads}
            onOpenArtwork={onOpenArtwork}
            onSetCover={onSetCover}
            onOpenToc={() => onTocOpenChange(true)}
            onFlipToSpread={flipToSpread}
            onFlipPrev={flipPrev}
            onFlipNext={flipNext}
          />
        </section>

        {/* Animation Overlays for 4 Turn Effects */}
        {spreadState.isAnimating && (
          <>
            {/* 1. 3D Physical Flipping Leaf */}
            {turnEffect === "3d-flip" && (
              <div
                className={`photobook-3d-flipping-leaf leaf-${spreadState.direction}`}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) {
                    finishFlip(spreadState.toSpread);
                  }
                }}
              >
                <div className="leaf-face leaf-face-front">
                  <div className="page-paper-texture" />
                  <PhotobookSpreadPageContent
                    side={spreadState.direction === "forward" ? "right" : "left"}
                    spreadIndex={spreadState.fromSpread}
                    collection={collection}
                    items={items}
                    mountStyle={mountStyle}
                    totalSpreads={totalSpreads}
                    onOpenArtwork={onOpenArtwork}
                    onSetCover={onSetCover}
                    onOpenToc={() => onTocOpenChange(true)}
                    onFlipToSpread={flipToSpread}
                    onFlipPrev={flipPrev}
                    onFlipNext={flipNext}
                  />
                </div>
                <div className="leaf-face leaf-face-back">
                  <div className="page-paper-texture" />
                  <PhotobookSpreadPageContent
                    side={spreadState.direction === "forward" ? "left" : "right"}
                    spreadIndex={spreadState.toSpread}
                    collection={collection}
                    items={items}
                    mountStyle={mountStyle}
                    totalSpreads={totalSpreads}
                    onOpenArtwork={onOpenArtwork}
                    onSetCover={onSetCover}
                    onOpenToc={() => onTocOpenChange(true)}
                    onFlipToSpread={flipToSpread}
                    onFlipPrev={flipPrev}
                    onFlipNext={flipNext}
                  />
                </div>
              </div>
            )}

            {/* 2. Silky Dual-Spread Horizontal Slide Track (Zero Premature Left Image Exposure) */}
            {turnEffect === "slide" && (
              <div
                className={`photobook-slide-overlay slide-${spreadState.direction}`}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) {
                    finishFlip(spreadState.toSpread);
                  }
                }}
              >
                <div className="photobook-slide-track">
                  {spreadState.direction === "forward" ? (
                    <>
                      {/* Outgoing Spread (fromSpread) */}
                      <div className="slide-spread-unit">
                        <section className="photobook-page page-verso">
                          <PhotobookSpreadPageContent
                            side="left"
                            spreadIndex={spreadState.fromSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                        <div className="photobook-spine-crease" />
                        <section className="photobook-page page-recto">
                          <PhotobookSpreadPageContent
                            side="right"
                            spreadIndex={spreadState.fromSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                      </div>

                      {/* Incoming Spread (toSpread) */}
                      <div className="slide-spread-unit">
                        <section className="photobook-page page-verso">
                          <PhotobookSpreadPageContent
                            side="left"
                            spreadIndex={spreadState.toSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                        <div className="photobook-spine-crease" />
                        <section className="photobook-page page-recto">
                          <PhotobookSpreadPageContent
                            side="right"
                            spreadIndex={spreadState.toSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Incoming Spread (toSpread) */}
                      <div className="slide-spread-unit">
                        <section className="photobook-page page-verso">
                          <PhotobookSpreadPageContent
                            side="left"
                            spreadIndex={spreadState.toSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                        <div className="photobook-spine-crease" />
                        <section className="photobook-page page-recto">
                          <PhotobookSpreadPageContent
                            side="right"
                            spreadIndex={spreadState.toSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                      </div>

                      {/* Outgoing Spread (fromSpread) */}
                      <div className="slide-spread-unit">
                        <section className="photobook-page page-verso">
                          <PhotobookSpreadPageContent
                            side="left"
                            spreadIndex={spreadState.fromSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                        <div className="photobook-spine-crease" />
                        <section className="photobook-page page-recto">
                          <PhotobookSpreadPageContent
                            side="right"
                            spreadIndex={spreadState.fromSpread}
                            collection={collection}
                            items={items}
                            mountStyle={mountStyle}
                            totalSpreads={totalSpreads}
                            onOpenArtwork={onOpenArtwork}
                            onSetCover={onSetCover}
                            onOpenToc={() => onTocOpenChange(true)}
                            onFlipToSpread={flipToSpread}
                            onFlipPrev={flipPrev}
                            onFlipNext={flipNext}
                          />
                        </section>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 3. Serene Crossfade Dissolve */}
            {turnEffect === "fade" && (
              <div
                className="photobook-fade-overlay"
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) {
                    finishFlip(spreadState.toSpread);
                  }
                }}
              >
                <div className="fade-deck-spread">
                  <section className="photobook-page page-verso">
                    <PhotobookSpreadPageContent
                      side="left"
                      spreadIndex={spreadState.toSpread}
                      collection={collection}
                      items={items}
                      mountStyle={mountStyle}
                      totalSpreads={totalSpreads}
                      onOpenArtwork={onOpenArtwork}
                      onSetCover={onSetCover}
                      onOpenToc={() => onTocOpenChange(true)}
                      onFlipToSpread={flipToSpread}
                      onFlipPrev={flipPrev}
                      onFlipNext={flipNext}
                    />
                  </section>
                  <div className="photobook-spine-crease" />
                  <section className="photobook-page page-recto">
                    <PhotobookSpreadPageContent
                      side="right"
                      spreadIndex={spreadState.toSpread}
                      collection={collection}
                      items={items}
                      mountStyle={mountStyle}
                      totalSpreads={totalSpreads}
                      onOpenArtwork={onOpenArtwork}
                      onSetCover={onSetCover}
                      onOpenToc={() => onTocOpenChange(true)}
                      onFlipToSpread={flipToSpread}
                      onFlipPrev={flipPrev}
                      onFlipNext={flipNext}
                    />
                  </section>
                </div>
              </div>
            )}

            {/* 4. Tactile Deck Stack Slide & Tuck */}
            {turnEffect === "deck-stack" && (
              <div
                className={`photobook-deck-stack-overlay deck-${spreadState.direction}`}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) {
                    finishFlip(spreadState.toSpread);
                  }
                }}
              >
                <div className="deck-stack-outgoing-spread">
                  <section className="photobook-page page-verso">
                    <PhotobookSpreadPageContent
                      side="left"
                      spreadIndex={spreadState.fromSpread}
                      collection={collection}
                      items={items}
                      mountStyle={mountStyle}
                      totalSpreads={totalSpreads}
                      onOpenArtwork={onOpenArtwork}
                      onSetCover={onSetCover}
                      onOpenToc={() => onTocOpenChange(true)}
                      onFlipToSpread={flipToSpread}
                      onFlipPrev={flipPrev}
                      onFlipNext={flipNext}
                    />
                  </section>
                  <div className="photobook-spine-crease" />
                  <section className="photobook-page page-recto">
                    <PhotobookSpreadPageContent
                      side="right"
                      spreadIndex={spreadState.fromSpread}
                      collection={collection}
                      items={items}
                      mountStyle={mountStyle}
                      totalSpreads={totalSpreads}
                      onOpenArtwork={onOpenArtwork}
                      onSetCover={onSetCover}
                      onOpenToc={() => onTocOpenChange(true)}
                      onFlipToSpread={flipToSpread}
                      onFlipPrev={flipPrev}
                      onFlipNext={flipNext}
                    />
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Acrylic Glass Table of Contents Drawer */}
      <PhotobookTocDrawer
        isOpen={isTocOpen}
        collection={collection}
        items={items}
        currentSpreadIndex={spreadState.currentSpread}
        onClose={() => onTocOpenChange(false)}
        onSelectArtwork={(artIdx) => {
          flipToArtwork(artIdx);
          onTocOpenChange(false);
        }}
      />
    </div>
  );
}

/**
 * Universal Double-Spread Page Renderer (Handles Left & Right Pages for any spread)
 */
function PhotobookSpreadPageContent({
  side,
  spreadIndex,
  collection,
  items,
  mountStyle,
  totalSpreads,
  onOpenArtwork,
  onSetCover,
  onOpenToc,
  onFlipToSpread,
  onFlipPrev,
  onFlipNext
}: {
  side: "left" | "right";
  spreadIndex: number;
  collection: PhotobookAlbumInfo | CollectionRecord;
  items: ArtworkRecord[];
  mountStyle: PhotoMountStyle;
  totalSpreads: number;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover?: ((artworkId: string) => void) | undefined;
  onOpenToc: () => void;
  onFlipToSpread: (spreadIdx: number) => void;
  onFlipPrev: () => void;
  onFlipNext: () => void;
}) {
  const spreadNumStr = String(spreadIndex + 1).padStart(2, "0");
  const totalSpreadsStr = String(totalSpreads).padStart(2, "0");

  // --- Spread 0: Left Page is Album Preface / Epigraph Foreword ---
  if (spreadIndex === 0 && side === "left") {
    const coverArt = items[0];
    return (
      <>
        <header className="page-header-index">
          <span className="page-eyebrow">CHAPTER / 卷首题记</span>
          <span className="page-corner-num">P. 00</span>
        </header>

        <div className="verso-content-scroll" onClick={(e) => e.stopPropagation()}>
          <div className="verso-preface-hero">
            <span className="preface-curation-badge">SANCTUARY FINE ARTBOOK</span>
            <h1 className="preface-album-title">{collection.name}</h1>
          </div>

          {/* Epigraph / Curator Note */}
          <div className="verso-epigraph-quote">
            <span className="quote-mark">“</span>
            <p>{collection.description || "收录心之所向的灵感画作，于纯净领域中沉淀艺术回响。"}</p>
            <span className="quote-mark">”</span>
          </div>

          <div className="preface-meta-panel">
            <div className="preface-meta-item">
              <span className="meta-label">收录作品</span>
              <span className="meta-value">{items.length} 幅原画</span>
            </div>
            <div className="preface-meta-item">
              <span className="meta-label">全书篇幅</span>
              <span className="meta-value">{totalSpreads} 组对开展台</span>
            </div>
            {coverArt?.source?.authorName && (
              <div className="preface-meta-item">
                <span className="meta-label">卷首封面</span>
                <span className="meta-value">by {coverArt.source.authorName}</span>
              </div>
            )}
          </div>

          {/* Quick TOC Button on Preface */}
          <div className="preface-action-box">
            <button
              type="button"
              className="preface-open-toc-btn"
              onClick={onOpenToc}
              title="展开完整篇目索引目录 (T)"
            >
              📑 展开篇目总览索引
            </button>
            <p className="preface-tip-text">按 ← → 键翻阅 · 按 T 随时展开目录</p>
          </div>
        </div>

        <footer className="page-footer-verso" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="book-flip-nav-btn prev"
            disabled={true}
            title="已是卷首"
          >
            ‹ 卷首
          </button>
          <span className="book-page-counter">
            {spreadNumStr} / {totalSpreadsStr}
          </span>
        </footer>
      </>
    );
  }

  // --- Determine which artwork belongs to this page ---
  const artworkIndex = getPhotobookArtworkIndex(spreadIndex, side, items.length);
  const artwork = artworkIndex === null ? null : items[artworkIndex];
  const isCover = artwork && collection.coverArtworkId === artwork.id;
  const pageNumStr = artwork && artworkIndex !== null ? String(artworkIndex + 1).padStart(2, "0") : "END";

  // --- Colophon (Endplate) if no artwork on this page ---
  if (artworkIndex === null || !artwork) {
    return (
      <>
        <header className={side === "left" ? "page-header-index" : "page-header-art"}>
          <span className="page-eyebrow">COLOPHON / 篇目尾声</span>
          <span className="page-corner-num">P. {pageNumStr}</span>
        </header>

        <div className="verso-content-scroll" onClick={(e) => e.stopPropagation()}>
          <div className="colophon-card">
            <span className="colophon-seal">🏛️</span>
            <h3 className="colophon-title">DIGITAL SANCTUARY</h3>
            <p className="colophon-text">本画集全篇呈现完毕 · 感谢您的静心驻足</p>
            <button
              type="button"
              className="colophon-home-btn"
              onClick={() => onFlipToSpread(0)}
              title="返回画集卷首 (Home)"
            >
              ⏮️ 返回卷首开篇
            </button>
          </div>
        </div>

        <footer className={side === "left" ? "page-footer-verso" : "page-footer-recto"} onClick={(e) => e.stopPropagation()}>
          {side === "left" ? (
            <button type="button" className="book-flip-nav-btn prev" onClick={onFlipPrev} title="上一展对">
              ‹ 上一页
            </button>
          ) : (
            <span className="page-recto-tip">已至画集尾声</span>
          )}
          <span className="book-page-counter">
            {spreadNumStr} / {totalSpreadsStr}
          </span>
        </footer>
      </>
    );
  }

  // --- Mounted Photo Artwork Spread Page ---
  return (
    <>
      <header className={side === "left" ? "page-header-index" : "page-header-art"}>
        <span className={side === "left" ? "page-eyebrow" : "page-ribbon-tag"}>
          {isCover ? "★ 卷首封面首作" : `GALLERY FINE ART · № ${pageNumStr}`}
        </span>
        <span className="page-corner-num">P. {pageNumStr}</span>
      </header>

      <PhotoMountCard
        artwork={artwork}
        mountStyle={mountStyle}
        pageIndex={artworkIndex}
        isCover={Boolean(isCover)}
        onOpenArtwork={onOpenArtwork}
        onSetCover={onSetCover}
      />

      <footer className={side === "left" ? "page-footer-verso" : "page-footer-recto"} onClick={(e) => e.stopPropagation()}>
        {side === "left" ? (
          <>
            <button
              type="button"
              className="book-flip-nav-btn prev"
              disabled={spreadIndex === 0}
              onClick={onFlipPrev}
              title="上一展对 (← / A)"
            >
              ‹ 上一展对
            </button>
            <span className="book-page-counter">
              {spreadNumStr} / {totalSpreadsStr}
            </span>
          </>
        ) : (
          <>
            <span className="page-recto-tip">按 ← → 键翻页</span>
            <button
              type="button"
              className="book-flip-nav-btn next"
              disabled={spreadIndex >= totalSpreads - 1}
              onClick={onFlipNext}
              title="下一展对 (→ / D / 空格)"
            >
              下一展对 ›
            </button>
          </>
        )}
      </footer>
    </>
  );
}

/**
 * Floating Acrylic Glass Table of Contents Drawer
 */
function PhotobookTocDrawer({
  isOpen,
  collection,
  items,
  currentSpreadIndex,
  onClose,
  onSelectArtwork
}: {
  isOpen: boolean;
  collection: PhotobookAlbumInfo | CollectionRecord;
  items: ArtworkRecord[];
  currentSpreadIndex: number;
  onClose: () => void;
  onSelectArtwork: (artworkIndex: number) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  if (!isOpen) return null;

  const filteredItems = items.filter((it) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (it.source?.title?.toLowerCase().includes(q) ?? false) ||
      (it.source?.authorName?.toLowerCase().includes(q) ?? false) ||
      it.fileName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="photobook-toc-overlay" onClick={onClose}>
      <div className="photobook-toc-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="toc-drawer-header">
          <div className="toc-drawer-title-group">
            <span className="toc-drawer-eyebrow">TABLE OF CONTENTS</span>
            <h2 className="toc-drawer-title">📑 篇目索引目录</h2>
            <p className="toc-drawer-subtitle">
              《{collection.name}》· 共收录 {items.length} 篇典藏原画
            </p>
          </div>
          <button
            type="button"
            className="toc-drawer-close-btn"
            onClick={onClose}
            title="关闭目录 (ESC / T)"
          >
            ✕
          </button>
        </div>

        {/* Quick Search */}
        <div className="toc-drawer-search-bar">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="toc-search-input"
            placeholder="搜索画作标题、画师..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          {searchTerm && (
            <button type="button" className="search-clear-btn" onClick={() => setSearchTerm("")}>
              ✕
            </button>
          )}
        </div>

        {/* Items List */}
        <div className="toc-drawer-items-scroll">
          {filteredItems.map((item) => {
            const originalIndex = items.indexOf(item);
            const itemSpread = originalIndex === 0 ? 0 : 1 + Math.floor((originalIndex - 1) / 2);
            const isCurrentlyActive = itemSpread === currentSpreadIndex;
            const idxStr = String(originalIndex + 1).padStart(2, "0");
            const sideLabel = originalIndex === 0 ? "右页 (封面)" : (originalIndex - 1) % 2 === 0 ? "左页" : "右页";

            return (
              <div
                key={item.id}
                className={`toc-drawer-card ${isCurrentlyActive ? "active" : ""}`}
                onClick={() => onSelectArtwork(originalIndex)}
                title={`翻至第 ${itemSpread + 1} 展对 (${sideLabel})`}
              >
                <div className="toc-card-thumb-wrap">
                  <img src={artworkImageUrl(item)} alt="" className="toc-card-thumb" loading="lazy" />
                  <span className="toc-card-badge">#{idxStr}</span>
                </div>
                <div className="toc-card-info">
                  <h4 className="toc-card-title">{item.source?.title ?? item.fileName}</h4>
                  <p className="toc-card-artist">
                    by {item.source?.authorName ?? "本地画师"}
                  </p>
                  <div className="toc-card-spread-tag">
                    <span>展对 {itemSpread + 1} · {sideLabel}</span>
                    {isCurrentlyActive && <span className="active-dot-tag">★ 当前展对</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Photorealistic Mounted Art Plate Component
 */
function PhotoMountCard({
  artwork,
  mountStyle,
  pageIndex,
  isCover,
  onOpenArtwork,
  onSetCover
}: {
  artwork: ArtworkRecord;
  mountStyle: PhotoMountStyle;
  pageIndex: number;
  isCover: boolean;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover?: ((artworkId: string) => void) | undefined;
}) {
  const pageNumStr = String(pageIndex + 1).padStart(2, "0");

  return (
    <div className={`art-photo-mount-stage mount-${mountStyle}`} onClick={(e) => e.stopPropagation()}>
      {/* Decorative Mounting Corners (for 'corners' style) */}
      {mountStyle === "corners" && (
        <div className="photo-mount-corners-layer">
          <span className="mount-corner corner-top-left" />
          <span className="mount-corner corner-top-right" />
          <span className="mount-corner corner-bottom-left" />
          <span className="mount-corner corner-bottom-right" />
        </div>
      )}

      {/* Decorative Washi Tape Strips (for 'washi-tape' style) */}
      {mountStyle === "washi-tape" && (
        <div className="photo-washi-tape-layer">
          <span className="washi-tape-strip tape-top-left" />
          <span className="washi-tape-strip tape-top-right" />
        </div>
      )}

      {/* The Physical Photo Mat & Image Surface */}
      <div className="art-photo-mat-surface">
        <div className="photo-image-frame">
          <img
            src={artworkImageUrl(artwork)}
            alt={artwork.fileName}
            className="art-matte-image"
            loading="eager"
            decoding="sync"
          />

          {/* Floating Quick Actions Capsule */}
          <div className="art-plate-actions">
            <button
              type="button"
              className="art-action-lightbox-btn"
              onClick={() => onOpenArtwork(artwork.id)}
              title="全屏影院级大图欣赏"
            >
              🔍 全屏影院
            </button>
            {onSetCover && (
              <button
                type="button"
                className={`art-action-cover-btn ${isCover ? "active" : ""}`}
                onClick={() => onSetCover(artwork.id)}
                disabled={isCover}
                title="将此画作设为当前相册封面"
              >
                {isCover ? "★ 当前封面" : "设为封面"}
              </button>
            )}
          </div>
        </div>

        {/* Polaroid Handwritten Caption Margin */}
        {mountStyle === "polaroid" && (
          <div className="polaroid-caption-bar">
            <span className="polaroid-caption-title">{artwork.source?.title ?? artwork.fileName}</span>
            <span className="polaroid-caption-meta">
              № {pageNumStr} · {artwork.source?.authorName ?? "典藏原画"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function AddWorksToAlbumDialog({
  collection,
  allArtworks,
  onClose,
  onAdd
}: {
  collection: CollectionRecord;
  allArtworks: ArtworkRecord[];
  onClose: () => void;
  onAdd: (selectedArtworkIds: string[]) => Promise<void> | void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);

  const filteredArtworks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allArtworks.filter((artwork) => {
      if (artwork.collectionIds.includes(collection.id)) return false; // already in this album
      if (!term) return true;
      const titleMatch = (artwork.source?.title ?? artwork.fileName).toLowerCase().includes(term);
      const artistMatch = (artwork.source?.authorName ?? "").toLowerCase().includes(term);
      return titleMatch || artistMatch;
    });
  }, [allArtworks, collection.id, search]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredArtworks.map((a) => a.id)));
  };

  const handleClearAll = () => {
    setSelectedIds(new Set());
  };

  const handleConfirm = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      await onAdd([...selectedIds]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogOverlay busy={submitting} onClose={onClose}>
      <div className="add-works-dialog" role="dialog" aria-label={`为相册《${collection.name}》挑选画作`}>
        <header className="dialog-header">
          <div>
            <h3>从画廊挑选画作加入相册</h3>
            <small>当前相册：《{collection.name}》</small>
          </div>
          <button type="button" className="dialog-close-button" onClick={onClose}>×</button>
        </header>

        <div className="dialog-toolbar-row">
          <input
            type="search"
            className="dialog-search-input"
            placeholder="搜索画作标题、作者…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="dialog-bulk-btns">
            <button type="button" onClick={handleSelectAll}>全选当前 ({filteredArtworks.length})</button>
            <button type="button" onClick={handleClearAll} disabled={selectedIds.size === 0}>清空</button>
          </div>
        </div>

        <div className="dialog-work-grid">
          {filteredArtworks.length === 0 ? (
            <div className="dialog-empty-hint">
              {search ? "没有找到符合搜索条件的未收录画作" : "画廊中的所有作品都已收录到本相册中了！"}
            </div>
          ) : (
            filteredArtworks.map((artwork) => {
              const isSelected = selectedIds.has(artwork.id);
              return (
                <div
                  key={artwork.id}
                  className={`dialog-work-card ${isSelected ? "selected" : ""}`}
                  onClick={() => toggleSelect(artwork.id)}
                >
                  <div className="dialog-work-thumb">
                    <img src={artworkImageUrl(artwork)} alt="" loading="lazy" />
                    <span className={`dialog-check-badge ${isSelected ? "checked" : ""}`}>
                      {isSelected ? "✓" : ""}
                    </span>
                  </div>
                  <strong className="dialog-work-title">{artwork.source?.title ?? artwork.fileName}</strong>
                  <small className="dialog-work-artist">{artwork.source?.authorName ?? "本地画师"}</small>
                </div>
              );
            })
          )}
        </div>

        <footer className="dialog-footer-actions">
          <span>已选择 <strong>{selectedIds.size}</strong> 部画作</span>
          <div className="dialog-actions-right">
            <Button onClick={onClose} disabled={submitting}>取消</Button>
            <Button
              variant="primary"
              disabled={selectedIds.size === 0 || submitting}
              busy={submitting}
              busyLabel="正在加入…"
              onClick={() => void handleConfirm()}
            >
              确认加入相册 ({selectedIds.size})
            </Button>
          </div>
        </footer>
      </div>
    </DialogOverlay>
  );
}

export function CollectionCard({
  collection,
  artworks,
  onOpen,
  onEdit,
  onFilter
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  onOpen: () => void;
  onEdit: () => void;
  onFilter?: () => void;
}) {
  const coverArtwork = artworks.find((artwork) => artwork.id === collection.coverArtworkId)
    ?? artworks.find((artwork) => artwork.collectionIds.includes(collection.id));
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const count = artworks.filter((artwork) => artwork.collectionIds.includes(collection.id)).length;

  return (
    <article className="collection-card album-card-book" onClick={onOpen}>
      <div className="collection-cover album-book-cover">
        <div className="album-card-spine" />
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="collection-cover-placeholder"><span>📖</span></div>
        )}
        <span className="album-card-tag">ALBUM</span>

        <div className="collection-card-actions-top" onClick={(e) => e.stopPropagation()}>
          {onFilter && (
            <button
              type="button"
              className="collection-filter-button"
              title="在画廊中筛选此相册"
              onClick={onFilter}
            >
              筛选
            </button>
          )}
          <button
            type="button"
            className="collection-edit-button"
            aria-label={`编辑相册 ${collection.name}`}
            onClick={onEdit}
            title="编辑相册"
          >
            ···
          </button>
        </div>
      </div>
      <div className="collection-info">
        <h3>{collection.name}</h3>
        <small>{count} 部画作</small>
        {collection.description && <p className="collection-desc">{collection.description}</p>}
      </div>
    </article>
  );
}

export function formatSavedViewSummary(
  view: SavedCollectionView,
  collections: CollectionRecord[]
): string {
  const includeNames = view.includedCollectionIds
    .map((id) => collections.find((c) => c.id === id)?.name)
    .filter(Boolean);
  const excludeNames = view.excludedCollectionIds
    .map((id) => collections.find((c) => c.id === id)?.name)
    .filter(Boolean);

  const modeText = view.matchMode === "all" ? "全部满足" : "任一满足";
  const parts: string[] = [];

  if (includeNames.length > 0) {
    parts.push(`包含 [${includeNames.join(", ")}] (${modeText})`);
  }
  if (excludeNames.length > 0) {
    parts.push(`排除 [${excludeNames.join(", ")}]`);
  }

  return parts.join(" 且 ") || "无条件筛选";
}

export function SavedCollectionViewCard({
  view,
  collections,
  artworks,
  onOpen,
  onEdit,
  onDelete
}: {
  view: SavedCollectionView;
  collections: CollectionRecord[];
  artworks: ArtworkRecord[];
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const matchingArtworks = artworks.filter((artwork) => {
    const included =
      view.includedCollectionIds.length === 0
        ? true
        : view.matchMode === "all"
          ? view.includedCollectionIds.every((id) => artwork.collectionIds.includes(id))
          : view.includedCollectionIds.some((id) => artwork.collectionIds.includes(id));
    const excluded = view.excludedCollectionIds.some((id) => artwork.collectionIds.includes(id));
    return included && !excluded;
  });

  const previewArtworks = matchingArtworks.slice(0, 4);

  return (
    <article className="collection-card saved-view-card" onClick={onOpen}>
      <div className="saved-view-cover-grid">
        <div className="saved-view-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="saved-view-btn-action"
            aria-label={`编辑相册组合 ${view.name}`}
            onClick={onEdit}
            title="编辑组合"
          >
            ✏️
          </button>
          {onDelete && (
            <button
              type="button"
              className="saved-view-btn-action btn-danger"
              aria-label={`删除相册组合 ${view.name}`}
              onClick={onDelete}
              title="删除组合"
            >
              🗑️
            </button>
          )}
        </div>
        {previewArtworks.length > 0 ? (
          previewArtworks.map((artwork, idx) => (
            <div key={artwork.id} className={`preview-quadrant quadrant-${idx}`}>
              <img src={artworkImageUrl(artwork)} alt="" loading="lazy" />
            </div>
          ))
        ) : (
          <div className="collection-cover-placeholder">
            <span>⊞</span>
          </div>
        )}
      </div>
      <div className="collection-info">
        <div className="saved-view-title-row">
          <h3>{view.name}</h3>
          <span className="saved-view-badge">组合视图</span>
        </div>
        <small>{matchingArtworks.length} 部画作</small>
        <p className="collection-desc">{formatSavedViewSummary(view, collections)}</p>
      </div>
    </article>
  );
}
