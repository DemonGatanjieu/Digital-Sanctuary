import { describe, expect, it, vi } from "vitest";
import {
  adjacentViewerPreloads, anchoredViewerPan, cinemaKeyboardAction, clampViewerPan,
  createViewerFrameScheduler, nativePixelZoom, wheelViewerZoom
} from "./cinema-viewer";

describe("cinema viewport geometry", () => {
  it("uses actual image pixels and fitted CSS width for 1:1 instead of a fixed 2x", () => {
    expect(nativePixelZoom(3600, 900)).toBe(4);
    expect(nativePixelZoom(320, 320)).toBe(1);
    expect(nativePixelZoom(0, 0)).toBe(1);
  });

  it("keeps the pixel beneath the cursor anchored when wheel zooming", () => {
    const pan = { x: 10, y: -20 };
    const anchor = { x: 100, y: 80 };
    const nextPan = anchoredViewerPan(pan, 1, 2, anchor);
    expect(nextPan).toEqual({ x: -80, y: -120 });
    expect((anchor.x - nextPan.x) / 2).toBe(anchor.x - pan.x);
    expect((anchor.y - nextPan.y) / 2).toBe(anchor.y - pan.y);
  });

  it("contains dragging to the enlarged image and recenters when returning to fit", () => {
    const geometry = { imageWidth: 800, imageHeight: 400, stageWidth: 1000, stageHeight: 600 };
    expect(clampViewerPan({ x: 1000, y: -1000 }, 2, geometry)).toEqual({ x: 300, y: -100 });
    expect(clampViewerPan({ x: 30, y: 80 }, 0.75, geometry)).toEqual({ x: 0, y: 0 });
    expect(clampViewerPan({ x: 30, y: 80 }, 1.1, geometry)).toEqual({ x: 0, y: 0 });
  });

  it("normalizes line/pixel wheels and allows a genuine large-image native scale", () => {
    expect(wheelViewerZoom(2, 1, 1, 5)).toBe(wheelViewerZoom(2, 16, 0, 5));
    expect(wheelViewerZoom(0.5, 1000, 0, 5)).toBe(0.5);
    expect(wheelViewerZoom(5, -1000, 0, 5)).toBe(5);
    expect(wheelViewerZoom(8, -1000, 0, 8)).toBe(8);
    expect(wheelViewerZoom(1, 0, 0, 5)).toBe(1);
  });
});

describe("cinema keyboard ownership", () => {
  const resolve = (key: string, overrides = {}) => cinemaKeyboardAction({ key, editable: false, suspended: false, modified: false, ...overrides });

  it.each(["ArrowLeft", "ArrowRight", "Home", "End", "0", "1", "+", "-"])("does not steal %s from an editor or nested overlay", (key) => {
    expect(resolve(key, { editable: true })).toBe("none");
    expect(resolve(key, { suspended: true })).toBe("none");
    expect(resolve(key, { modified: true })).toBe("none");
  });

  it("offers first/last, native pixels and fit consistently through both entry points", () => {
    expect(resolve("Home")).toBe("first");
    expect(resolve("End")).toBe("last");
    expect(resolve("1")).toBe("native");
    expect(resolve("R")).toBe("fit");
    expect(resolve("Escape")).toBe("close");
    expect(resolve("Escape", { suspended: true })).toBe("none");
  });
});

describe("bounded image and frame work", () => {
  it("only preloads two immediate neighbors, deduplicates paths and skips huge originals", () => {
    const pages = Array.from({ length: 500 }, (_, index) => ({ url: `local/${index}`, width: 1200, height: 1800, byteLength: 2_000_000 }));
    expect(adjacentViewerPreloads(pages, 250)).toEqual(["local/251", "local/249"]);
    expect(adjacentViewerPreloads(pages, 0)).toEqual(["local/1"]);
    expect(adjacentViewerPreloads(pages, 499)).toEqual(["local/498"]);
    pages[251] = { url: "local/251", width: 10000, height: 10000, byteLength: 2_000_000 };
    pages[249] = { url: "local/249", width: 1200, height: 1800, byteLength: 33 * 1024 * 1024 };
    expect(adjacentViewerPreloads(pages, 250)).toEqual([]);
    expect(adjacentViewerPreloads([{ url: "same" }, { url: "current" }, { url: "same" }], 1)).toEqual(["same"]);
  });

  it("coalesces pointer events into one paint per frame and cancels pending work on exit", () => {
    let scheduled: (() => void) | undefined;
    const request = vi.fn((paint: () => void) => { scheduled = paint; return 42; });
    const paint = vi.fn();
    const cancel = vi.fn();
    const scheduler = createViewerFrameScheduler(paint, request, cancel);
    for (let event = 0; event < 100; event++) scheduler.schedule();
    expect(request).toHaveBeenCalledTimes(1);
    expect(paint).not.toHaveBeenCalled();
    scheduled?.();
    expect(paint).toHaveBeenCalledTimes(1);
    scheduler.schedule();
    expect(request).toHaveBeenCalledTimes(2);
    scheduler.cancel();
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
