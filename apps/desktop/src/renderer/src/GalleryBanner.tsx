import { useEffect, useRef, useState } from "react";
import type { AppearancePreferences, WorkListItem } from "@sanctuary/domain";
import { Button } from "./Button";

export function GalleryBanner({ featured, appearance, searching, heading, onOpen }: {
  featured: WorkListItem | null; appearance: AppearancePreferences; searching: boolean; heading: string; onOpen: (work: WorkListItem) => void;
}) {
  const [banner, setBanner] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), pending = useRef(false), generation = useRef(0);
  useEffect(() => {
    alive.current = true; const current = ++generation.current;
    void window.sanctuary.getGalleryBanner().then(value => { if (alive.current && current === generation.current) setBanner(value); })
      .catch(() => { if (alive.current && current === generation.current) setError("读取横幅失败，请重试更换横幅"); });
    return () => { alive.current = false; };
  }, []);
  async function update(reset: boolean) {
    if (pending.current) return;
    pending.current = true; ++generation.current; setBusy(true); setError("");
    try { const value = reset ? await window.sanctuary.resetGalleryBanner() : await window.sanctuary.chooseGalleryBanner(); if (alive.current) setBanner(value); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "更换横幅失败，请重试"); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const cover = featured?.coverAsset;
  const source = banner ?? (cover ? imageUrl(cover.thumbnailPath ?? cover.path) : null);
  const visible = !searching && appearance.ambientArtwork && Boolean(source) && appearance.displayProfile !== "efficient";
  const controls = <div className="gallery-banner-actions"><Button size="small" variant="ghost" busy={busy} onClick={() => void update(false)}>更换横幅</Button>{banner && <Button size="small" variant="ghost" disabled={busy} onClick={() => void update(true)}>恢复自动精选</Button>}</div>;
  return <>
    {visible ? <section className={`work-ambient-hero ${banner ? "gallery-banner-custom" : ""}`} aria-label="图库横幅">
      <img className="work-ambient-backdrop" src={source!} alt="" aria-hidden="true" draggable={false} />
      <div className="work-ambient-copy"><span>{banner ? "我的空间" : heading}</span><strong>{banner ? "我的图库" : featured!.title}</strong><small>{banner ? "收藏灵感，随时取用" : `${featured!.artistName ?? "本地作品"} · ${featured!.pageCount} 页`}</small>
        <div className="gallery-banner-buttons">{!banner && featured && <Button size="small" onClick={() => onOpen(featured)}>继续欣赏</Button>}{controls}</div>
      </div>
      {!banner && source && <img className="work-ambient-cover" src={source} alt="" draggable={false} />}
    </section> : <div className="gallery-banner-collapsed">{controls}</div>}
    {error && <p className="gallery-banner-error" role="alert">{error}</p>}
  </>;
}
function imageUrl(path: string) { return `sanctuary-image://local/${encodeURIComponent(path)}`; }
