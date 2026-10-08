const FEEDBACK_BUTTONS = ".ui-button, .home-task-card, .nav-item, .sidebar-quick-actions, .sidebar-task-entry, .settings-disclosure-toggle, .workspace-navigation button, .settings-navigation button";
const activeFeedback = new WeakMap<HTMLButtonElement, Animation>();

export function buttonFeedbackDuration(profile: string | undefined, reducedMotion: boolean, systemReducedMotion: boolean): number {
  if (profile === "efficient" || reducedMotion || systemReducedMotion) return 0;
  return profile === "quality" ? 190 : 150;
}

/** Decorative only: no React state, event interception, delay, layout reads or timers. */
export function animateButtonClick(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>("button");
  if (!button || !button.matches(FEEDBACK_BUTTONS) || button.disabled || button.getAttribute("aria-disabled") === "true") return;
  const shell = button.closest<HTMLElement>(".app-shell") ?? document.querySelector<HTMLElement>(".app-shell");
  const duration = buttonFeedbackDuration(shell?.dataset.displayProfile, shell?.dataset.reducedMotion === "true",
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  activeFeedback.get(button)?.cancel();
  activeFeedback.delete(button);
  if (!duration || typeof button.animate !== "function") return;
  // Individual scale preserves the existing hover translation and never moves surrounding controls.
  const animation = button.animate([{ scale: "0.975" }, { scale: "1" }], { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
  activeFeedback.set(button, animation);
  void animation.finished.then(() => {
    if (activeFeedback.get(button) === animation) activeFeedback.delete(button);
  }, () => { /* Cancellation is expected when clicking again or leaving the page. */ });
}
