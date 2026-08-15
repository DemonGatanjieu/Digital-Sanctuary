# 04 — Human Physical Design Engineering

**Recommended activation:** Model Decision for motion/drag/page-turn work, or globs covering the relevant interaction and animation files

## Stable frames and contained motion

- Keep the outer frame, border, and shadow physically anchored unless the interaction explicitly moves the whole object.
- Animate leaves, tracks, images, or overlays inside a fixed viewport. Avoid implicit `transition: all` on structural containers.
- Preserve hit targets while visual children move; do not let transforms make controls hard to acquire.

## Natural momentum

- Use continuous position/velocity mapping and curves appropriate to the interaction. A useful slide baseline is `0.36s cubic-bezier(0.25, 1, 0.5, 1)`, but it is not a universal mandate.
- Drag release, snapping, and page settling must not jump, reverse unexpectedly, or stop with a harsh discontinuity.
- Angle calculations must unwrap the `0°/360°` boundary and preserve rotation direction.

## Compositor discipline

- Promote only hot moving layers that benefit from compositor isolation.
- Prefer an active-animation class for `will-change: transform, opacity`; remove or neutralize it after the motion finishes.
- Use `contain` only after confirming it does not break intrinsic sizing, overflow, sticky positioning, or accessibility.
- Do not promise “main thread zero blocking” or guaranteed 60/120 fps without measurement. Check frame stability, memory, and idle GPU usage.

## Transition-specific rules

- The 200%-wide dual-spread continuous track applies to the **slide page-turn effect**, where outgoing and incoming spreads move as one enclosed strip.
- It does not apply to the 3D leaf, fade, or deck-stack effects; each effect keeps its own rendering model behind one atomic spread state machine.
- Never expose the destination spread before the transition layer fully encloses it.
- Reduced-motion and Efficient display modes must degrade gracefully without leaving stale transition state or permanent compositor layers.
