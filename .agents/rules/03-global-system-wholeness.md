# 03 — Global System Wholeness and End-to-End Cohesion

**Recommended activation:** Model Decision for gallery, album, artist, lightbox, search, theme, and batch-operation tasks

## Close the whole requested loop

A local implementation must not leave the same entity behaving differently through another supported entry point. Check the affected path from entry, state change, persistence, feedback, error handling, and return navigation.

## Core interaction matrix

1. **Flat Gallery**
   - Cards, work/page grouping, album assignment, selection/batch actions, feedback, and supported undo behavior.
2. **Albums and Artbooks**
   - Cover shelf, preface, TOC, grid and photobook modes, in-album picker, cover assignment, empty/odd/single-page cases.
   - Keep the two independent preference families explicit: **4 photo mounting styles** and **4 page-turn effects**.
3. **Author Detail**
   - Author navigation, work grouping, album assignment, avatar fallback, and lightbox entry.
4. **Cinema Lightbox**
   - Every entry point must use the same zero-crop viewer, zoom/pan, keyboard navigation, and multi-page filmstrip semantics.
5. **Search and Saved Views**
   - Query state, AND/OR/NOT collection logic, counts, pagination, empty states, and return navigation must agree.

## Nested interaction ownership

- The topmost dialog, drawer, picker, or lightbox owns `Escape`, arrows, wheel, and typing while open.
- Background screens must suspend conflicting shortcuts and expensive interactions.
- Async batch actions must be bounded, await completion correctly, expose partial failure, and avoid stale-state overwrites.
- Interactive hit targets should generally be at least 36–44 px without visually inflating the control.

Test the affected entry points; do not rewrite every subsystem when only one shared boundary needs correction.
