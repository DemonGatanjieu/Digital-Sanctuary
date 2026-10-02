import type { WorkQuery, WorkQueryResult } from "@sanctuary/domain";

export const INITIAL_WORK_QUERY: WorkQuery = { sortBy: "savedAt", direction: "desc", offset: 0, limit: 60 };
export const EMPTY_WORK_RESULT: WorkQueryResult = { items: [], total: 0, totalPages: 0, offset: 0, limit: 60, hasMore: false };

export interface LibraryQueryState {
  query: WorkQuery;
  result: WorkQueryResult;
  loading: boolean;
}

/** Owns the query generation so delayed search, paging and refresh cannot overwrite one another. */
export class LibraryQueryController {
  state: LibraryQueryState = { query: INITIAL_WORK_QUERY, result: EMPTY_WORK_RESULT, loading: true };
  private generation = 0;
  private resultKey = "";

  constructor(
    private readonly fetchPage: (query: WorkQuery) => Promise<WorkQueryResult>,
    private readonly publish: (state: LibraryQueryState) => void,
    private readonly reportError: (error: unknown) => void
  ) {}

  changeQuery(query: WorkQuery): boolean {
    const normalized = { ...query, offset: 0, limit: query.limit ?? 60 };
    if (queryKey(normalized) === queryKey(this.state.query)) return false;
    this.generation += 1;
    this.resultKey = "";
    this.update({ query: normalized, loading: true });
    return true;
  }

  invalidate(): void { this.generation += 1; }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const query = this.state.query;
    const key = queryKey(query);
    const wanted = this.resultKey === key ? Math.max(query.limit ?? 60, this.state.result.items.length) : query.limit ?? 60;
    this.update({ loading: true });
    try {
      // Revalidate already loaded pages in bounded chunks without collapsing the scroll range.
      let next: WorkQueryResult | undefined;
      const items: WorkQueryResult["items"] = [];
      do {
        next = await this.fetchPage({ ...query, offset: items.length, limit: Math.min(200, wanted - items.length) });
        if (generation !== this.generation) return;
        items.push(...next.items);
      } while (next.hasMore && next.items.length > 0 && items.length < wanted);
      this.resultKey = key;
      this.update({ result: { ...next, items, offset: 0, limit: query.limit ?? 60, hasMore: items.length < next.total } });
    } catch (error) {
      if (generation === this.generation) this.reportError(error);
    } finally {
      if (generation === this.generation) this.update({ loading: false });
    }
  }

  async loadMore(): Promise<void> {
    if (this.state.loading || !this.state.result.hasMore || this.resultKey !== queryKey(this.state.query)) return;
    const generation = ++this.generation;
    const previous = this.state.result;
    this.update({ loading: true });
    try {
      const next = await this.fetchPage({ ...this.state.query, offset: previous.items.length, limit: previous.limit });
      if (generation !== this.generation) return;
      const knownIds = new Set(previous.items.map((item) => item.id));
      this.update({ result: { ...next, offset: 0, items: [...previous.items, ...next.items.filter((item) => !knownIds.has(item.id))] } });
    } catch (error) {
      if (generation === this.generation) this.reportError(error);
    } finally {
      if (generation === this.generation) this.update({ loading: false });
    }
  }

  private update(change: Partial<LibraryQueryState>): void {
    this.state = { ...this.state, ...change };
    this.publish(this.state);
  }
}

function queryKey(query: WorkQuery): string {
  return JSON.stringify([query.search ?? "", query.workType, query.artistId, query.collectionId,
    query.collectionIds, query.collectionMatchMode, query.excludedCollectionIds, query.sortBy, query.direction, query.limit ?? 60]);
}
