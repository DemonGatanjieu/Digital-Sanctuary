import type { ArtworkRecord, CollectionRecord, SavedCollectionView } from "@sanctuary/domain";
import { ArtworkCard, artworkImageUrl } from "./ArtworkCard";

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
  return (
    <section className="author-detail-page collection-detail-page">
      <button className="author-back" onClick={onBack}>← 全部分类</button>
      <header className="author-detail-hero">
        <span className="author-monogram large">◇</span>
        <div>
          <p className="eyebrow">LOCAL COLLECTION</p>
          <h2>{collection.name}</h2>
          <span>{items.length} 张图片</span>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="collection-detail-empty">这个分类还没有图片。</div>
      ) : (
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
                {collection.coverArtworkId === artwork.id ? "当前封面" : "设为分类封面"}
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
    <article className="collection-card" onClick={onOpen}>
      <button
        type="button"
        className="collection-edit-button"
        aria-label={`编辑分类 ${collection.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        ···
      </button>
      <div className="collection-cover">
        {coverUrl
          ? <img src={coverUrl} alt="" loading="lazy" />
          : <div className="collection-cover-placeholder"><span>◇</span></div>}
      </div>
      <div className="collection-info">
        <h3>{collection.name}</h3>
        <small>{count} 个作品</small>
        {collection.description && <p className="collection-desc">{collection.description}</p>}
      </div>
    </article>
  );
}

export function formatSavedViewSummary(
  view: SavedCollectionView,
  collections: CollectionRecord[]
): string {
  const incNames = view.includedCollectionIds.map(
    (id) => collections.find((c) => c.id === id)?.name ?? "已失效分类"
  );
  const excNames = view.excludedCollectionIds.map(
    (id) => collections.find((c) => c.id === id)?.name ?? "已失效分类"
  );
  const op = view.matchMode === "all" ? " + " : " | ";
  let str = "";
  if (incNames.length > 0) str += incNames.join(op);
  else str += "全库作品";
  if (excNames.length > 0) str += " - " + excNames.join(" - ");
  return str;
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
  onDelete: () => void;
}) {
  const summary = formatSavedViewSummary(view, collections);

  // Find up to 3 covers from the included collections
  const covers = view.includedCollectionIds
    .map((colId) => {
      const col = collections.find((c) => c.id === colId);
      if (!col) return "";
      const art = artworks.find((a) => a.id === col.coverArtworkId)
        ?? artworks.find((a) => a.collectionIds.includes(colId));
      return art ? artworkImageUrl(art) : "";
    })
    .filter(Boolean)
    .slice(0, 3);

  return (
    <article className="collection-card saved-view-card" onClick={onOpen}>
      <div className="saved-view-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="saved-view-btn-action"
          title="编辑组合"
          aria-label={`编辑组合 ${view.name}`}
          onClick={onEdit}
        >
          ✏️
        </button>
        <button
          type="button"
          className="saved-view-btn-action btn-danger"
          title="删除组合"
          aria-label={`删除组合 ${view.name}`}
          onClick={onDelete}
        >
          🗑️
        </button>
      </div>

      <div className="collection-cover saved-view-cover-collage">
        {covers.length > 0 ? (
          covers.map((url, idx) => (
            <img key={idx} src={url} alt="" className={`collage-item collage-item-${idx + 1}`} loading="lazy" />
          ))
        ) : (
          <div className="collection-cover-placeholder saved-view-placeholder">
            <span>⚡</span>
          </div>
        )}
      </div>

      <div className="collection-info">
        <div className="saved-view-meta-row">
          <span className={`saved-view-mode-tag mode-${view.matchMode}`}>
            {view.matchMode === "all" ? "全部满足" : "任意满足"}
          </span>
        </div>
        <h3>{view.name}</h3>
        <p className="collection-desc saved-view-summary-text" title={summary}>
          {summary}
        </p>
      </div>
    </article>
  );
}
