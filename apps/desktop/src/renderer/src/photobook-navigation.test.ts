import { describe, expect, it } from "vitest";
import {
  getPhotobookArtworkIndex,
  getPhotobookSpreadForArtworkIndex,
  getPhotobookTotalSpreads,
  normalizePhotoMountStyle,
  photobookNeighborIndices,
  resolvePhotobookKeyboardAction
} from "./photobook-navigation";

describe("photobook page mapping", () => {
  it("preloads only neighboring spreads, including cover and odd final pages", () => {
    expect(photobookNeighborIndices(0, 0)).toEqual([]);
    expect(photobookNeighborIndices(0, 1)).toEqual([]);
    expect(photobookNeighborIndices(0, 4)).toEqual([1, 2]);
    expect(photobookNeighborIndices(1, 4)).toEqual([3, 0]);
    expect(photobookNeighborIndices(100, 10_000)).toEqual([201, 202, 197, 198]);
  });
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4]
  ])("maps %i artworks to %i spreads", (itemCount, spreads) => {
    expect(getPhotobookTotalSpreads(itemCount)).toBe(spreads);
  });

  it("keeps the cover on the first recto and pairs later artworks", () => {
    expect(getPhotobookArtworkIndex(0, "left", 4)).toBeNull();
    expect(getPhotobookArtworkIndex(0, "right", 4)).toBe(0);
    expect(getPhotobookArtworkIndex(1, "left", 4)).toBe(1);
    expect(getPhotobookArtworkIndex(1, "right", 4)).toBe(2);
    expect(getPhotobookArtworkIndex(2, "left", 4)).toBe(3);
    expect(getPhotobookArtworkIndex(2, "right", 4)).toBeNull();
  });

  it("maps table-of-contents artwork indices back to the right spread", () => {
    expect([0, 1, 2, 3, 4, 5].map(getPhotobookSpreadForArtworkIndex)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe("photobook keyboard routing", () => {
  const resolve = (overrides: Partial<Parameters<typeof resolvePhotobookKeyboardAction>[0]> = {}) =>
    resolvePhotobookKeyboardAction({
      key: "",
      code: "",
      targetIsEditable: false,
      interactionSuspended: false,
      tocOpen: false,
      ...overrides
    });

  it("uses KeyboardEvent.code for letter shortcuts", () => {
    expect(resolve({ key: "d", code: "KeyD" })).toBe("next");
    expect(resolve({ key: "a", code: "KeyA" })).toBe("previous");
    expect(resolve({ key: "t", code: "KeyT" })).toBe("toggle-toc");
    expect(resolve({ key: "m", code: "KeyM" })).toBe("toggle-toc");
  });

  it("supports arrows, space, and Home", () => {
    expect(resolve({ key: "ArrowRight" })).toBe("next");
    expect(resolve({ key: "ArrowLeft" })).toBe("previous");
    expect(resolve({ key: " " })).toBe("next");
    expect(resolve({ key: "Home" })).toBe("home");
  });

  it("does not hijack typing, nested overlays, or an open TOC", () => {
    expect(resolve({ key: "t", code: "KeyT", targetIsEditable: true })).toBe("none");
    expect(resolve({ key: "ArrowRight", interactionSuspended: true })).toBe("none");
    expect(resolve({ key: "ArrowRight", tocOpen: true })).toBe("none");
  });
});

describe("photo mount preference", () => {
  it("falls back safely when local storage contains a stale value", () => {
    expect(normalizePhotoMountStyle("washi-tape")).toBe("washi-tape");
    expect(normalizePhotoMountStyle("future-style")).toBe("corners");
    expect(normalizePhotoMountStyle(null)).toBe("corners");
  });
});
