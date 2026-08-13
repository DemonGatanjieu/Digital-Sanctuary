import type { ArtworkRecord, CollectionRecord } from "@sanctuary/domain";
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
