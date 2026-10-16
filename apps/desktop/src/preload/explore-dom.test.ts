import { describe, expect, it, vi } from "vitest";
import {
  applyProtectionModeAttribute,
  hasUsableImageContainerBox,
  PROTECTION_MODE_ATTRIBUTE
} from "./explore-dom.js";

describe("explore preload DOM bootstrap", () => {
  it("waits safely when the document root does not exist yet", () => {
    expect(applyProtectionModeAttribute(null, true)).toBe(false);
  });

  it("writes the current protection mode once the document root exists", () => {
    const setAttribute = vi.fn();
    const root = { setAttribute } as unknown as HTMLElement;

    expect(applyProtectionModeAttribute(root, true)).toBe(true);
    expect(setAttribute).toHaveBeenLastCalledWith(PROTECTION_MODE_ATTRIBUTE, "on");

    expect(applyProtectionModeAttribute(root, false)).toBe(true);
    expect(setAttribute).toHaveBeenLastCalledWith(PROTECTION_MODE_ATTRIBUTE, "off");
  });
});

describe("explore image control container", () => {
  it("rejects Pixiv's connected zero-height lazy-image link", () => {
    const element = {
      isConnected: true,
      getBoundingClientRect: () => ({ width: 184, height: 0 })
    } as unknown as HTMLElement;

    expect(hasUsableImageContainerBox(element)).toBe(false);
  });

  it("accepts the first connected ancestor with a real card-sized box", () => {
    const element = {
      isConnected: true,
      getBoundingClientRect: () => ({ width: 184, height: 184 })
    } as unknown as HTMLElement;

    expect(hasUsableImageContainerBox(element)).toBe(true);
  });

  it("falls back to the card container box when a lazy image has zero height", async () => {
    const { measureEffectiveImagePriority } = await import("./explore-dom.js");
    const card = {
      isConnected: true,
      parentElement: null,
      getBoundingClientRect: () => ({ top: 120, left: 40, bottom: 304, right: 224, width: 184, height: 184 })
    } as unknown as HTMLElement;
    const zeroLink = {
      isConnected: true,
      parentElement: card,
      getBoundingClientRect: () => ({ top: 120, left: 40, bottom: 120, right: 224, width: 184, height: 0 })
    } as unknown as HTMLElement;
    const image = {
      isConnected: true,
      parentElement: zeroLink,
      closest: () => null,
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 })
    } as unknown as HTMLImageElement;

    expect(measureEffectiveImagePriority(image, 1280, 800)).toBe("visible");
  });
});

