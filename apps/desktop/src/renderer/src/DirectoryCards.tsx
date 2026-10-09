import { useEffect, useState, type ReactNode } from "react";
import type { ArtistRecord, ArtistSummary, CollectionRecord, CollectionSummary, SavedCollectionView, SavedViewSummary, WorkAssetRecord } from "@sanctuary/domain";
import { Icon, type IconName } from "./Icon";
import { MenuItem, Popover } from "./Popover";
import { localImageUrl } from "./image-url";

type CoverAsset = Pick<WorkAssetRecord, "id" | "path" | "thumbnailPath">;
interface CardAction { icon: IconName; label: string; danger?: boolean; onSelect: () => void }

/** Album, combination and artist entries share one shape: a cover (or mosaic), a name and a count. */
function DirectoryCard({ covers, placeholder, title, meta, note, avatar, actions = [], onOpen }: {
  covers: CoverAsset[];
  placeholder: IconName;
  title: string;
  meta: string;
  note?: string | undefined;
  avatar?: ReactNode;
  actions?: CardAction[];
  onOpen: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const shown = covers.slice(0, 3);
  return (
    <article className="directory-card">
      <button type="button" className="directory-card-open" onClick={onOpen} aria-label={`打开 ${title}`}>
        <span className={`directory-card-cover covers-${shown.length}`}>
          {shown.length ? shown.map((asset) => <img key={asset.id} src={localImageUrl(asset.thumbnailPath ?? asset.path)} alt="" loading="lazy" decoding="async" />)
            : <span className="directory-card-placeholder"><Icon name={placeholder} size={28} /></span>}
        </span>
        <span className="directory-card-body">
          {avatar}
          <span className="directory-card-copy">
            <strong>{title}</strong>
            <small>{meta}</small>
            {note && <small className="directory-card-note">{note}</small>}
          </span>
        </span>
      </button>
      {actions.length > 0 && (
        <button type="button" className="ui-icon-button directory-card-more" aria-label={`${title} 的操作`} aria-haspopup="menu" aria-expanded={Boolean(menu)}
          onClick={(event) => setMenu(menu ? null : event.currentTarget)}><Icon name="more" size={18} /></button>
      )}
      {menu && (
        <Popover anchor={menu} label={`${title} 的操作`} align="end" onClose={() => setMenu(null)}>
          {actions.map((action) => <MenuItem key={action.label} icon={action.icon} label={action.label} danger={action.danger === true} onSelect={() => { setMenu(null); action.onSelect(); }} />)}
        </Popover>
      )}
    </article>
  );
}

export function CollectionCard({ collection, onOpen, onEdit, onFilter }: {
  collection: CollectionSummary;
  onOpen: () => void;
  onEdit: () => void;
  onFilter?: () => void;
}) {
  return (
    <DirectoryCard
      covers={collection.coverAsset ? [collection.coverAsset] : []}
      placeholder="album"
      title={collection.name}
      meta={`${collection.workCount} 个作品 · ${collection.bookPageCount} 页画作`}
      note={collection.description || undefined}
      onOpen={onOpen}
      actions={[
        { icon: "rename", label: "编辑相册…", onSelect: onEdit },
        ...(onFilter ? [{ icon: "filter" as const, label: "在作品中筛选", onSelect: onFilter }] : [])
      ]}
    />
  );
}

export function formatSavedViewSummary(view: SavedCollectionView, collections: CollectionRecord[]): string {
  const names = (ids: string[]) => ids.map((id) => collections.find((c) => c.id === id)?.name).filter(Boolean);
  const includeNames = names(view.includedCollectionIds);
  const excludeNames = names(view.excludedCollectionIds);
  const parts: string[] = [];
  if (includeNames.length > 0) parts.push(`包含 [${includeNames.join(", ")}] (${view.matchMode === "all" ? "全部满足" : "任一满足"})`);
  if (excludeNames.length > 0) parts.push(`排除 [${excludeNames.join(", ")}]`);
  return parts.join(" 且 ") || "无条件筛选";
}

export function SavedCollectionViewCard({ view, collections, onOpen, onEdit, onDelete }: {
  view: SavedViewSummary;
  collections: CollectionRecord[];
  onOpen: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const missing = view.missingIncludedIds.length > 0 || view.missingExcludedIds.length > 0;
  return (
    <DirectoryCard
      covers={view.previewAssets}
      placeholder="filter"
      title={view.name}
      meta={`${view.workCount} 个作品 · ${view.pageCount} 页`}
      note={missing ? "部分相册已删除，按现有条件展示" : formatSavedViewSummary(view, collections)}
      onOpen={onOpen}
      actions={[
        { icon: "rename", label: "编辑组合…", onSelect: onEdit },
        ...(onDelete ? [{ icon: "remove" as const, label: "删除组合…", danger: true, onSelect: onDelete }] : [])
      ]}
    />
  );
}

export function AuthorAvatar({ author, large = false }: { author: { name: string; artistRecord?: ArtistRecord; artist?: ArtistRecord | null }; large?: boolean }) {
  const localPath = (author.artistRecord ?? author.artist)?.avatarLocalPath ?? "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [localPath]);
  const className = `author-monogram${large ? " large" : ""}`;
  if (localPath && !failed) {
    return <img className={`${className} avatar`} src={localImageUrl(localPath)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <span className={className}>{author.name.slice(0, 1).toUpperCase()}</span>;
}

export function AuthorBrowserCard({ author, onOpen }: { author: ArtistSummary; onOpen: () => void }) {
  return (
    <DirectoryCard
      covers={author.previewAssets}
      placeholder="user"
      title={author.name}
      meta={`${author.workCount} 个作品 · ${author.pageCount} 页画稿`}
      avatar={<AuthorAvatar author={author} />}
      onOpen={onOpen}
    />
  );
}
