import { describe, expect, it } from "vitest";
import { normalizeWindowState } from "./window-state.js";

const display = { x: 0, y: 0, width: 1920, height: 1040 };

describe("normalizeWindowState", () => {
  it("keeps a visible state and clamps it to the work area", () => {
    expect(normalizeWindowState({ x: 1700, y: 900, width: 1400, height: 900, maximized: false }, [display]))
      .toEqual({ x: 520, y: 140, width: 1400, height: 900, maximized: false });
  });

  it("rejects invalid or disconnected display coordinates", () => {
    expect(normalizeWindowState({ x: 8000, y: 5000, width: 1200, height: 800, maximized: false }, [display])).toBeNull();
    expect(normalizeWindowState({ x: 0, y: 0, width: "wide", height: 800, maximized: false }, [display])).toBeNull();
  });
});
