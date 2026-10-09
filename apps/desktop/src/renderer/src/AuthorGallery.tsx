import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ArtistRecord, ArtistSummary, CollectionRecord } from "@sanctuary/domain";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { MenuItem, MenuLabel, MenuSeparator } from "./Popover";
import { PageGrid, type GridPage } from "./PageGrid";
import { LazyImage } from "./WorkGrid";
import { SegmentedControl } from "./SegmentedControl";
import { AuthorAvatar } from "./DirectoryCards";
import { PhotobookFlipSpread, type PhotobookAlbumInfo } from "./CollectionGallery";
import type { AuthorGalleryGroup } from "./gallery-model";
import type { ArtistDetailSession, ArtistDetailViewMode, GalleryDetailSessionPatch } from "./gallery-detail-session";
import { detailPageAttributes } from "./detail-scroll";
import { useDetailScroll } from "./useDetailScroll";

type ArtistSessionPatch = GalleryDetailSessionPatch<{ kind: "artist"; artistId: string | null }>;

export function AuthorDetailPage({
  author,
  collections,
  onBack,
  onAssign,
  onOpenArtwork,
  onOpenPixivArtist,
  onViewWorks,
  session = null,
  onSessionChange,
  onRegisterCapture,
  mainScrollRef,
  lightboxOpen = false
}: {
  author: AuthorGalleryGroup;
  collections: CollectionRecord[];
  onBack: () => void;
  onAssign: (artworkId: string, collectionId: string) => void;
  onOpenArtwork: (artworkId: string) => void;
  onOpenPixivArtist: (artistId: string) => void;
  onViewWorks: () => void;
  lightboxOpen?: boolean | undefined;
  session?: ArtistDetailSession | null;
  onSessionChange?: (patch: ArtistSessionPatch) => void;
  onRegisterCapture?: (capture: () => ArtistSessionPatch) => () => void;
  mainScrollRef?: RefObject<HTMLElement | null>;
}) {
  const [fallbackMode, setFallbackMode] = useState<ArtistDetailViewMode>("works");
  // The floating "aquarium" stage was retired; sessions that remember it open the grid instead.
  const viewMode: ArtistDetailViewMode = session?.viewMode && session.viewMode !== "aquarium" ? session.viewMode : fallbackMode;
  const [isPhotobookTocOpen, setIsPhotobookTocOpen] = useState(false);

  // Flatten all artworks for this author
  const allArtworks = useMemo(() => author.works.flatMap((work) => work.pages), [author.works]);
  const primaryArtwork = allArtworks[0];
  const stageRef = useRef<HTMLElement>(null);
  const fallbackScrollRef = useRef<HTMLElement>(null);
  const bookCapture = useRef<(() => GalleryDetailSessionPatch) | null>(null);
  const bookAnchorRef = useRef(session?.bookAnchor ?? null);
  const tocPositionRef = useRef(session?.tocPosition ?? null);
  const previousSession = useRef(session);
  if (session !== previousSession.current) {
    previousSession.current = session;
    if (session) { bookAnchorRef.current = session.bookAnchor; tocPositionRef.current = session.tocPosition; }
  }
  const anchoredItems = useMemo(() => viewMode === "works" || viewMode === "catalog" ? allArtworks : [], [viewMode, allArtworks]);
  const captureScroll = useDetailScroll({ channel: `${author.key}:${viewMode}`, containerRef: mainScrollRef ?? fallbackScrollRef,
    contentRef: stageRef, items: anchoredItems, position: session?.scrollPositions[viewMode] ?? null,
    onChange: (position) => onSessionChange?.({ scrollPositions: { [viewMode]: position } }) });
  const capture = useCallback((): ArtistSessionPatch => {
    const position = captureScroll();
    return { viewMode, bookAnchor: bookAnchorRef.current, tocPosition: tocPositionRef.current,
      ...(bookCapture.current?.() ?? {}), ...(position ? { scrollPositions: { [viewMode]: position } } : {}) } as ArtistSessionPatch;
  }, [viewMode, captureScroll]);
  useLayoutEffect(() => onRegisterCapture?.(capture), [onRegisterCapture, capture]);
  const changeViewMode = (next: ArtistDetailViewMode) => {
    const patch = capture(); setFallbackMode(next); onSessionChange?.({ ...patch, viewMode: next });
  };
  const changeTocOpen = (open: boolean) => {
    if (!open) {
      const patch = bookCapture.current?.();
      if (patch?.tocPosition) { tocPositionRef.current = patch.tocPosition; onSessionChange?.({ tocPosition: patch.tocPosition }); }
    }
    setIsPhotobookTocOpen(open);
  };
  useEffect(() => { if (viewMode !== "artbook") setIsPhotobookTocOpen(false); }, [viewMode]);

  // Keyboard navigation for ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229 || lightboxOpen || document.querySelector(".dialog-overlay")) return;
      if (isPhotobookTocOpen) {
        e.preventDefault();
        changeTocOpen(false);
      } else {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPhotobookTocOpen, lightboxOpen, onBack]);

  const authorAlbumInfo: PhotobookAlbumInfo = useMemo(() => ({
    id: author.id,
    name: author.name,
    description: `${author.workCount ?? author.works.length} 个作品 · ${allArtworks.length} 页`,
    coverArtworkId: primaryArtwork?.id ?? null
  }), [author, allArtworks, primaryArtwork]);
  const pixivId = /^[0-9]+$/.test(author.id) ? author.id : null;

  return (
    <section className="author-detail-page" data-detail-mode={viewMode} role="region" aria-label={`画师 ${author.name}`}>
      <header className="detail-header">
        <button type="button" className="ui-tool-button detail-back" onClick={onBack} title="返回画师（Esc）"><Icon name="chevronLeft" size={16} /><span>画师</span></button>
        <AuthorAvatar author={author} />
        <div className="detail-title">
          <h1>{author.name}</h1>
          <small>{author.workCount ?? author.works.length} 个作品 · {author.pageCount} 页</small>
        </div>
        <SegmentedControl label="浏览方式" value={viewMode} onChange={changeViewMode}
          options={[{ value: "works", label: "网格" }, { value: "artbook", label: "画册" }, { value: "catalog", label: "目录" }]} />
        <div className="detail-actions">
          {pixivId && <button type="button" className="ui-tool-button" title="在探索页打开这位画师的 Pixiv 主页" onClick={() => onOpenPixivArtist(pixivId)}><Icon name="explore" size={16} /><span>Pixiv 主页</span></button>}
          <button type="button" className="ui-tool-button" onClick={onViewWorks} title="在作品页按此画师筛选"><Icon name="filter" size={16} /><span>查看作品</span></button>
        </div>
      </header>

      <main className="author-stage-canvas" ref={stageRef}>
        {allArtworks.length === 0 ? (
          <section className="gallery-empty">
            <h2>{author.workCount === 0 ? "这位画师还没有本地作品" : "这些作品可在图库中浏览"}</h2>
            <p>{author.workCount === 0 ? "保存作品后，会出现在这里。" : "当前没有可编入画册的页面，作品和原图仍然保留。"}</p>
            <div className="gallery-empty-actions"><Button onClick={onViewWorks}>查看作品</Button></div>
          </section>
        ) : viewMode === "artbook" ? (
          <div className="author-photobook-container">
            <PhotobookFlipSpread
              collection={authorAlbumInfo}
              items={allArtworks}
              onOpenArtwork={onOpenArtwork}
              isTocOpen={isPhotobookTocOpen}
              onTocOpenChange={changeTocOpen}
              interactionSuspended={lightboxOpen}
              pageAnchor={bookAnchorRef.current}
              onPageAnchorChange={(anchor) => { bookAnchorRef.current = anchor; onSessionChange?.({ bookAnchor: anchor }); }}
              tocPosition={tocPositionRef.current}
              onTocPositionChange={(position) => { tocPositionRef.current = position; onSessionChange?.({ tocPosition: position }); }}
              onRegisterCapture={(reader) => { bookCapture.current = reader; return () => { if (bookCapture.current === reader) bookCapture.current = null; }; }}
            />
          </div>
        ) : viewMode === "catalog" ? (
          <div className="author-catalog-container">
            <div className="author-catalog-header">
              <span>序号</span>
              <span>作品</span>
              <span>页码</span>
              <span>预览</span>
              <span />
            </div>
            <div className="author-catalog-list">
              {allArtworks.map((artwork, idx) => (
                <div key={artwork.id} {...detailPageAttributes(artwork)} className="author-catalog-row" onClick={() => onOpenArtwork(artwork.id)}>
                  <div className="catalog-index-cell"><span className="catalog-number">{String(idx + 1).padStart(2, "0")}</span></div>
                  <div className="catalog-title-cell">
                    <strong className="catalog-title">{artwork.displayName ?? artwork.source?.title ?? artwork.fileName}</strong>
                    <small className="catalog-subtitle">{artwork.source?.workId ? `Pixiv ${artwork.source.workId}` : "本地导入"}</small>
                  </div>
                  <div className="catalog-page-cell"><span className="catalog-page-tag">{artwork.source?.pageIndex !== undefined ? `第 ${artwork.source.pageIndex + 1} 页` : "单页"}</span></div>
                  <div className="catalog-thumb-cell catalog-thumb-img"><LazyImage path={(artwork as GridPage).thumbnailPath ?? artwork.path} /></div>
                  <div className="catalog-action-cell" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <PageGrid pages={allArtworks} onOpen={onOpenArtwork}
            badgeFor={(page) => { const work = author.works.find((item) => item.pages.includes(page)); return work && work.pages.length > 1 ? `${work.pages.indexOf(page) + 1}/${work.pages.length}` : null; }}
            renderMenu={(page, close) => <>
              <MenuItem icon="open" label="打开" onSelect={() => { close(); onOpenArtwork(page.id); }} />
              {collections.length > 0 && <><MenuSeparator /><MenuLabel>加入相册</MenuLabel></>}
              {collections.map((item) => (
                <MenuItem key={item.id} label={item.name} checked={page.collectionIds.includes(item.id)} disabled={page.collectionIds.includes(item.id)}
                  onSelect={() => { close(); onAssign(page.id, item.id); }} />
              ))}
            </>} />
        )}
      </main>
    </section>
  );
}
