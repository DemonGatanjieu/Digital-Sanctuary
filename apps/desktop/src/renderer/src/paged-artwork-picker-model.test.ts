import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtworkPageQueryResult, ScopedArtworkRecord } from "@sanctuary/domain";
import { addPickerSelection, ArtworkPickerController, togglePickerSelection } from "./paged-artwork-picker-model.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const page = (id: string, offset = 0): ArtworkPageQueryResult => ({
  items: [{ id } as ScopedArtworkRecord], total: 121, offset, limit: 60, hasMore: offset < 120
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

afterEach(() => vi.useRealTimers());

describe("ArtworkPickerController", () => {
  it("loads a bounded page of legacy image IDs and excludes only the target collection", async () => {
    const fetch = vi.fn().mockResolvedValue(page("legacy-page-id"));
    const controller = new ArtworkPickerController("album", fetch, () => undefined);
    controller.start(); await flush();
    expect(fetch).toHaveBeenCalledWith({ search: "", offset: 0, limit: 60, excludedCollectionId: "album" });
    expect(controller.state.result.items[0]?.id).toBe("legacy-page-id");
    expect(controller.state.loading).toBe(false);
  });

  it("invalidates a pending page immediately while the next search waits 180ms", async () => {
    vi.useFakeTimers();
    const old = deferred<ArtworkPageQueryResult>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(page("new-search"));
    const controller = new ArtworkPickerController("album", fetch, () => undefined);
    controller.start();
    controller.changeSearch("前一个词"); controller.changeSearch("  新词  ");
    old.resolve(page("stale")); await flush();
    expect(controller.state.result.items).toEqual([]);
    expect(controller.state.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(179); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toEqual({ search: "新词", offset: 0, limit: 60, excludedCollectionId: "album" });
    expect(controller.state.result.items[0]?.id).toBe("new-search");
  });

  it("preserves the requested page after a failure so retry does not silently return to page one", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page("first")).mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce(page("second", 60));
    const controller = new ArtworkPickerController("album", fetch, () => undefined);
    controller.start(); await flush(); controller.goTo(60); await flush();
    expect(controller.state.error).toBe("读取失败");
    expect(controller.state.offset).toBe(60);
    controller.retry(); await flush();
    expect(fetch.mock.calls[2]?.[0].offset).toBe(60);
    expect(controller.state.result.items[0]?.id).toBe("second");
    expect(controller.state.error).toBe("");
  });

  it("ignores an old failure and outstanding results after the picker closes", async () => {
    vi.useFakeTimers();
    const pending = deferred<ArtworkPageQueryResult>();
    const publish = vi.fn();
    const controller = new ArtworkPickerController("album", () => pending.promise, publish);
    controller.start(); controller.changeSearch("新搜索"); controller.dispose();
    const calls = publish.mock.calls.length;
    pending.reject(new Error("旧失败")); await flush(); await vi.advanceTimersByTimeAsync(200);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(controller.state.error).toBe("");
  });

  it("prevents concurrent pagination while a page is loading", async () => {
    const pending = deferred<ArtworkPageQueryResult>();
    const fetch = vi.fn().mockResolvedValueOnce(page("first")).mockReturnValueOnce(pending.promise);
    const controller = new ArtworkPickerController("album", fetch, () => undefined);
    controller.start(); await flush(); controller.goTo(60); controller.goTo(120);
    expect(fetch).toHaveBeenCalledTimes(2);
    pending.resolve(page("second", 60)); await flush();
    expect(controller.state.offset).toBe(60);
  });
});

describe("picker selections", () => {
  it("adds the current page without losing IDs selected on another page or search", () => {
    const merged = addPickerSelection(new Set(["page-a", "shared"]), ["page-b", "shared", "page-b"]);
    expect([...merged.selected]).toEqual(["page-a", "shared", "page-b"]);
    expect(togglePickerSelection(merged.selected, "shared").selected.has("shared")).toBe(false);
    expect(merged.selected.has("shared")).toBe(true);
  });

  it("caps bulk selection at 500 real IDs and reports excluded new selections", () => {
    const selected = new Set(Array.from({ length: 499 }, (_, i) => String(i)));
    const merged = addPickerSelection(selected, ["0", "new-a", "new-b", "new-b"]);
    expect(merged.selected.size).toBe(500);
    expect(merged.selected.has("new-a")).toBe(true);
    expect(merged.selected.has("new-b")).toBe(false);
    expect(merged.omitted).toBe(1);
    expect(selected.size).toBe(499);
  });
});
