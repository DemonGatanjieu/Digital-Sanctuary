import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import type { CollectionRecord, WorkListItem } from "@sanctuary/domain";
import { Icon } from "./Icon";
import { MenuItem, MenuLabel, MenuSeparator, Popover, type PopoverAnchor } from "./Popover";
import { localImageUrl } from "./image-url";

/** Portrait is the most common shape in the library; used until real dimensions are known. */
export const FALLBACK_RATIO = 0.75;
/** Ratios measured from loaded thumbnails this session, so returning to the gallery does not re-flow rows. */
const measuredRatios = new Map<string, number>();
export function measuredRatio(key: string): number | null {
  return measuredRatios.get(key) ?? null;
}
export function rememberRatio(assetId: string, ratio: number) {
  if (measuredRatios.size > 20000) measuredRatios.clear();
  measuredRatios.set(assetId, ratio);
}

export function tileRatio(width: number | null | undefined, height: number | null | undefined): number | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  // Clamp panoramas and very tall strips so one image never dominates or vanishes in a row.
  return Math.min(2.4, Math.max(0.45, width / height));
}

export interface WorkTileHandlers {
  onOpen: (work: WorkListItem, event: MouseEvent) => void;
  onToggleSelection: (workId: string, shiftKey: boolean) => void;
  onFavorite: (work: WorkListItem) => void;
  onContextMenu: (work: WorkListItem, anchor: PopoverAnchor) => void;
  onDragError: (error: unknown) => void;
}

export const WorkTile = memo(function WorkTile({ work, selecting, selected, opening, busy, handlers }: {
  work: WorkListItem;
  selecting: boolean;
  selected: boolean;
  opening: boolean;
  busy: boolean;
  handlers: WorkTileHandlers;
}) {
  const known = tileRatio(work.coverAsset?.width, work.coverAsset?.height);
  const cover = work.coverAsset;
  const [measured, setMeasured] = useState<number | null>(() => cover ? measuredRatios.get(cover.id) ?? null : null);
  const ratio = known ?? measured ?? FALLBACK_RATIO;
  const path = cover?.thumbnailPath ?? cover?.path ?? "";
  const draggable = Boolean(cover && cover.mediaType === "image" && !selecting);
  const pageLabel = work.matchedPage !== undefined ? `第 ${work.matchedPage + 1}/${work.pageCount} 页` : String(work.pageCount);
  return (
    <div
      className="work-tile"
      data-work-tile={work.id}
      data-selected={selected || undefined}
      data-selecting={selecting || undefined}
      style={{ flexGrow: ratio, flexBasis: `calc(var(--work-row-height) * ${ratio})`, aspectRatio: String(ratio) }}
    >
      <button
        type="button"
        className="work-tile-image"
        aria-label={`${selecting ? (selected ? "取消选择" : "选择") : "打开"} ${work.title}`}
        aria-pressed={selecting ? selected : undefined}
        disabled={opening}
        draggable={draggable}
        title={work.title}
        onClick={(event) => handlers.onOpen(work, event)}
        onContextMenu={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          // Keyboard-invoked context menus report no pointer position.
          const point = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + 12, y: rect.top + 12 };
          handlers.onContextMenu(work, point);
        }}
        onDragStart={(event) => {
          event.preventDefault();
          if (draggable && cover) void window.sanctuary.dragImage({ workId: work.id, assetId: cover.id }).catch(handlers.onDragError);
        }}
      >
        {path ? <LazyImage path={path} onRatio={known || !cover ? undefined : (value) => { rememberRatio(cover.id, value); setMeasured(value); }} /> : <span className="work-tile-missing">封面待生成</span>}
      </button>

      <button
        type="button"
        className="work-tile-check"
        aria-label={selected ? `取消选择 ${work.title}` : `选择 ${work.title}`}
        aria-pressed={selected}
        onClick={(event) => handlers.onToggleSelection(work.id, event.shiftKey)}
      >
        <Icon name="check" size={14} />
      </button>

      {work.pageCount > 1 && <span className="work-tile-pages" title={`共 ${work.pageCount} 页`}><Icon name="pages" size={12} />{pageLabel}</span>}

      <div className="work-tile-caption" aria-hidden="true">
        <strong>{work.title}</strong>
        <small>{work.artistName ?? "本地作品"}</small>
      </div>

      {!selecting && (
        <button
          type="button"
          className="work-tile-favorite"
          data-active={work.favorite || undefined}
          aria-label={work.favorite ? `取消喜欢 ${work.title}` : `喜欢 ${work.title}`}
          aria-pressed={work.favorite}
          disabled={busy}
          onClick={() => handlers.onFavorite(work)}
        >
          <Icon name="heart" size={16} filled={work.favorite} />
        </button>
      )}
      {opening && <span className="work-tile-opening" role="status">正在打开…</span>}
    </div>
  );
});

export function LazyImage({ path, onRatio }: { path: string; onRatio?: ((ratio: number) => void) | undefined }) {
  const ref = useRef<HTMLImageElement>(null);
  const [load, setLoad] = useState(false);
  useEffect(() => {
    const image = ref.current;
    if (!image || load) return;
    // Tiles near the first screen start at once instead of waiting a frame for the observer.
    if (image.getBoundingClientRect().top < innerHeight * 1.5 || !("IntersectionObserver" in window)) { setLoad(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setLoad(true);
      observer.disconnect();
    }, { rootMargin: "800px 0px" });
    observer.observe(image);
    return () => observer.disconnect();
  }, [load]);
  return (
    <img
      ref={ref}
      src={load ? localImageUrl(path) : undefined}
      alt=""
      decoding="async"
      draggable={false}
      onLoad={(event) => {
        const ratio = tileRatio(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
        if (ratio && onRatio) onRatio(ratio);
      }}
    />
  );
}

export interface WorkMenuActions {
  open: () => void;
  favorite: () => void;
  addToAlbum: (collectionId: string) => void;
  removeFromAlbum?: (() => void) | undefined;
  copy: () => void;
  reveal: () => void;
  rename: () => void;
  select: () => void;
  remove: () => void;
}

export function WorkContextMenu({ work, anchor, collections, activeCollectionName, actions, onClose }: {
  work: WorkListItem;
  anchor: PopoverAnchor;
  collections: CollectionRecord[];
  activeCollectionName?: string | undefined;
  actions: WorkMenuActions;
  onClose: () => void;
}) {
  const [view, setView] = useState<"main" | "albums">("main");
  const run = (action: () => void) => () => { onClose(); action(); };
  const image = work.coverAsset?.mediaType === "image";
  const pageNote = work.matchedPage !== undefined ? "此页" : work.pageCount > 1 ? "封面" : "";
  return (
    <Popover anchor={anchor} label={`${work.title} 的操作`} onClose={onClose}>
      {view === "main" ? <>
        <MenuItem icon="open" label="打开" onSelect={run(actions.open)} />
        <MenuItem icon="heart" label={work.favorite ? "取消喜欢" : "喜欢"} onSelect={run(actions.favorite)} />
        <MenuItem icon="album" label="加入相册" hint="›" disabled={collections.length === 0} onSelect={() => setView("albums")} />
        {actions.removeFromAlbum && <MenuItem icon="close" label={`移出“${activeCollectionName ?? "当前相册"}”`} onSelect={run(actions.removeFromAlbum)} />}
        <MenuSeparator />
        <MenuItem icon="copy" label={`复制图片${pageNote ? `（${pageNote}）` : ""}`} disabled={!image} onSelect={run(actions.copy)} />
        <MenuItem icon="folder" label="在文件夹中显示" disabled={!work.coverAsset} onSelect={run(actions.reveal)} />
        <MenuItem icon="rename" label="改名…" onSelect={run(actions.rename)} />
        <MenuSeparator />
        <MenuItem icon="select" label="选择" onSelect={run(actions.select)} />
        <MenuItem icon="remove" label="移出图库…" danger onSelect={run(actions.remove)} />
      </> : <>
        <MenuItem icon="chevronLeft" label="返回" onSelect={() => setView("main")} />
        <MenuSeparator />
        <MenuLabel>加入相册</MenuLabel>
        {collections.map((collection) => {
          const included = work.collectionIds.includes(collection.id);
          return <MenuItem key={collection.id} label={collection.name} checked={included} disabled={included} onSelect={run(() => actions.addToAlbum(collection.id))} />;
        })}
      </>}
    </Popover>
  );
}
