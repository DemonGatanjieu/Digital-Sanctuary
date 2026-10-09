import { memo, useState, type ReactNode } from "react";
import { Popover } from "./Popover";
import { FALLBACK_RATIO, LazyImage, measuredRatio, rememberRatio } from "./WorkGrid";
import { detailPageAttributes } from "./detail-scroll";
import type { ArtworkRecord } from "@sanctuary/domain";

/** A page inside an album or artist scope; scoped records carry their thumbnail. */
export type GridPage = ArtworkRecord & { thumbnailPath?: string | null };

export function pageTitle(page: GridPage): string {
  return page.displayName ?? page.source?.title ?? page.fileName;
}

/** Justified image rows for album / artist pages, sharing the gallery tile look. Actions live in a context menu. */
export function PageGrid({ pages, badgeFor, onOpen, renderMenu }: {
  pages: GridPage[];
  badgeFor?: (page: GridPage) => string | null;
  onOpen: (pageId: string) => void;
  renderMenu: (page: GridPage, close: () => void) => ReactNode;
}) {
  const [menu, setMenu] = useState<{ page: GridPage; x: number; y: number } | null>(null);
  return <>
    <section className="work-grid" aria-label="页面">
      {pages.map((page) => (
        <PageTile key={page.id} page={page} badge={badgeFor?.(page) ?? null} onOpen={onOpen}
          onMenu={(target, x, y) => setMenu({ page: target, x, y })} />
      ))}
    </section>
    {menu && (
      <Popover anchor={{ x: menu.x, y: menu.y }} label={`${pageTitle(menu.page)} 的操作`} onClose={() => setMenu(null)}>
        {renderMenu(menu.page, () => setMenu(null))}
      </Popover>
    )}
  </>;
}

const PageTile = memo(function PageTile({ page, badge, onOpen, onMenu }: {
  page: GridPage;
  badge: string | null;
  onOpen: (pageId: string) => void;
  onMenu: (page: GridPage, x: number, y: number) => void;
}) {
  const [ratio, setRatio] = useState(() => measuredRatio(page.id) ?? FALLBACK_RATIO);
  const title = pageTitle(page);
  const subtitle = [page.source?.authorName, page.source?.pageIndex !== undefined ? `第 ${page.source.pageIndex + 1} 页` : null].filter(Boolean).join(" · ");
  return (
    <div className="work-tile" {...detailPageAttributes(page)}
      style={{ flexGrow: ratio, flexBasis: `calc(var(--work-row-height) * ${ratio})`, aspectRatio: String(ratio) }}>
      <button type="button" className="work-tile-image" aria-label={`打开 ${title}`} title={title}
        onClick={() => onOpen(page.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(page, event.clientX || rect.left + 12, event.clientY || rect.top + 12);
        }}>
        <LazyImage path={page.thumbnailPath ?? page.path} onRatio={(value) => { rememberRatio(page.id, value); setRatio(value); }} />
      </button>
      {badge && <span className="work-tile-pages">{badge}</span>}
      <div className="work-tile-caption" aria-hidden="true">
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>
    </div>
  );
});
