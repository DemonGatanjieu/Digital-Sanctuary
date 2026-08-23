import { describe, expect, it, vi } from "vitest";
import { applyProtectionModeAttribute, PROTECTION_MODE_ATTRIBUTE } from "./explore-dom.js";

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
