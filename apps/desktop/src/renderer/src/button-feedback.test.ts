import { afterEach, describe, expect, it, vi } from "vitest";
import { animateButtonClick, buttonFeedbackDuration } from "./button-feedback";

afterEach(() => vi.unstubAllGlobals());
describe("brief button feedback", () => {
  it("respects efficient, app reduced motion and system reduced motion independently", () => {
    expect(buttonFeedbackDuration("balanced", false, false)).toBe(150);
    expect(buttonFeedbackDuration("quality", false, false)).toBe(190);
    expect(buttonFeedbackDuration("efficient", false, false)).toBe(0);
    expect(buttonFeedbackDuration("quality", true, false)).toBe(0);
    expect(buttonFeedbackDuration("balanced", false, true)).toBe(0);
  });
  function fixture({ disabled = false, reduced = false, systemReduced = false, recognized = true, portal = false } = {}) {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, finished: new Promise<void>(() => {}) }));
    const shell = { dataset: { displayProfile: "balanced", reducedMotion: String(reduced) } };
    class ElementFixture {
      disabled = disabled;
      matches = () => recognized;
      getAttribute = () => null;
      animate = animate;
      closest = (selector: string): unknown => selector === "button" ? this : portal ? null : shell;
    }
    vi.stubGlobal("Element", ElementFixture);
    vi.stubGlobal("document", { querySelector: () => shell });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: systemReduced }) });
    return { target: new ElementFixture() as unknown as Element, animate, cancel };
  }
  it("starts a brief independent-scale animation without moving layout", () => {
    const f = fixture(); animateButtonClick(f.target);
    expect(f.animate).toHaveBeenCalledWith([{ scale: "0.975" }, { scale: "1" }], expect.objectContaining({ duration: 150 }));
  });
  it("replaces rapid repeat feedback instead of accumulating animations", () => {
    const f = fixture(); animateButtonClick(f.target); animateButtonClick(f.target);
    expect(f.cancel).toHaveBeenCalledOnce(); expect(f.animate).toHaveBeenCalledTimes(2);
  });
  it("keeps disabled and non-control image surfaces still", () => {
    const disabled = fixture({ disabled: true }); animateButtonClick(disabled.target); expect(disabled.animate).not.toHaveBeenCalled();
    const image = fixture({ recognized: false }); animateButtonClick(image.target); expect(image.animate).not.toHaveBeenCalled();
  });
  it("honors motion preferences for dialogs rendered outside the app shell", () => {
    const f = fixture({ reduced: true, portal: true }); animateButtonClick(f.target); expect(f.animate).not.toHaveBeenCalled();
    const g = fixture({ systemReduced: true }); animateButtonClick(g.target); expect(g.animate).not.toHaveBeenCalled();
  });
});
