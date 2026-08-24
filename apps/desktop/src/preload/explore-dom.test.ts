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
});
