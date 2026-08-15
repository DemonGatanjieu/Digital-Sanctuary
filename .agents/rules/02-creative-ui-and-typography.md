# 02 — Creative UI and Typography

**Recommended activation:** Model Decision, or globs covering renderer UI/style/theme/typography files

## Visual direction

- Avoid generic Bootstrap/Tailwind-dashboard aesthetics and unconsidered engineer-default controls.
- Build a calm, premium fine-art environment in which surrounding surfaces support the artwork instead of competing with it.
- Use glass, gradients, shadows, stacked paper, acrylic islands, and micro-motion only when they clarify hierarchy or interaction. Do not apply every visual effect to every component.
- Reuse design tokens and existing shared controls before adding one-off colors, radii, shadows, or button systems.
- Preserve clear hover, active, disabled, busy, focus-visible, empty, error, and reduced-motion states.

## Typography integrity

- Use the existing semantic font tokens and the controlled `sanctuary-font://` protocol. Never load arbitrary local paths directly in the renderer.
- Preserve CJK/Latin fallback metrics, readable line height, truncation behavior, and layout stability under custom fonts.
- Check narrow-window wrapping, long Chinese titles, mixed-language metadata, and button labels.

## Scope discipline

- Do not restyle unrelated screens during a focused UI bugfix.
- Do not replace established component behavior merely to achieve a screenshot.
- Verify the relevant display profiles, themes, keyboard focus, and at least one narrow viewport when a shared visual primitive changes.
