import { useState } from "react";
import type { ArtworkRecord, CollectionRecord, SavedCollectionView } from "@sanctuary/domain";
import { ArtworkCard, artworkImageUrl } from "./ArtworkCard";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";

export function CollectionDetailPage({
  collection,
  artworks,
  collections,
  onBack,
  onAssign,
  onOpenArtwork,
  onSetCover
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover: (artworkId: string) => void;
}) {
  const items = artworks.filter((artwork) => artwork.collectionIds.includes(collection.id));
  const coverArtwork = artworks.find((a) => a.id === collection.coverArtworkId) ?? items[0];
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const [viewMode, setViewMode] = useState<"toc" | "grid">("grid");

  return (
    <section className="album-detail-page author-detail-page">
      <button className="author-back album-back-btn" onClick={onBack}>
        ← 返回相册库
      </button>

      {/* Artbook Hardcover Presentation & Epigraph Hero */}
      <header className="album-hardcover-hero">
        <div className="album-cover-column">
          <div className="album-book-spine" />
          <div className="album-cover-frame">
            {coverUrl ? (
              <img src={coverUrl} alt={collection.name} className="album-cover-img" />
            ) : (
              <div className="album-cover-empty">📖</div>
            )}
            <div className="album-cover-ribbon">ARTBOOK</div>
          </div>
        </div>

        <div className="album-meta-column">
          <p className="eyebrow">DIGITAL SANCTUARY · ARTBOOK ALBUM</p>
          <h1 className="album-title">{collection.name}</h1>
          <div className="album-stats-badge-row">
            <span className="album-stat-chip">收录 {items.length} 部作品</span>
            <span className="album-stat-chip">共 {items.reduce((acc, a) => acc + (a.source ? 1 : 1), 0)} 幅画作</span>
          </div>

          {/* Epigraph & Foreword (题记与卷首引言) */}
          {collection.description ? (
            <div className="album-epigraph-box">
              <span className="epigraph-mark-open">“</span>
              <p className="epigraph-text">{collection.description}</p>
              <span className="epigraph-mark-close">”</span>
            </div>
          ) : (
            <p className="album-no-desc">暂无卷首题记。可在相册编辑中添加您的专属引言与故事。</p>
          )}

          {/* View Mode Switcher (目录 vs 画册网格) */}
          <div className="album-view-switcher-row">
            <SegmentedControl
              compact
              label="相册浏览模式"
              value={viewMode}
              options={[
                { value: "grid", label: "🖼️ 画集网格", title: "瀑布流网格展示" },
                { value: "toc", label: "📑 目录索引", title: "书籍章节目录排版" }
              ]}
              onChange={(val) => setViewMode(val as "toc" | "grid")}
            />
          </div>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="collection-detail-empty album-empty-state">
          <span>📖</span>
          <p>这本相册尚未收录任何作品。</p>
          <small>您可以在画廊中选中作品并点击“加入相册”进行收录。</small>
        </div>
      ) : viewMode === "toc" ? (
        /* Table of Contents Mode (画册目录索引模式) */
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
                      {artwork.source?.pageCount && artwork.source.pageCount > 1 ? ` · [共 ${artwork.source.pageCount} 页]` : ""}
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
      ) : (
        /* Grid Mode (画册网格画廊模式) */
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
      )}
    </section>
  );
}

export function CollectionCard({
  collection,
  artworks,
  onOpen,
  onEdit
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  onOpen: () => void;
  onEdit: () => void;
}) {
  const coverArtwork = artworks.find((artwork) => artwork.id === collection.coverArtworkId)
    ?? artworks.find((artwork) => artwork.collectionIds.includes(collection.id));
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const count = artworks.filter((artwork) => artwork.collectionIds.includes(collection.id)).length;

  return (
    <article className="collection-card album-card-book" onClick={onOpen}>
      <button
        type="button"
        className="collection-edit-button"
        aria-label={`编辑相册 ${collection.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        ···
      </button>
      <div className="collection-cover album-book-cover">
        <div className="album-card-spine" />
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="collection-cover-placeholder"><span>📖</span></div>
        )}
        <span className="album-card-tag">ALBUM</span>
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
  onEdit
}: {
  view: SavedCollectionView;
  collections: CollectionRecord[];
  artworks: ArtworkRecord[];
  onOpen: () => void;
  onEdit: () => void;
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
      <button
        type="button"
        className="collection-edit-button"
        aria-label={`编辑相册组合 ${view.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        ···
      </button>
      <div className="saved-view-cover-grid">
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
