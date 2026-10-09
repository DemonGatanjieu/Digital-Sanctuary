import { forwardRef, useRef } from "react";
import type { WorkQuery } from "@sanctuary/domain";
import { Icon } from "./Icon";
import type { GalleryPictureSearch } from "./useGalleryPictureSearch";
import { pictureSearchScopeKey } from "./gallery-picture-search";

/** One search box: describe a picture (Enter searches by content) or type a title / artist / Pixiv ID (filters as you type). */
export const GallerySearchField = forwardRef<HTMLInputElement, { search: GalleryPictureSearch; query: WorkQuery; onQueryChange: (query: WorkQuery) => void }>(
  function GallerySearchField({ search, query, onQueryChange }, inputRef) {
    const composing = useRef(false);
    const picture = search.mode === "picture";
    const value = picture ? search.draft : query.search ?? "";
    const hasState = picture ? Boolean(search.draft || search.snapshot || search.error) : Boolean(query.search);
    function clear() {
      search.clear();
      const { search: _search, ...rest } = query;
      onQueryChange({ ...rest, offset: 0 });
    }
    function switchMode() {
      const next = picture ? "name" : "picture";
      const draft = value;
      search.setMode(next);
      search.setDraft(draft);
      const { search: _search, ...rest } = query;
      onQueryChange({ ...rest, ...(next === "name" && draft ? { search: draft } : {}), offset: 0 });
    }
    return (
      <form className="ui-search gallery-search-field" role="search" onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current && picture && search.draft.trim() && !search.running && !search.pending) void search.search();
      }}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          aria-label="搜索图库"
          maxLength={picture ? 500 : 200}
          value={value}
          placeholder={picture ? "描述画面，回车找图，如：海边穿白裙的女孩" : "搜索标题、画师或 Pixiv ID"}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => picture ? search.setDraft(event.target.value) : onQueryChange({ ...query, search: event.target.value, offset: 0 })}
        />
        {hasState && <button type="button" className="ui-icon-button gallery-search-clear" aria-label="清除搜索" disabled={search.pending} onClick={clear}><Icon name="close" size={14} /></button>}
        {search.available && <button type="button" className="gallery-search-mode" aria-label={picture ? "当前按画面搜索，点击改为按名称搜索" : "当前按名称搜索，点击改为按画面搜索"}
          title="切换搜索方式" onClick={switchMode}>
          {picture ? "按画面" : "按名称"}
        </button>}
      </form>
    );
  }
);

/** Progress, relevance and errors of a picture search; renders nothing when idle. */
export function GallerySearchStatus({ search, query }: { search: GalleryPictureSearch; query: WorkQuery }) {
  if (search.mode !== "picture") return null;
  const p = search.snapshot?.progress;
  const stale = Boolean(p && pictureSearchScopeKey(p.galleryQuery ?? {}) !== pictureSearchScopeKey(query));
  const error = search.error || p?.error;
  if (!p && !search.pending && !error) return null;
  const phase = !p ? "正在准备搜索…"
    : p.phase === "scanning" ? `正在读取图库图片 · ${p.total} 张`
    : p.phase === "analyzing" ? (p.processed ? `正在建立索引 · ${p.processed}/${p.total}` : "正在准备找图模型，首次较慢")
    : p.phase === "cancelled" ? `已停止 · 保留已处理的 ${p.processed} 张`
    : p.phase === "failed" ? "这次找图没有完成"
    : p.total === 0 ? "当前范围没有可搜索的图片"
    : `按画面相似度排列 · 已搜索 ${p.processed} 张`;
  const relevance = !stale && search.snapshot && (search.snapshot.relevance.hiddenWorks > 0 || search.relevance === "all");
  return (
    <div className="gallery-search-status" aria-live="polite">
      <span role="status">{phase}{p?.failed ? ` · ${p.failed} 张读取失败` : ""}</span>
      {search.running && p && <button type="button" aria-label="停止找图" disabled={search.pending || p.cancelRequested} onClick={() => void search.cancel()}>{p.cancelRequested ? "正在停止…" : "停止"}</button>}
      {relevance && <button type="button" aria-label={search.relevance === "all" ? "只看较相关结果" : "显示更多搜索结果"} disabled={search.pending} onClick={() => void search.setRelevance(search.relevance === "all" ? "relevant" : "all")}>
        {search.relevance === "all" ? "只看较相关" : `显示另外 ${search.snapshot!.relevance.hiddenWorks} 个弱相关结果`}
      </button>}
      {p?.query && search.draft.trim() !== p.query.text && <span>结果来自“{p.query.text}”，回车搜索新描述</span>}
      {stale && <span>筛选已变化，{search.running ? "先停止再重新找图" : "回车按新范围找图"}</span>}
      {p?.warnings.map((warning, index) => <span key={index}>{warning}</span>)}
      {error && <span role="alert" className="gallery-search-error">{error}。可重新找图，或改为按名称搜索。</span>}
    </div>
  );
}
