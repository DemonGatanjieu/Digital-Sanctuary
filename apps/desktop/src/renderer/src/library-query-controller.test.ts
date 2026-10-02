import { describe, expect, it, vi } from "vitest";
import type { WorkListItem, WorkQuery, WorkQueryResult } from "@sanctuary/domain";
import { LibraryQueryController } from "./library-query-controller";

function page(ids: string[], total = ids.length, offset = 0, limit = 60): WorkQueryResult {
  return { items: ids.map((id) => ({ id } as WorkListItem)), total, totalPages: total, offset, limit, hasMore: offset + ids.length < total };
}
function fixture() {
  const pending: { query: WorkQuery; resolve: (page: WorkQueryResult) => void; reject: (error: unknown) => void }[] = [];
  const errors = vi.fn();
  const controller = new LibraryQueryController((query) => new Promise((resolve, reject) => pending.push({ query, resolve, reject })), vi.fn(), errors);
  return { controller, pending, errors };
}

describe("library query concurrency", () => {
  it("keeps the newest search when an older reply arrives last", async () => {
    const { controller, pending } = fixture();
    controller.changeQuery({ search: "旧搜索" });
    const old = controller.refresh();
    controller.changeQuery({ search: "新搜索" });
    const latest = controller.refresh();
    pending[1]!.resolve(page(["new"])); await latest;
    pending[0]!.resolve(page(["old"])); await old;
    expect(controller.state.result.items.map((item) => item.id)).toEqual(["new"]);
    expect(controller.state.loading).toBe(false);
  });

  it("ignores an old page and its loading completion after a filter changes", async () => {
    const { controller, pending } = fixture();
    controller.changeQuery({ limit: 1 });
    const initial = controller.refresh(); pending[0]!.resolve(page(["first"], 3)); await initial;
    const more = controller.loadMore();
    controller.changeQuery({ collectionId: "new-album" });
    pending[1]!.resolve(page(["old-page"], 3, 1)); await more;
    expect(controller.state.result.items.map((item) => item.id)).toEqual(["first"]);
    expect(controller.state.loading).toBe(true);
    await controller.loadMore();
    expect(pending).toHaveLength(2); // Pending filter must not trigger pagination for the previous result.
    const filtered = controller.refresh(); pending[2]!.resolve(page(["album"])); await filtered;
    expect(controller.state.result.items.map((item) => item.id)).toEqual(["album"]);
  });

  it("locks pagination before React can render and suppresses stale errors", async () => {
    const { controller, pending, errors } = fixture();
    controller.changeQuery({ limit: 1 });
    const initial = controller.refresh(); pending[0]!.resolve(page(["first"], 3)); await initial;
    const more = controller.loadMore(); const duplicate = controller.loadMore();
    expect(pending).toHaveLength(2);
    controller.changeQuery({ search: "another" });
    pending[1]!.reject(new Error("late old request")); await Promise.all([more, duplicate]);
    expect(errors).not.toHaveBeenCalled();
    const current = controller.refresh(); pending[2]!.reject(new Error("current failure")); await current;
    expect(errors).toHaveBeenCalledOnce();
    expect(controller.state.loading).toBe(false);
  });

  it("revalidates the loaded range in bounded chunks and retains normal page size", async () => {
    const fetch = vi.fn(async (query: WorkQuery) => {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 60;
      return page(Array.from({ length: Math.min(limit, 1000 - offset) }, (_, index) => String(offset + index)), 1000, offset, limit);
    });
    const controller = new LibraryQueryController(fetch, vi.fn(), vi.fn());
    await controller.refresh();
    for (let index = 0; index < 4; index += 1) await controller.loadMore();
    fetch.mockClear();
    await controller.refresh();
    expect(fetch.mock.calls.map(([query]) => [query.offset, query.limit])).toEqual([[0, 200], [200, 100]]);
    expect(controller.state.result.items).toHaveLength(300);
    expect(controller.state.result.limit).toBe(60);
    await controller.loadMore();
    expect(fetch.mock.calls.at(-1)![0]).toMatchObject({ offset: 300, limit: 60 });
  });

  it("stops a revalidation sequence when another query replaces it", async () => {
    const { controller, pending } = fixture();
    const initial = controller.refresh(); pending[0]!.resolve(page(Array.from({ length: 60 }, (_, i) => String(i)), 300)); await initial;
    const more = controller.loadMore(); pending[1]!.resolve(page(Array.from({ length: 60 }, (_, i) => String(i + 60)), 300, 60)); await more;
    const refresh = controller.refresh(); controller.changeQuery({ search: "changed" });
    pending[2]!.resolve(page(["outdated"], 300)); await refresh;
    expect(pending).toHaveLength(3);
    expect(controller.state.query.search).toBe("changed");
    expect(controller.state.loading).toBe(true);
  });
});
