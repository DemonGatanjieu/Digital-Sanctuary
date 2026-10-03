import { describe, expect, it, vi } from "vitest";
import { bindDetailScroll, captureDetailScroll, detailPageAttributes, restoreDetailScroll } from "./detail-scroll";
import { capturePageAnchor, type ScrollPosition } from "./gallery-detail-session";
import type { ScopedArtworkRecord } from "@sanctuary/domain";

const pages = Array.from({ length: 8 }, (_, index) => ({ id: `legacy:${index}`, assetId: `asset:${index}` }));

function surface(items = pages, rowHeight = 100, columns = 1) {
  class Scroller extends EventTarget {
    scrollTop = 0; scrollHeight = 2_000; clientHeight = 300; clientTop = 2; offsetHeight = 304; isConnected = true;
    scale = 1; layoutShift = 0;
    getBoundingClientRect() { return { top: 100, height: this.offsetHeight * this.scale }; }
    scrollTo({ top }: { top: number }) { this.scrollTop = top; }
  }
  const owner = new Scroller();
  const nodes = items.map((item, index) => ({ dataset: { galleryPageId: item.assetId, galleryPageKind: "asset" },
    getBoundingClientRect: () => ({ top: 100 + (2 + Math.floor(index / columns) * rowHeight + owner.layoutShift - owner.scrollTop) * owner.scale }) }));
  const content = { isConnected: true, querySelectorAll: () => nodes };
  return { owner, container: owner as unknown as HTMLElement, content: content as unknown as HTMLElement, nodes };
}

function frames() {
  let sequence = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return { request: (callback: FrameRequestCallback) => { callbacks.set(++sequence, callback); return sequence; },
    cancel: (id: number) => { callbacks.delete(id); }, run() { const current = [...callbacks.values()]; callbacks.clear(); for (const callback of current) callback(0); } };
}

describe("detail scroll anchors", () => {
  it("captures the first cell of a partially visible grid row and restores it after the grid changes columns", () => {
    const original = surface(pages, 100, 2); original.owner.scrollTop = 175;
    const position = captureDetailScroll(original.container, original.content, pages);
    expect(position.anchor?.current?.assetId).toBe("asset:2"); expect(position.offsetPx).toBe(-75);
    const changed = surface(pages, 100, 1);
    restoreDetailScroll(changed.container, changed.content, pages, position);
    expect(changed.owner.scrollTop).toBe(275);
    expect(changed.nodes[2]!.getBoundingClientRect().top - 102).toBe(position.offsetPx);
  });

  it("keeps an asset in place after earlier pages are inserted and uses a surviving neighbor after deletion", () => {
    const original = surface(); original.owner.scrollTop = 250;
    const position = captureDetailScroll(original.container, original.content, pages);
    const inserted = [{ id: "new", assetId: "asset:new" }, ...pages], changed = surface(inserted);
    restoreDetailScroll(changed.container, changed.content, inserted, position);
    expect(changed.owner.scrollTop).toBe(350);
    const removed = pages.filter((item) => item.assetId !== position.anchor?.current?.assetId), afterDelete = surface(removed);
    restoreDetailScroll(afterDelete.container, afterDelete.content, removed, position);
    expect(afterDelete.owner.scrollTop).toBe(150);
  });

  it("stores CSS pixel offsets during an entry scale and restores correctly under a different scale", () => {
    const original = surface(); original.owner.scale = 0.985; original.owner.scrollTop = 250;
    const position = captureDetailScroll(original.container, original.content, pages);
    expect(position.offsetPx).toBeCloseTo(-50, 8);
    const returning = surface(); returning.owner.scale = 0.991;
    restoreDetailScroll(returning.container, returning.content, pages, position);
    expect(returning.owner.scrollTop).toBeCloseTo(250, 8);
    returning.owner.scale = 1;
    expect(captureDetailScroll(returning.container, returning.content, pages).offsetPx).toBeCloseTo(-50, 8);
  });

  it("clamps raw positions when there are no page rows and uses only real IDs for DOM attributes", () => {
    const view = surface([]); view.owner.scrollHeight = 350;
    restoreDetailScroll(view.container, view.content, [], { anchor: null, offsetPx: 0, scrollTop: 1_000 });
    expect(view.owner.scrollTop).toBe(50);
    expect(detailPageAttributes({ id: "real-page", assetId: "real-asset", path: "never-saved" } as ScopedArtworkRecord))
      .toEqual({ "data-gallery-page-id": "real-asset", "data-gallery-page-kind": "asset" });
    expect(captureDetailScroll(view.container, view.content, [])).toEqual({ anchor: null, offsetPx: 0, scrollTop: 50 });
  });
});

describe("detail scroll restoration ownership", () => {
  const saved: ScrollPosition = { anchor: capturePageAnchor(pages, 3), offsetPx: -20, scrollTop: 320 };

  it("preserves the saved intention when leaving before the restore frame, and cancels the old frame", () => {
    const view = surface(), scheduler = frames(), publish = vi.fn();
    const binding = bindDetailScroll(view.container, view.content, pages, saved, publish, scheduler);
    expect(binding.capture()).toEqual(saved);
    binding.dispose(); scheduler.run();
    expect(view.owner.scrollTop).toBe(0); expect(publish).not.toHaveBeenCalled();
  });

  it("does not mistake an unchanged queued layout scroll for user movement", () => {
    const view = surface(), scheduler = frames();
    const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
    view.owner.dispatchEvent(new Event("scroll")); scheduler.run();
    expect(view.owner.scrollTop).toBe(320); binding.dispose();
  });

  it("lets a wheel or a direct user scroll cancel deferred restoration", () => {
    for (const action of ["wheel", "scroll"]) {
      const view = surface(), scheduler = frames();
      const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
      view.owner.scrollTop = 475; view.owner.dispatchEvent(new Event(action)); scheduler.run();
      expect(view.owner.scrollTop).toBe(475); expect(binding.capture().scrollTop).toBe(475); binding.dispose();
    }
  });

  it("keeps a pending saved position when a control is clicked, touched, or activated with its own keyboard action", () => {
    for (const type of ["pointerdown", "touchstart", "keydown"]) {
      const view = surface(), scheduler = frames();
      const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
      const event = new Event(type);
      Object.defineProperties(event, { target: { value: { closest: () => ({}) } }, key: { value: " " } });
      view.owner.dispatchEvent(event);
      expect(binding.capture()).toEqual(saved); scheduler.run(); expect(view.owner.scrollTop).toBe(320); binding.dispose();
    }
  });

  it("ignores claimed or composing keys but allows scrollbar pointer and background scroll keys to cancel", () => {
    for (const guard of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }]) {
      const view = surface(), scheduler = frames();
      const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
      const event = new Event("keydown");
      for (const [property, value] of Object.entries({ key: "Home", ...guard })) Object.defineProperty(event, property, { value });
      view.owner.dispatchEvent(event); expect(binding.capture()).toEqual(saved); binding.dispose();
    }
    for (const type of ["pointerdown", "touchstart", "keydown"]) {
      const view = surface(), scheduler = frames();
      const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
      const event = new Event(type); Object.defineProperty(event, "key", { value: "PageDown" });
      view.owner.dispatchEvent(event); expect(binding.capture().scrollTop).toBe(0); scheduler.run();
      expect(view.owner.scrollTop).toBe(0); binding.dispose();
    }
  });

  it("synchronously captures a final scroll even when the browser has not delivered its scroll event", () => {
    const view = surface(), scheduler = frames();
    const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
    scheduler.run(); view.owner.scrollTop = 465;
    expect(binding.capture()).toMatchObject({ scrollTop: 465, anchor: { current: { assetId: "asset:4" } }, offsetPx: -65 });
    binding.dispose();
  });

  it("restores the short-window book canvas by raw scroll position without anchoring its temporary book or TOC DOM", () => {
    const view = surface(), scheduler = frames();
    const position = { anchor: null, offsetPx: 0, scrollTop: 240 };
    const binding = bindDetailScroll(view.container, view.content, [], position, () => undefined, scheduler);
    scheduler.run(); scheduler.run(); scheduler.run(); expect(view.owner.scrollTop).toBe(240);
    view.owner.scrollTop = 385;
    expect(binding.capture()).toEqual({ anchor: null, offsetPx: 0, scrollTop: 385 }); binding.dispose();
  });

  it("rechecks a materialized row for at most three frames without canceling on its own scroll events", () => {
    const view = surface(), scheduler = frames();
    const write = vi.spyOn(view.owner, "scrollTo");
    const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
    scheduler.run(); expect(view.owner.scrollTop).toBe(320);
    view.owner.layoutShift = 24; view.owner.scrollHeight -= 40;
    view.owner.scrollTop = 300; view.owner.dispatchEvent(new Event("scroll"));
    scheduler.run(); expect(view.owner.scrollTop).toBe(344);
    view.owner.dispatchEvent(new Event("scroll")); scheduler.run(); scheduler.run(); scheduler.run();
    expect(write).toHaveBeenCalledTimes(3);
    expect(binding.capture()).toMatchObject({ anchor: { current: { assetId: "asset:3" } }, offsetPx: -20 });
    binding.dispose();
  });

  it("lets new user input cancel verification after the first restore frame", () => {
    const view = surface(), scheduler = frames();
    const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
    scheduler.run(); view.owner.scrollTop = 465; view.owner.dispatchEvent(new Event("wheel"));
    scheduler.run(); scheduler.run(); expect(view.owner.scrollTop).toBe(465); binding.dispose();
  });

  it("indexes DOM rows once, then captures scrolling without enumerating the scope every frame", () => {
    const view = surface(), scheduler = frames();
    const enumerate = vi.spyOn(view.content, "querySelectorAll");
    const binding = bindDetailScroll(view.container, view.content, pages, saved, () => undefined, scheduler);
    scheduler.run();
    for (const top of [125, 255, 365, 475]) {
      view.owner.scrollTop = top; view.owner.dispatchEvent(new Event("scroll")); scheduler.run(); binding.capture();
    }
    expect(enumerate).toHaveBeenCalledOnce(); expect(binding.capture().scrollTop).toBe(475); binding.dispose();
  });

  it("does not publish an old binding over a newly rendered mode or deletion fallback", () => {
    const old = surface(), scheduler = frames(), publish = vi.fn();
    const binding = bindDetailScroll(old.container, old.content, pages, saved, publish, scheduler);
    scheduler.run(); old.owner.scrollTop = 600;
    binding.dispose(); scheduler.run(); expect(publish).not.toHaveBeenCalled();
    const remaining = pages.filter((item) => item.assetId !== "asset:3"), next = surface(remaining);
    const latest = bindDetailScroll(next.container, next.content, remaining, saved, publish, scheduler);
    scheduler.run(); expect(latest.capture().anchor?.current?.assetId).toBe("asset:2");
    latest.dispose();
  });
});
