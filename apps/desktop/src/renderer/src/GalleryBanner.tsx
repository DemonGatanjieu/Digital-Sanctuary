import type { AppearancePreferences, WorkListItem } from "@sanctuary/domain";
import { Button } from "./Button";
import { ArtworkBackgroundControls, useArtworkBackground } from "./ArtworkBackgroundControls";

export function GalleryBanner({ featured, appearance, searching, heading, onOpen }: {
  featured: WorkListItem | null; appearance: AppearancePreferences; searching: boolean; heading: string; onOpen: (work: WorkListItem) => void;
}) {
  const background=useArtworkBackground("gallery"),banner=background.image;
  const cover = featured?.coverAsset;
  const source = banner ?? (cover ? imageUrl(cover.thumbnailPath ?? cover.path) : null);
  const visible = !searching && appearance.ambientArtwork && Boolean(source) && appearance.displayProfile !== "efficient";
  const controls = <ArtworkBackgroundControls surface="gallery" background={background}/>;
  return <>
    {visible ? <section className={`work-ambient-hero ${banner ? "gallery-banner-custom" : ""}`} aria-label="图库横幅">
      <img className="work-ambient-backdrop" src={source!} alt="" aria-hidden="true" draggable={false} />
      <div className="work-ambient-copy"><span>{banner ? "我的空间" : heading}</span><strong>{banner ? "我的图库" : featured!.title}</strong><small>{banner ? "收藏灵感，随时取用" : `${featured!.artistName ?? "本地作品"} · ${featured!.pageCount} 页`}</small>
        <div className="gallery-banner-buttons">{!banner && featured && <Button size="small" onClick={() => onOpen(featured)}>继续欣赏</Button>}{controls}</div>
      </div>
      {!banner && source && <img className="work-ambient-cover" src={source} alt="" draggable={false} />}
    </section> : <div className="gallery-banner-collapsed">{controls}</div>}
  </>;
}
function imageUrl(path: string) { return `sanctuary-image://local/${encodeURIComponent(path)}`; }
