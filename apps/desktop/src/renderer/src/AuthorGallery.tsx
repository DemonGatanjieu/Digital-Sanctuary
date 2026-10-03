import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ArtistRecord, ArtistSummary, CollectionRecord } from "@sanctuary/domain";
import { AquariumFloatingStage } from "./AquariumFloatingStage";
import { ArtworkCard, LazyArtworkImage, artworkImageUrl } from "./ArtworkCard";
import { PhotobookFlipSpread, type PhotobookAlbumInfo } from "./CollectionGallery";
import { BrowseModeMenu } from "./BrowseModeMenu";
import type { AuthorGalleryGroup } from "./gallery-model";
import type { ArtistDetailSession, ArtistDetailViewMode, GalleryDetailSessionPatch } from "./gallery-detail-session";
import { detailPageAttributes } from "./detail-scroll";
import { useDetailScroll } from "./useDetailScroll";

type ArtistSessionPatch = GalleryDetailSessionPatch<{ kind: "artist"; artistId: string | null }>;

function AuthorAvatar({ author, large = false }: { author: { name: string; artistRecord?: ArtistRecord; artist?: ArtistRecord | null }; large?: boolean }) {
  const localPath = (author.artistRecord ?? author.artist)?.avatarLocalPath ?? "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [localPath]);
  const className = `author-monogram${large ? " large" : ""}`;
  if (localPath && !failed) {
    return (
      <img
        className={`${className} avatar`}
        src={`sanctuary-image://local/${encodeURIComponent(localPath)}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className={className}>{author.name.slice(0, 1).toUpperCase()}</span>;
}

export function AuthorBrowserCard({ author, onOpen }: { author: ArtistSummary; onOpen: () => void }) {
  const covers = author.previewAssets;
  return (
    <button className="author-browser-card" onClick={onOpen} title={`进入画师 ${author.name} 的专属工坊展厅`}>
      <span className={`author-cover-grid covers-${Math.min(3, covers.length)}`}>
        {covers.map((artwork) => {
          return (
            <LazyArtworkImage
              key={artwork.id}
              src={`sanctuary-image://local/${encodeURIComponent(artwork.thumbnailPath ?? artwork.path)}`}
            />
          );
        })}
      </span>
      <span className="author-card-body">
        <AuthorAvatar author={author} />
        <span className="author-card-copy">
          <strong>{author.name}</strong>
          <small>{author.workCount} 个作品 · {author.pageCount} 页画稿</small>
        </span>
        <span className="author-card-arrow">→</span>
      </span>
    </button>
  );
}

export function AuthorDetailPage({
  author,
  collections,
  onBack,
  onAssign,
  onOpenArtwork,
  onOpenPixivArtist,
  onViewWorks,
  session = null,
  onSessionChange,
  onRegisterCapture,
  mainScrollRef,
  lightboxOpen = false
}: {
  author: AuthorGalleryGroup;
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
  onOpenPixivArtist: (artistId: string) => void;
  onViewWorks: () => void;
  lightboxOpen?: boolean | undefined;
  session?: ArtistDetailSession | null;
  onSessionChange?: (patch: ArtistSessionPatch) => void;
  onRegisterCapture?: (capture: () => ArtistSessionPatch) => () => void;
  mainScrollRef?: RefObject<HTMLElement | null>;
}) {
  const [fallbackMode, setFallbackMode] = useState<ArtistDetailViewMode>("works");
  const viewMode = session?.viewMode ?? fallbackMode;
  const [isPhotobookTocOpen, setIsPhotobookTocOpen] = useState(false);

  // Flatten all artworks for this author
  const allArtworks = useMemo(() => author.works.flatMap((work) => work.pages), [author.works]);
  const primaryArtwork = allArtworks[0];
  const backdropUrl = primaryArtwork ? artworkImageUrl(primaryArtwork) : "";
  const stageRef = useRef<HTMLElement>(null);
  const fallbackScrollRef = useRef<HTMLElement>(null);
  const bookCapture = useRef<(() => GalleryDetailSessionPatch) | null>(null);
  const bookAnchorRef = useRef(session?.bookAnchor ?? null);
  const tocPositionRef = useRef(session?.tocPosition ?? null);
  const previousSession = useRef(session);
  if (session !== previousSession.current) {
    previousSession.current = session;
    if (session) { bookAnchorRef.current = session.bookAnchor; tocPositionRef.current = session.tocPosition; }
  }
  const anchoredItems = useMemo(() => viewMode === "works" || viewMode === "catalog" ? allArtworks : [], [viewMode, allArtworks]);
  const captureScroll = useDetailScroll({ channel: `${author.key}:${viewMode}`, containerRef: mainScrollRef ?? fallbackScrollRef,
    contentRef: stageRef, items: anchoredItems, position: session?.scrollPositions[viewMode] ?? null,
    onChange: (position) => onSessionChange?.({ scrollPositions: { [viewMode]: position } }) });
  const capture = useCallback((): ArtistSessionPatch => {
    const position = captureScroll();
    return { viewMode, bookAnchor: bookAnchorRef.current, tocPosition: tocPositionRef.current,
      ...(bookCapture.current?.() ?? {}), ...(position ? { scrollPositions: { [viewMode]: position } } : {}) } as ArtistSessionPatch;
  }, [viewMode, captureScroll]);
  useLayoutEffect(() => onRegisterCapture?.(capture), [onRegisterCapture, capture]);
  const changeViewMode = (next: ArtistDetailViewMode) => {
    const patch = capture(); setFallbackMode(next); onSessionChange?.({ ...patch, viewMode: next });
  };
  const changeTocOpen = (open: boolean) => {
    if (!open) {
      const patch = bookCapture.current?.();
      if (patch?.tocPosition) { tocPositionRef.current = patch.tocPosition; onSessionChange?.({ tocPosition: patch.tocPosition }); }
    }
    setIsPhotobookTocOpen(open);
  };
  useEffect(() => { if (viewMode !== "artbook") setIsPhotobookTocOpen(false); }, [viewMode]);

  // Keyboard navigation for ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229 || lightboxOpen || document.querySelector(".dialog-overlay")) return;
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
  }, [isPhotobookTocOpen, lightboxOpen, onBack]);

  const authorAlbumInfo: PhotobookAlbumInfo = useMemo(() => ({
    id: author.id,
    name: `《${author.name} 专属典藏画集》`,
    description: `收录画师 ${author.name} 的 ${author.workCount ?? author.works.length} 个作品与 ${allArtworks.length} 页精选图稿。`,
    coverArtworkId: primaryArtwork?.id ?? null
  }), [author, allArtworks, primaryArtwork]);

  return (
    <section className="author-detail-page" data-detail-mode={viewMode} role="region" aria-label={`画师 ${author.name} 的专属工坊`}>
      {/* Ambient Blurred Artwork Backdrop */}
      {backdropUrl && (
        <div
          className="author-ambient-backdrop"
          style={{ backgroundImage: `url(${backdropUrl})` }}
        />
      )}
      <div className="author-ambient-overlay" />

      {/* Top Header & Artist Atelier Island */}
      <header className="author-detail-hero">
        <div className="author-hero-top-row">
          <button className="author-back-btn" onClick={onBack} title="返回全部画师 (ESC)">
            <span className="author-back-key">ESC</span>
            <span>← 全部画师</span>
          </button>

          <div className="author-view-switcher">
            <BrowseModeMenu
              compact
              label="浏览视角"
              value={viewMode}
              options={[
                { value: "works", label: "🗂️ 套图展区", title: "按作品与多页套图分组浏览" },
                { value: "artbook", label: "📖 翻页画集", title: "实体画册双页对开翻页质感" },
                { value: "aquarium", label: "🫧 水族漂浮", title: "深海沉浸漂浮水泡，大小错落，流动触感" },
                { value: "catalog", label: "📑 篇目编目", title: "全量画作索引目录表格" }
              ]}
              onChange={(nextMode) => changeViewMode(nextMode as ArtistDetailViewMode)}
            />
          </div>
        </div>

        <div className="author-hero-profile-row">
          <div className="author-avatar-badge-wrap">
            <AuthorAvatar author={author} large />
          </div>

          <div className="author-hero-details">
            <p className="author-atelier-eyebrow">CREATOR MONOGRAPH · 画师工坊</p>
            <h1 className="author-atelier-name">{author.name}</h1>
            <div className="author-stats-ribbon">
              <span className="author-stat-pill">
                <span className="pill-icon">🎨</span>
                <strong>{author.workCount ?? author.works.length}</strong>
                <span className="pill-label">部作品</span>
              </span>
              <span className="author-stat-pill">
                <span className="pill-icon">📄</span>
                <strong>{author.pageCount}</strong>
                <span className="pill-label">页图稿</span>
              </span>
              {/^[0-9]+$/.test(author.id) && (
                <button
                  type="button"
                  className="author-pixiv-pill"
                  title="在纯净领域的探索页打开这个画师"
                  onClick={() => onOpenPixivArtist(author.id)}
                >
                  <span className="pixiv-dot">●</span>
                  <code>pixiv/{author.id}</code>
                  <span className="pixiv-arrow">↗</span>
                </button>
              )}
              <button type="button" className="author-pixiv-pill" onClick={onViewWorks}>在图库中查看作品 →</button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Areas based on View Mode */}
      <main className="author-stage-canvas" ref={stageRef}>
        {allArtworks.length === 0 ? (
          <section className="empty-state compact-empty">
            <h2>{author.workCount === 0 ? "这位画师还没有本地作品" : "这些作品可在图库中浏览"}</h2>
            <p>{author.workCount === 0 ? "保存作品后，会出现在这位画师的目录中。" : "当前没有可编入画册的页面，作品和原图仍然保留。"}</p>
            <button type="button" className="author-back-btn" onClick={onViewWorks}>查看作品 →</button>
          </section>
        ) : viewMode === "artbook" ? (
          /* View Mode 2: Photobook Double-Spread Real Flip Experience */
          <div className="author-photobook-container">
            <PhotobookFlipSpread
              collection={authorAlbumInfo}
              items={allArtworks}
              onOpenArtwork={onOpenArtwork}
              isTocOpen={isPhotobookTocOpen}
              onTocOpenChange={changeTocOpen}
              interactionSuspended={lightboxOpen}
              pageAnchor={bookAnchorRef.current}
              onPageAnchorChange={(anchor) => { bookAnchorRef.current = anchor; onSessionChange?.({ bookAnchor: anchor }); }}
              tocPosition={tocPositionRef.current}
              onTocPositionChange={(position) => { tocPositionRef.current = position; onSessionChange?.({ tocPosition: position }); }}
              onRegisterCapture={(reader) => { bookCapture.current = reader; return () => { if (bookCapture.current === reader) bookCapture.current = null; }; }}
            />
          </div>
        ) : viewMode === "aquarium" ? (
          /* View Mode 4: Abyssal Aquarium Floating Bubble Experience */
          <AquariumFloatingStage
            items={allArtworks}
            onOpenArtwork={onOpenArtwork}
            coverArtworkId={primaryArtwork?.id}
            title={`${author.name} 的专属水族馆`}
          />
        ) : viewMode === "catalog" ? (
          /* View Mode 3: Chronological / Structured Catalog Table */
          <div className="author-catalog-container">
            <div className="author-catalog-header">
              <span>INDEX / 编号</span>
              <span>WORK & TITLE / 篇目与作品名</span>
              <span>PAGE / 页码</span>
              <span>PREVIEW / 预览</span>
              <span>ACTION / 操作</span>
            </div>
            <div className="author-catalog-list">
              {allArtworks.map((artwork, idx) => {
                const numStr = String(idx + 1).padStart(2, "0");
                const workId = artwork.source?.workId;
                const pageIndex = artwork.source?.pageIndex;
                return (
                  <div
                    key={artwork.id}
                    {...detailPageAttributes(artwork)}
                    className="author-catalog-row"
                    onClick={() => onOpenArtwork(artwork.id)}
                  >
                    <div className="catalog-index-cell">
                      <span className="catalog-number">№ {numStr}</span>
                    </div>

                    <div className="catalog-title-cell">
                      <strong className="catalog-title">
                        {artwork.source?.title ?? artwork.fileName}
                      </strong>
                      <small className="catalog-subtitle">
                        {workId ? `Work #${workId}` : "本地导入作品"} · {author.name}
                      </small>
                    </div>

                    <div className="catalog-page-cell">
                      <span className="catalog-page-tag">
                        {pageIndex !== undefined ? `P. ${pageIndex + 1}` : "单页"}
                      </span>
                    </div>

                    <div className="catalog-thumb-cell">
                      <LazyArtworkImage
                        src={artworkImageUrl(artwork)}
                        className="catalog-thumb-img"
                      />
                    </div>

                    <div className="catalog-action-cell" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="catalog-view-btn"
                        onClick={() => onOpenArtwork(artwork.id)}
                      >
                        🔍 全屏影院
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* View Mode 1: Works & Series Stacks (Default) */
          <div className="author-works">
            {author.works.map((work) => (
              <section className="work-group" key={work.key}>
                <header className="work-header">
                  <div className="work-header-info">
                    <span className="work-id-tag">WORK #{work.workId}</span>
                    <h2 className="work-title">{work.title}</h2>
                  </div>
                  <div className="work-header-actions">
                    {work.pages.length > 1 ? (
                      <span className="work-pages-badge multi">
                        📚 {work.pages.length} 页套图
                      </span>
                    ) : (
                      <span className="work-pages-badge single">单幅原画</span>
                    )}
                    {work.pages.length > 1 && (
                      <button
                        type="button"
                        className="work-read-all-btn"
                        onClick={() => {
                          const first = work.pages[0];
                          if (first) onOpenArtwork(first.id);
                        }}
                        title="在影院中连续欣赏本套图"
                      >
                        📖 连环影院
                      </button>
                    )}
                  </div>
                </header>
                <div className="work-page-grid">
                  {work.pages.map((artwork) => (
                    <div key={artwork.id} {...detailPageAttributes(artwork)}>
                    <ArtworkCard
                      artwork={artwork}
                      collections={collections}
                      onAssign={onAssign}
                      onOpen={onOpenArtwork}
                    />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </section>
  );
}
