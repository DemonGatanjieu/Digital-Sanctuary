import { useEffect, useMemo, useState } from "react";
import type { CollectionRecord } from "@sanctuary/domain";
import { ArtworkCard, LazyArtworkImage, artworkImageUrl } from "./ArtworkCard";
import { PhotobookFlipSpread, type PhotobookAlbumInfo } from "./CollectionGallery";
import { SegmentedControl } from "./SegmentedControl";
import type { AuthorGalleryGroup } from "./gallery-model";

function AuthorAvatar({ author, large = false }: { author: AuthorGalleryGroup; large?: boolean }) {
  const localPath = author.artistRecord?.avatarLocalPath ?? "";
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

export function AuthorBrowserCard({ author, onOpen }: { author: AuthorGalleryGroup; onOpen: () => void }) {
  const covers = author.works.flatMap((work) => work.pages).slice(0, 3);
  return (
    <button className="author-browser-card" onClick={onOpen} title={`进入画师 ${author.name} 的专属工坊展厅`}>
      <span className={`author-cover-grid covers-${Math.min(3, covers.length)}`}>
        {covers.map((artwork) => {
          const action = artwork.decision?.action ?? "blur";
          return action === "hide" ? (
            <span className="author-cover-shield" key={artwork.id}>◇</span>
          ) : (
            <LazyArtworkImage
              key={artwork.id}
              src={artworkImageUrl(artwork)}
              className={action === "blur" ? "blurred" : ""}
            />
          );
        })}
      </span>
      <span className="author-card-body">
        <AuthorAvatar author={author} />
        <span className="author-card-copy">
          <strong>{author.name}</strong>
          <small>{author.works.length} 个作品 · {author.pageCount} 页画稿</small>
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
  onOpenArtwork
}: {
  author: AuthorGalleryGroup;
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
}) {
  const [viewMode, setViewMode] = useState<"works" | "artbook" | "catalog">("works");
  const [isPhotobookTocOpen, setIsPhotobookTocOpen] = useState(false);

  // Flatten all artworks for this author
  const allArtworks = useMemo(() => author.works.flatMap((work) => work.pages), [author.works]);
  const primaryArtwork = allArtworks[0];
  const backdropUrl = primaryArtwork ? artworkImageUrl(primaryArtwork) : "";

  // Keyboard navigation for ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
  }, [isPhotobookTocOpen, onBack]);

  const authorAlbumInfo: PhotobookAlbumInfo = useMemo(() => ({
    id: author.id,
    name: `《${author.name} 专属典藏画集》`,
    description: `收录画师 ${author.name} 的 ${author.works.length} 个作品与 ${allArtworks.length} 页精选图稿。`,
    coverArtworkId: primaryArtwork?.id ?? null
  }), [author, allArtworks, primaryArtwork]);

  return (
    <section className="author-detail-page" role="region" aria-label={`画师 ${author.name} 的专属工坊`}>
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
            <SegmentedControl
              compact
              label="浏览视角"
              value={viewMode}
              options={[
                { value: "works", label: "🗂️ 套图展区", title: "按作品与多页套图分组浏览" },
                { value: "artbook", label: "📖 翻页画集", title: "实体画册双页对开翻页质感" },
                { value: "catalog", label: "📑 篇目编目", title: "全量画作索引目录表格" }
              ]}
              onChange={(nextMode) => setViewMode(nextMode as "works" | "artbook" | "catalog")}
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
                <strong>{author.works.length}</strong>
                <span className="pill-label">部作品</span>
              </span>
              <span className="author-stat-pill">
                <span className="pill-icon">📄</span>
                <strong>{author.pageCount}</strong>
                <span className="pill-label">页图稿</span>
              </span>
              {author.id && (
                <a
                  href={`https://www.pixiv.net/users/${author.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="author-pixiv-pill"
                  title="在 Pixiv 查看原画师主页"
                >
                  <span className="pixiv-dot">●</span>
                  <code>pixiv/{author.id}</code>
                  <span className="pixiv-arrow">↗</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Areas based on View Mode */}
      <main className="author-stage-canvas">
        {viewMode === "artbook" ? (
          /* View Mode 2: Photobook Double-Spread Real Flip Experience */
          <div className="author-photobook-container">
            <PhotobookFlipSpread
              collection={authorAlbumInfo}
              items={allArtworks}
              onOpenArtwork={onOpenArtwork}
              isTocOpen={isPhotobookTocOpen}
              onTocOpenChange={setIsPhotobookTocOpen}
              interactionSuspended={false}
            />
          </div>
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
                    <ArtworkCard
                      key={artwork.id}
                      artwork={artwork}
                      collections={collections}
                      onAssign={onAssign}
                      onOpen={onOpenArtwork}
                    />
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
