import { useMemo, useState } from "react";
import type { ArtworkRecord, CollectionRecord, SavedCollectionView } from "@sanctuary/domain";
import { ArtworkCard, artworkImageUrl } from "./ArtworkCard";
import { Button } from "./Button";
import { DialogOverlay } from "./DialogOverlay";
import { SegmentedControl } from "./SegmentedControl";

export function CollectionDetailPage({
  collection,
  artworks,
  collections,
  onBack,
  onAssign,
  onOpenArtwork,
  onSetCover,
  onFilterInGallery
}: {
  collection: CollectionRecord;
  artworks: ArtworkRecord[];
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
  onSetCover: (artworkId: string) => void;
  onFilterInGallery?: () => void;
}) {
  const items = artworks.filter((artwork) => artwork.collectionIds.includes(collection.id));
  const coverArtwork = artworks.find((a) => a.id === collection.coverArtworkId) ?? items[0];
  const coverUrl = coverArtwork ? artworkImageUrl(coverArtwork) : "";
  const [viewMode, setViewMode] = useState<"toc" | "grid">("grid");
  const [isPickingWorks, setIsPickingWorks] = useState(false);

  return (
    <section className="album-detail-page author-detail-page">
      <div className="album-nav-bar">
        <button className="author-back album-back-btn" onClick={onBack}>
          ← 返回相册库
        </button>
        {onFilterInGallery && (
          <Button variant="ghost" onClick={onFilterInGallery} title="在画廊中筛选此相册全部画作">
            在画廊中筛选查看
          </Button>
        )}
      </div>

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
            <Button variant="primary" onClick={() => setIsPickingWorks(true)}>
              + 从画廊添加作品
            </Button>
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
          <small>您可以点击下方按钮直接从画廊挑选图片收录入册：</small>
          <Button variant="primary" style={{ marginTop: 12 }} onClick={() => setIsPickingWorks(true)}>
            + 立即挑选画廊作品
          </Button>
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

      {/* Add Works from Library Modal Picker */}
      {isPickingWorks && (
        <AddWorksToAlbumDialog
          collection={collection}
          allArtworks={artworks}
          onClose={() => setIsPickingWorks(false)}
          onAdd={async (selectedArtworkIds) => {
            for (const id of selectedArtworkIds) {
              onAssign(id, collection.id);
            }
            setIsPickingWorks(false);
          }}
        />
      )}
    </section>
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
        >
          ···
        </button>
      </div>
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
      <div className="collection-card-actions-top" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="collection-edit-button"
          aria-label={`编辑相册组合 ${view.name}`}
          onClick={onEdit}
        >
          编辑
        </button>
        {onDelete && (
          <button
            type="button"
            className="collection-delete-button"
            aria-label={`删除相册组合 ${view.name}`}
            onClick={onDelete}
          >
            删除
          </button>
        )}
      </div>
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
