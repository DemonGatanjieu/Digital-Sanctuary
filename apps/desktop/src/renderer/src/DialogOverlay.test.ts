import { describe, expect, it, vi } from "vitest";
import { handleDialogEscape } from "./DialogOverlay.js";

function escape(change: Partial<Parameters<typeof handleDialogEscape>[0]> = {}) {
  const event = {
    key: "Escape", defaultPrevented: false, isComposing: false, keyCode: 27,
    preventDefault: vi.fn(() => { event.defaultPrevented = true; }), stopImmediatePropagation: vi.fn(),
    ...change
  };
  return event;
}

describe("shared dialog Escape ownership", () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])("leaves the IME's candidate cancellation available for %j", (change) => {
    const event = escape(change); const onClose = vi.fn();
    expect(handleDialogEscape(event, { topmost: true, busy: false, onClose })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("does not close a parent dialog after an input or inner dialog already handled Escape", () => {
    const event = escape({ defaultPrevented: true }); const onClose = vi.fn();
    expect(handleDialogEscape(event, { topmost: true, busy: false, onClose })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only the topmost dialog regardless of window listener registration order", () => {
    const event = escape(); const outerClose = vi.fn(); const innerClose = vi.fn();
    expect(handleDialogEscape(event, { topmost: false, busy: false, onClose: outerClose })).toBe(false);
    expect(handleDialogEscape(event, { topmost: true, busy: false, onClose: innerClose })).toBe(true);
    // Even if the inner dialog disappears immediately, the consumed event cannot close its parent.
    expect(handleDialogEscape(event, { topmost: true, busy: false, onClose: outerClose })).toBe(false);
    expect(outerClose).not.toHaveBeenCalled(); expect(innerClose).toHaveBeenCalledTimes(1);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it("keeps the topmost busy dialog open without passing Escape to a background dialog", () => {
    const event = escape(); const onClose = vi.fn();
    expect(handleDialogEscape(event, { topmost: true, busy: true, onClose })).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });
});
