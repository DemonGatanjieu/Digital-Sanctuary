# 01 — Git Snapshots, Documentation, and Verification

**Recommended activation:** Always On

## Before a modifying task

1. Run `git status --short` and `git rev-parse --short HEAD`.
2. Read `ARCHITECTURE.md` and the user-named task document.
3. If the tree is clean, use the current `HEAD` as the rollback baseline; do not create an empty commit.
4. If the tree is dirty, identify ownership and purpose of every change:
   - known, safe workspace changes may be captured in a descriptive pre-task snapshot;
   - unknown, unrelated, generated, or sensitive files must not be staged;
   - if safe separation is impossible, stop and ask the user.

Do not use destructive reset/checkout commands to manufacture a clean tree.

## During the task

- Keep edits within the approved scope.
- Prefer targeted staging and focused tests.
- Do not overwrite another agent's or the user's unrelated work.
- Update architecture and plans only when their truth actually changes.

## Completion gate

1. Run focused regression tests for the changed subsystem.
2. Run `npm.cmd run verify` from the repository root.
3. Inspect `git diff --check`, `git diff`, and `git status --short`.
4. Commit the completed task atomically with a descriptive conventional message, unless the user requested pre-commit inspection.
5. For a stable milestone, append its final hash to `docs/snapshots_record.md` in a separate documentation commit.

Never describe a task as complete while required verification is failing.
