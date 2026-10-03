import type { ArtworkPageQuery, ArtworkPageQueryResult } from "@sanctuary/domain";

export const ARTWORK_PICKER_PAGE_SIZE = 60;
export const ARTWORK_PICKER_SELECTION_LIMIT = 500;
export const ARTWORK_PICKER_SEARCH_DELAY_MS = 180;

export interface ArtworkPickerState {
  search: string;
  offset: number;
  result: ArtworkPageQueryResult;
  loading: boolean;
  error: string;
}

export function initialArtworkPickerState(): ArtworkPickerState {
  return {
    search: "", offset: 0, loading: true, error: "",
    result: { items: [], total: 0, offset: 0, limit: ARTWORK_PICKER_PAGE_SIZE, hasMore: false }
  };
}

/** Invalidates immediately on input, before the debounce can start another request. */
export class ArtworkPickerController {
  state = initialArtworkPickerState();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly collectionId: string,
    private readonly fetchPage: (query: ArtworkPageQuery) => Promise<ArtworkPageQueryResult>,
    private readonly publish: (state: ArtworkPickerState) => void
  ) {}

  start(): void { void this.load(); }

  changeSearch(search: string): void {
    if (search === this.state.search) return;
    this.cancelPending();
    this.update({ search, offset: 0, result: initialArtworkPickerState().result, loading: true, error: "" });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.load();
    }, ARTWORK_PICKER_SEARCH_DELAY_MS);
  }

  goTo(offset: number): void {
    if (this.state.loading || offset < 0 || offset === this.state.offset) return;
    this.cancelPending();
    this.update({ offset, result: { ...this.state.result, items: [] }, error: "" });
    void this.load();
  }

  retry(): void { if (!this.state.loading) { this.cancelPending(); void this.load(); } }
  dispose(): void { this.cancelPending(); }

  private cancelPending(): void {
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    const query: ArtworkPageQuery = {
      search: this.state.search.trim(), offset: this.state.offset,
      limit: ARTWORK_PICKER_PAGE_SIZE, excludedCollectionId: this.collectionId
    };
    this.update({ loading: true, error: "" });
    try {
      const result = await this.fetchPage(query);
      if (generation !== this.generation) return;
      this.update({ result, offset: result.offset, loading: false });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ loading: false, error: error instanceof Error ? error.message : "读取画作暂时失败，请重试。" });
    }
  }

  private update(change: Partial<ArtworkPickerState>): void {
    this.state = { ...this.state, ...change };
    this.publish(this.state);
  }
}

export function addPickerSelection(
  selected: ReadonlySet<string>, ids: readonly string[], limit = ARTWORK_PICKER_SELECTION_LIMIT
): { selected: Set<string>; omitted: number } {
  const next = new Set(selected);
  let omitted = 0;
  for (const id of new Set(ids)) {
    if (next.has(id)) continue;
    if (next.size >= limit) omitted += 1;
    else next.add(id);
  }
  return { selected: next, omitted };
}

export function togglePickerSelection(selected: ReadonlySet<string>, id: string): { selected: Set<string>; omitted: number } {
  if (!selected.has(id)) return addPickerSelection(selected, [id]);
  const next = new Set(selected);
  next.delete(id);
  return { selected: next, omitted: 0 };
}
