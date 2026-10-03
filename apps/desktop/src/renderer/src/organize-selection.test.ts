import { describe, expect, it } from "vitest";
import { toggleTriageSelection, visibleTriageSelection } from "./organize-selection";

describe("organizer batch selection", () => {
  it("stays within the deletion IPC limit while allowing deselection and replacement", () => {
    const selected = new Set(Array.from({ length: 500 }, (_, index) => `work-${index}`));
    expect(toggleTriageSelection(selected, "work-500").has("work-500")).toBe(false);
    const reduced = toggleTriageSelection(selected, "work-0");
    const replaced = toggleTriageSelection(reduced, "work-500");
    expect(replaced.size).toBe(500);
    expect(replaced.has("work-500")).toBe(true);
    expect(replaced.has("work-0")).toBe(false);
    expect(selected.has("work-0")).toBe(true);
  });

  it("selects only displayed works and bounds larger visible result batches", () => {
    const ids = Array.from({ length: 550 }, (_, index) => `work-${index}`);
    expect([...visibleTriageSelection(ids, 40)]).toEqual(ids.slice(0, 40));
    expect([...visibleTriageSelection(ids, 520)]).toEqual(ids.slice(0, 500));
  });
});
