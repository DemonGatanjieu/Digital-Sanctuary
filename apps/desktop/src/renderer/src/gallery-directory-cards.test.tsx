import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtistSummary, CollectionSummary, SavedViewSummary, WorkAssetRecord } from "@sanctuary/domain";
import { AuthorBrowserCard, AuthorDetailPage } from "./AuthorGallery";
import { CollectionCard, CollectionDetailPage, SavedCollectionViewCard } from "./CollectionGallery";
import { authorDetailFromSummary } from "./gallery-model";

const cover = { id: "asset-only", workId: "work-only", legacyArtworkId: null, path: "C:\\local\\original.png", thumbnailPath: "C:\\local\\thumb.png" } as WorkAssetRecord;
const collection = { id: "album", name: "单页相册", description: "", createdAt: "now", workCount: 1, pageCount: 1, bookPageCount: 1, coverAsset: cover } satisfies CollectionSummary;
const author = { key: "unattributed", artistId: null, name: "未归属画师", artist: null, workCount: 4, pageCount: 8, bookPageCount: 0, previewAssets: [cover] } satisfies ArtistSummary;

describe("SQL-backed directory cards", () => {
  it("renders ordinary album counts and its trusted thumbnail without needing library pages", () => {
    const markup = renderToStaticMarkup(<CollectionCard collection={collection} onOpen={() => undefined} onEdit={() => undefined} />);
    expect(markup).toContain("1 个作品 · 1 页画作");
    expect(markup).toContain(encodeURIComponent(cover.thumbnailPath!));
    expect(markup).not.toContain(encodeURIComponent(cover.path));
  });

  it("uses saved-view work totals and asset previews without repeating per-page AND/NOT filtering", () => {
    const view = { id: "saved", name: "跨页组合", matchMode: "all", includedCollectionIds: ["a", "b"], excludedCollectionIds: [], createdAt: "now", updatedAt: "now",
      effectiveQuery: { matchMode: "all", includedCollectionIds: ["a", "b"], excludedCollectionIds: [] }, missingIncludedIds: [], missingExcludedIds: [], workCount: 1, pageCount: 3, previewAssets: [cover] } satisfies SavedViewSummary;
    const markup = renderToStaticMarkup(<SavedCollectionViewCard view={view} collections={[]} onOpen={() => undefined} onEdit={() => undefined} />);
    expect(markup).toContain("1 个作品 · 3 页");
    expect(markup).toContain(encodeURIComponent(cover.thumbnailPath!));
  });

  it("keeps asset-only works visible in author summaries and offers their canonical work entry", () => {
    const card = renderToStaticMarkup(<AuthorBrowserCard author={author} onOpen={() => undefined} />);
    expect(card).toContain("4 个作品 · 8 页画稿");
    const detail = renderToStaticMarkup(<AuthorDetailPage author={authorDetailFromSummary(author, [])} collections={[]}
      onBack={() => undefined} onAssign={() => undefined} onOpenArtwork={() => undefined} onOpenPixivArtist={() => undefined} onViewWorks={() => undefined} />);
    expect(detail).toContain("这些作品可在图库中浏览");
    expect(detail).toContain("查看作品");
    expect(detail).not.toContain("art-preview-button");
  });

  it("offers the work entry for an album with asset-only works without synthesizing book pages", () => {
    const markup = renderToStaticMarkup(<CollectionDetailPage collection={{ ...collection, bookPageCount: 0 }} artworks={[]}
      collections={[]} onBack={() => undefined} onAssign={() => undefined} onAddArtworks={async () => undefined}
      onOpenArtwork={() => undefined} onSetCover={() => undefined} onFilterInGallery={() => undefined} />);
    expect(markup).toContain("本相册的作品可在图库中浏览");
    expect(markup).toContain("在图库中查看作品 (1)");
    expect(markup).not.toContain("art-preview-button");
  });
});
