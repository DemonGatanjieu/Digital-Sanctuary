# Digital Sanctuary — Gemini / Antigravity Workspace Entry

This file is the concise entry point for Gemini and Antigravity. It does not duplicate the full workspace policy.

## Session bootstrap

Before changing files:

1. Read `AGENTS.md` for repository-wide safety, Git, documentation, and verification rules.
2. Read `ARCHITECTURE.md` for the current product and module boundaries.
3. Read the active task document when the user names one.
4. Apply the relevant workspace rules from `.agents/rules/` according to the routing table below.

Antigravity discovers `.agents/rules/` as workspace rules. Gemini CLI users must explicitly read the relevant rule files. Do not copy these rules back into this file.

## Rule routing

| Rule | Intended activation | Applies to |
| --- | --- | --- |
| `01-git-snapshots-and-verification.md` | Always On | Every modifying task |
| `02-creative-ui-and-typography.md` | Model Decision / renderer globs | UI, CSS, themes, typography |
| `03-global-system-wholeness.md` | Model Decision | Gallery, albums, artists, lightbox, search, batch actions |
| `04-human-physical-design-engineering.md` | Model Decision / animation globs | Motion, drag, page turns, tracks, compositor work |

## Operating priorities

- The user's latest explicit request defines the task scope.
- Preserve unrelated user changes and never widen a bugfix into an unsolicited redesign.
- Treat executable code, database migrations, and passing tests as runtime truth. When documentation disagrees, investigate and then update the stale document.
- A plan is not authorization to implement unrelated phases. Complete the requested phase and report residual work separately.
- Do not claim completion until the required verification gate has passed.

## Handoff format

At the end of a modifying task, report:

- what changed and why;
- which end-to-end paths were checked;
- verification results;
- the resulting commit or any intentionally uncommitted files;
- known limitations that remain.
