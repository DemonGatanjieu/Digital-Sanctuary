import { describe, expect, it, vi } from "vitest";
import type { InspectArtworkResponse } from "@sanctuary/domain";
import { InspectorRequestController, type InspectorRequest } from "./inspector-request-controller";

function response(pageIndex: number): InspectArtworkResponse {
  return {
    assessment: { status: "complete", engine: "fixture", engineVersion: "1", labels: { [`page_${pageIndex}`]: 0.9 }, elapsedMs: 1 },
    pageCount: 3, activePageIndex: pageIndex, pages: []
  };
}

function fixture() {
  const pending: { request: InspectorRequest; resolve: (result: InspectArtworkResponse | null) => void; reject: (error: Error) => void }[] = [];
  const state = { loading: false, pageIndex: -1, workId: "", error: "" };
  const callbacks = {
    started: vi.fn(() => { state.loading = true; state.error = ""; }),
    result: vi.fn((result: InspectArtworkResponse | null, request: InspectorRequest) => { state.pageIndex = result?.activePageIndex ?? -1; state.workId = request.workId ?? ""; }),
    failed: vi.fn((error: unknown) => { state.error = (error as Error).message; }),
    settled: vi.fn(() => { state.loading = false; })
  };
  const controller = new InspectorRequestController((request) => new Promise((resolve, reject) => pending.push({ request, resolve, reject })), callbacks);
  return { pending, state, callbacks, controller };
}

describe("inspector request ownership", () => {
  it("keeps the newest page when a slow previous page returns last", async () => {
    const { controller, pending, state, callbacks } = fixture();
    const old = controller.load({ workId: "same-work", pageIndex: 1 });
    const latest = controller.load({ workId: "same-work", pageIndex: 2 });
    pending[1]!.resolve(response(2)); await latest;
    pending[0]!.resolve(response(1)); await old;
    expect(state.pageIndex).toBe(2);
    expect(state.loading).toBe(false);
    expect(callbacks.result).toHaveBeenCalledOnce();
    expect(callbacks.settled).toHaveBeenCalledOnce();
  });

  it.each(["resolve", "reject"] as const)("ignores old %s and its finally while the current page is still pending", async (completion) => {
    const { controller, pending, state, callbacks } = fixture();
    const old = controller.load({ pageIndex: 1 });
    const latest = controller.load({ pageIndex: 2 });
    if (completion === "resolve") pending[0]!.resolve(response(1));
    else pending[0]!.reject(new Error("obsolete failure"));
    await old;
    expect(state.loading).toBe(true);
    expect(state.pageIndex).toBe(-1);
    expect(state.error).toBe("");
    expect(callbacks.settled).not.toHaveBeenCalled();
    pending[1]!.resolve(response(2)); await latest;
    expect(state.pageIndex).toBe(2);
    expect(state.loading).toBe(false);
  });

  it("invalidates the old target before a new target starts", async () => {
    const { controller, pending, state } = fixture();
    const old = controller.load({ workId: "old-work", pageIndex: 1 });
    controller.invalidate();
    const current = controller.load({ workId: "new-work", pageIndex: 0 });
    pending[0]!.reject(new Error("old target error")); await old;
    expect(state.loading).toBe(true);
    expect(state.error).toBe("");
    pending[1]!.resolve(response(0)); await current;
    expect(state.workId).toBe("new-work");
    expect(state.pageIndex).toBe(0);
  });

  it("does not publish any result, failure, or loading completion after unmount", async () => {
    const { controller, pending, callbacks } = fixture();
    const first = controller.load({ pageIndex: 0 });
    const last = controller.load({ pageIndex: 1 });
    controller.invalidate();
    pending[0]!.resolve(response(0));
    pending[1]!.reject(new Error("closed drawer"));
    await Promise.all([first, last]);
    expect(callbacks.result).not.toHaveBeenCalled();
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(callbacks.settled).not.toHaveBeenCalled();
  });

  it("reports the current error and releases its loading state", async () => {
    const { controller, pending, state, callbacks } = fixture();
    const current = controller.load({ pageIndex: 2 });
    pending[0]!.reject(new Error("model unavailable")); await current;
    expect(state.loading).toBe(false);
    expect(state.error).toBe("model unavailable");
    expect(callbacks.failed).toHaveBeenCalledOnce();
    expect(callbacks.settled).toHaveBeenCalledOnce();
  });
});
