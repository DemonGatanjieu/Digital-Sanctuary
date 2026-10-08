import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ArtworkRecord, CollectionRecord, CollectionSummary, SavedCollectionView, SavedViewSummary } from "@sanctuary/domain";
import { AquariumFloatingStage } from "./AquariumFloatingStage";
import { ArtworkCard, artworkImageUrl } from "./ArtworkCard";
import { Button } from "./Button";
import { PagedArtworkPicker } from "./PagedArtworkPicker";
import {
  getPhotobookArtworkIndex,
  getPhotobookSpreadForArtworkIndex,
  getPhotobookTotalSpreads,
  normalizePhotoMountStyle,
  photobookNeighborIndices,
  resolvePhotobookKeyboardAction,
  type PhotoMountStyle
} from "./photobook-navigation";
import { BrowseModeMenu } from "./BrowseModeMenu";
import { photobookAnchor, resolvePhotobookSpread, type CollectionDetailSession, type CollectionDetailViewMode, type GalleryDetailSessionPatch, type PageAnchor, type ScrollPosition } from "./gallery-detail-session";
import { detailPageAttributes } from "./detail-scroll";
import { useDetailScroll } from "./useDetailScroll";

type CollectionSessionPatch = GalleryDetailSessionPatch<{ kind: "collection"; collectionId: string }>;

export function CollectionDetailPage({
  collection,
  artworks,
  collections,
  onBack,
  onAssign,
  onAddArtworks,
  onOpenArtwork,
  onSetCover,
  onFilterInGallery,
  session = null,
  onSessionChange,
  onRegisterCapture,
  lightboxOpen = false
}: {
  collection: CollectionSummary;
  artworks: ArtworkRecord[];
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => Promise<void> | void;
  onAddArtworks: (artworkIds: string[]) => Promise<void>;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover: (artworkId: string) => void;
  onFilterInGallery?: () => void;
  lightboxOpen?: boolean;
  session?: CollectionDetailSession | null;
  onSessionChange?: (patch: CollectionSessionPatch) => void;
  onRegisterCapture?: (capture: () => CollectionSessionPatch) => () => void;
}) {
  const items = artworks;
  const coverArtwork = artworks.find((a) => a.id === collection.coverArtworkId) ?? items[0];
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const [fallbackMode, setFallbackMode] = useState<CollectionDetailViewMode>("flip");
  const viewMode = session?.viewMode ?? fallbackMode;
  const [isPickingWorks, setIsPickingWorks] = useState(false);
  const [isPhotobookTocOpen, setIsPhotobookTocOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const bookCapture = useRef<(() => GalleryDetailSessionPatch) | null>(null);
  const bookAnchorRef = useRef(session?.bookAnchor ?? null);
  const tocPositionRef = useRef(session?.tocPosition ?? null);
  const previousSession = useRef(session);
  if (session !== previousSession.current) {
    previousSession.current = session;
    if (session) { bookAnchorRef.current = session.bookAnchor; tocPositionRef.current = session.tocPosition; }
  }
  const scrollItems = useMemo(() => viewMode === "flip" ? [] : items, [viewMode, items]);
  const captureScroll = useDetailScroll({ channel: `${collection.id}:${viewMode}`, containerRef: viewMode === "flip" ? stageRef : listRef, items: scrollItems,
    position: session?.scrollPositions[viewMode] ?? null, enabled: viewMode === "flip" || viewMode === "grid" || viewMode === "toc",
    onChange: (position) => onSessionChange?.({ scrollPositions: { [viewMode]: position } }) });
  const capture = useCallback((): CollectionSessionPatch => {
    const position = captureScroll();
    return { viewMode, bookAnchor: bookAnchorRef.current, tocPosition: tocPositionRef.current,
      ...(bookCapture.current?.() ?? {}), ...(position ? { scrollPositions: { [viewMode]: position } } : {}) } as CollectionSessionPatch;
  }, [viewMode, captureScroll]);
  useLayoutEffect(() => onRegisterCapture?.(capture), [onRegisterCapture, capture]);
  const changeViewMode = (next: CollectionDetailViewMode) => {
    const patch = capture(); setFallbackMode(next); onSessionChange?.({ ...patch, viewMode: next });
  };
  const changeTocOpen = (open: boolean) => {
    if (!open) {
      const patch = bookCapture.current?.();
      if (patch?.tocPosition) { tocPositionRef.current = patch.tocPosition; onSessionChange?.({ tocPosition: patch.tocPosition }); }
    }
    setIsPhotobookTocOpen(open);
  };

  // Global ESC key listener to exit full-screen game artbook
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229 || isPickingWorks || lightboxOpen || document.querySelector(".dialog-overlay")) return;
      if (isPhotobookTocOpen) {
        e.preventDefault();
        changeTocOpen(false);
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
    <section className="album-fullscreen-theater" data-detail-mode={viewMode} role="dialog" aria-modal="true" aria-label={`相册《${collection.name}》`}>
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
          <BrowseModeMenu
            compact
            label="画册模式"
            value={viewMode}
            options={[
              { value: "flip", label: "📖 翻页画册", title: "实体画册双页对开翻页质感" },
              { value: "aquarium", label: "🫧 水族漂浮", title: "深海沉浸漂浮水泡，大小错落，流动触感" },
              { value: "grid", label: "🖼️ 典藏网格", title: "全景网格速览" },
              { value: "toc", label: "📑 篇目目录", title: "书籍篇目索引" }
            ]}
            onChange={(val) => changeViewMode(val as CollectionDetailViewMode)}
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
      <main className="theater-stage-canvas" ref={stageRef}>
        {items.length === 0 ? (
          <div className="theater-empty-state">
            <div className="theater-empty-book-icon">📖</div>
            <h2>{collection.workCount > 0 ? "本相册的作品可在图库中浏览" : `《${collection.name}》尚未收录画作`}</h2>
            <p>{collection.workCount > 0 ? "当前没有可编入画册的页面，原图仍保留在图库中。" : collection.description || "暂无题记。您可以直接从画廊中挑选精美作品收录至本相册。"}</p>
            {onFilterInGallery && <Button onClick={onFilterInGallery}>在图库中查看作品 ({collection.workCount})</Button>}
            <Button variant="primary" style={{ marginTop: 16 }} onClick={() => setIsPickingWorks(true)}>
              + 立即从画廊挑选作品入册
            </Button>
          </div>
        ) : viewMode === "aquarium" ? (
          /* Abyssal Aquarium Floating Bubble Stage */
          <AquariumFloatingStage
            items={items}
            onOpenArtwork={onOpenArtwork}
            onSetCover={onSetCover}
            coverArtworkId={collection.coverArtworkId}
            title={collection.name}
          />
        ) : viewMode === "flip" ? (
          /* 3D Real Photobook Double-Spread Flip Theater */
          <PhotobookFlipSpread
            collection={collection}
            items={items}
            onOpenArtwork={onOpenArtwork}
            onSetCover={onSetCover}
            onOpenPicker={() => setIsPickingWorks(true)}
            isTocOpen={isPhotobookTocOpen}
            onTocOpenChange={changeTocOpen}
            interactionSuspended={isPickingWorks || lightboxOpen}
            pageAnchor={bookAnchorRef.current}
            onPageAnchorChange={(anchor) => { bookAnchorRef.current = anchor; onSessionChange?.({ bookAnchor: anchor }); }}
            tocPosition={tocPositionRef.current}
            onTocPositionChange={(position) => { tocPositionRef.current = position; onSessionChange?.({ tocPosition: position }); }}
            onRegisterCapture={(reader) => { bookCapture.current = reader; return () => { if (bookCapture.current === reader) bookCapture.current = null; }; }}
          />
        ) : viewMode === "toc" ? (
          /* Table of Contents Mode (画册目录索引模式) */
          <div className="theater-toc-scroll-box" ref={listRef}>
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
                      {...detailPageAttributes(artwork)}
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
          <div className="theater-grid-scroll-box" ref={listRef}>
            <div className="gallery-grid collection-detail-grid">
              {items.map((artwork) => (
                <div className="collection-artwork" key={artwork.id} {...detailPageAttributes(artwork)}>
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
        <PagedArtworkPicker
          collection={collection}
          onClose={() => setIsPickingWorks(false)}
          onAdd={async (selectedArtworkIds) => {
            await onAddArtworks(selectedArtworkIds);
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
  interactionSuspended = false,
  pageAnchor = null,
  onPageAnchorChange,
  tocPosition = null,
  onTocPositionChange,
  onRegisterCapture
}: {
  collection: PhotobookAlbumInfo | CollectionRecord;
  items: ArtworkRecord[];
  onOpenArtwork: (artworkId: string) => void;
  onSetCover?: ((artworkId: string) => void) | undefined;
  onOpenPicker?: (() => void) | undefined;
  isTocOpen: boolean;
  onTocOpenChange: (open: boolean) => void;
  interactionSuspended?: boolean | undefined;
  pageAnchor?: PageAnchor | null;
  onPageAnchorChange?: (anchor: PageAnchor) => void;
  tocPosition?: ScrollPosition | null;
  onTocPositionChange?: (position: ScrollPosition) => void;
  onRegisterCapture?: (capture: () => GalleryDetailSessionPatch) => () => void;
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
  const itemKey = useMemo(() => items.map((item) => {
    const attributes = detailPageAttributes(item);
    return `${attributes["data-gallery-page-kind"]}:${attributes["data-gallery-page-id"]}`;
  }).join("\u001f"), [items]);
  const previousItemKey = useRef(itemKey);

  // Unified Atomic Spread State Machine (Guarantees zero-desync between current spread and transition)
  const [spreadState, setSpreadState] = useState<{
    currentSpread: number;
    isAnimating: boolean;
    direction: "forward" | "backward";
    fromSpread: number;
    toSpread: number;
  }>(() => {
    const spread = resolvePhotobookSpread(items, pageAnchor);
    return { currentSpread: spread,
    isAnimating: false,
    direction: "forward",
    fromSpread: spread,
    toSpread: spread };
  });

  const fallbackTimerRef = useRef<number | null>(null);
  const settledAnchorRef = useRef(photobookAnchor(items, spreadState.currentSpread));
  const tocPositionRef = useRef(tocPosition);
  const tocCaptureRef = useRef<(() => ScrollPosition | null) | null>(null);
  useLayoutEffect(() => onRegisterCapture?.(() => {
    const position = tocCaptureRef.current?.();
    if (position) tocPositionRef.current = position;
    return { bookAnchor: settledAnchorRef.current, tocPosition: tocPositionRef.current };
  }), [onRegisterCapture]);

  useEffect(() => () => {
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
  }, []);

  const preloadedPages = useRef(new Map<string, HTMLImageElement>());
  // Keep the neighboring spreads ready without decoding a whole album of originals.
  useEffect(() => {
    const efficient = document.querySelector<HTMLElement>(".app-shell")?.dataset.displayProfile === "efficient";
    const center = spreadState.isAnimating ? spreadState.toSpread : spreadState.currentSpread;
    const urls = efficient ? [] : photobookNeighborIndices(center, items.length).map((index) => artworkImageUrl(items[index]!));
    for (const [url, image] of preloadedPages.current) {
      if (!urls.includes(url)) { image.removeAttribute("src"); preloadedPages.current.delete(url); }
    }
    for (const url of urls) {
      if (preloadedPages.current.has(url)) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      preloadedPages.current.set(url, img);
    }
  }, [items, spreadState.currentSpread, spreadState.isAnimating, spreadState.toSpread]);
  useEffect(() => () => {
    for (const image of preloadedPages.current.values()) image.removeAttribute("src");
    preloadedPages.current.clear();
  }, []);

  useLayoutEffect(() => {
    const changed = previousItemKey.current !== itemKey;
    previousItemKey.current = itemKey;
    const safeSpread = resolvePhotobookSpread(items, pageAnchor ?? settledAnchorRef.current);
    if (!changed && safeSpread === spreadState.currentSpread) return;
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
    const anchor = photobookAnchor(items, safeSpread);
    settledAnchorRef.current = anchor;
    onPageAnchorChange?.(anchor);
    // Data changes invalidate transition indices; a cloned snapshot alone never restarts an animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, pageAnchor]);


  const finishFlip = (targetSpread: number) => {
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const settledSpread = Math.min(targetSpread, Math.max(0, totalSpreads - 1));
    settledAnchorRef.current = photobookAnchor(items, settledSpread);
    onPageAnchorChange?.(settledAnchorRef.current);
    setSpreadState((prev) => ({
      currentSpread: settledSpread,
      isAnimating: false,
      direction: prev.direction,
      fromSpread: settledSpread,
      toSpread: settledSpread
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
    <div className="photobook-stage-deck" data-settled-spread={spreadState.currentSpread}
      data-settled-page-id={settledAnchorRef.current.current?.assetId ?? settledAnchorRef.current.current?.legacyArtworkId ?? ""}
      data-settled-page-kind={settledAnchorRef.current.current?.assetId ? "asset" : "artwork"}>
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

        <details className="photobook-display-options" onKeyDown={(event) => {
          if (event.key === "Escape" && event.currentTarget.open && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault(); event.stopPropagation();
            event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
        <summary>展示选项</summary>
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
        </details>
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
              <div className={`photobook-slide-overlay slide-${spreadState.direction}`}>
                <div
                  className="photobook-slide-track"
                  onAnimationEnd={(e) => {
                    if (e.target === e.currentTarget) {
                      finishFlip(spreadState.toSpread);
                    }
                  }}
                >
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
              <div className="photobook-fade-overlay">
                <div
                  className="fade-deck-spread"
                  onAnimationEnd={(e) => {
                    if (e.target === e.currentTarget) {
                      finishFlip(spreadState.toSpread);
                    }
                  }}
                >
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
              <div className={`photobook-deck-stack-overlay deck-${spreadState.direction}`}>
                <div
                  className="deck-stack-outgoing-spread"
                  onAnimationEnd={(e) => {
                    if (e.target === e.currentTarget) {
                      finishFlip(spreadState.toSpread);
                    }
                  }}
                >
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
        scrollPosition={tocPositionRef.current}
        onScrollPositionChange={(position) => { tocPositionRef.current = position; onTocPositionChange?.(position); }}
        onRegisterCapture={(capture) => { tocCaptureRef.current = capture; return () => { if (tocCaptureRef.current === capture) tocCaptureRef.current = null; }; }}
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
  onSelectArtwork,
  scrollPosition,
  onScrollPositionChange,
  onRegisterCapture
}: {
  isOpen: boolean;
  collection: PhotobookAlbumInfo | CollectionRecord;
  items: ArtworkRecord[];
  currentSpreadIndex: number;
  onClose: () => void;
  onSelectArtwork: (artworkIndex: number) => void;
  scrollPosition: ScrollPosition | null;
  onScrollPositionChange: (position: ScrollPosition) => void;
  onRegisterCapture: (capture: () => ScrollPosition | null) => () => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const filteredItems = useMemo(() => items.filter((it) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (it.source?.title?.toLowerCase().includes(q) ?? false) ||
      (it.source?.authorName?.toLowerCase().includes(q) ?? false) ||
      it.fileName.toLowerCase().includes(q)
    );
  }), [items, searchTerm]);
  const capture = useDetailScroll({ channel: `toc:${collection.id}:${searchTerm}`, containerRef: scrollRef,
    items: filteredItems, position: searchTerm.trim() ? null : scrollPosition, enabled: isOpen, onChange: onScrollPositionChange });
  useLayoutEffect(() => onRegisterCapture(capture), [onRegisterCapture, capture]);

  if (!isOpen) return null;

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
            onChange={(e) => {
              const position = capture();
              if (position) onScrollPositionChange(position);
              setSearchTerm(e.target.value);
            }}
            autoFocus
          />
          {searchTerm && (
            <button type="button" className="search-clear-btn" onClick={() => setSearchTerm("")}>
              ✕
            </button>
          )}
        </div>

        {/* Items List */}
        <div className="toc-drawer-items-scroll" ref={scrollRef}>
          {filteredItems.map((item) => {
            const originalIndex = items.indexOf(item);
            const itemSpread = originalIndex === 0 ? 0 : 1 + Math.floor((originalIndex - 1) / 2);
            const isCurrentlyActive = itemSpread === currentSpreadIndex;
            const idxStr = String(originalIndex + 1).padStart(2, "0");
            const sideLabel = originalIndex === 0 ? "右页 (封面)" : (originalIndex - 1) % 2 === 0 ? "左页" : "右页";

            return (
              <div
                key={item.id}
                {...detailPageAttributes(item)}
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

export function CollectionCard({
  collection,
  onOpen,
  onEdit,
  onFilter
}: {
  collection: CollectionSummary;
  onOpen: () => void;
  onEdit: () => void;
  onFilter?: () => void;
}) {
  const coverUrl = collection.coverAsset ? `sanctuary-image://local/${encodeURIComponent(collection.coverAsset.thumbnailPath ?? collection.coverAsset.path)}` : "";

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
        <small>{collection.workCount} 个作品 · {collection.bookPageCount} 页画作</small>
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
  onOpen,
  onEdit,
  onDelete
}: {
  view: SavedViewSummary;
  collections: CollectionRecord[];
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const previewArtworks = view.previewAssets;

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
              <img src={`sanctuary-image://local/${encodeURIComponent(artwork.thumbnailPath ?? artwork.path)}`} alt="" loading="lazy" />
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
        <small>{view.workCount} 个作品 · {view.pageCount} 页</small>
        <p className="collection-desc">{formatSavedViewSummary(view, collections)}</p>
        {(view.missingIncludedIds.length > 0 || view.missingExcludedIds.length > 0) && <small>部分相册已删除，按现有条件展示</small>}
      </div>
    </article>
  );
}
