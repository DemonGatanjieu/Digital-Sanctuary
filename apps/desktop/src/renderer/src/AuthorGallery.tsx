import { useEffect, useState } from "react";
import type { CollectionRecord } from "@sanctuary/domain";
import { ArtworkCard, LazyArtworkImage, artworkImageUrl } from "./ArtworkCard";
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
    <button className="author-browser-card" onClick={onOpen}>
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
          <small>{author.works.length} 个作品 · {author.pageCount} 页</small>
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
  return (
    <section className="author-detail-page">
      <button className="author-back" onClick={onBack}>← 全部作者</button>
      <header className="author-detail-hero">
        <AuthorAvatar author={author} large />
        <div>
          <p className="eyebrow">CREATOR LIBRARY</p>
          <h2>{author.name}</h2>
          <span>{author.works.length} 个作品 · {author.pageCount} 页</span>
        </div>
        {author.id && (
          <a href={`https://www.pixiv.net/users/${author.id}`} target="_blank" rel="noreferrer" className="pixiv-link">
            <code>pixiv/{author.id}</code>
          </a>
        )}
      </header>
      <div className="author-works">
        {author.works.map((work) => (
          <section className="work-group" key={work.key}>
            <header className="work-header">
              <div>
                <span>WORK {work.workId}</span>
                <h3>{work.title}</h3>
              </div>
              <strong>{work.pages.length} 页</strong>
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
    </section>
  );
}
