# Digital Sanctuary — Repository Agent Rules

These rules apply to every coding agent working in this repository. Gemini-specific rule routing lives in `GEMINI.md`; detailed design rules live in `.agents/rules/`.

## 1. Protect the workspace

- Before modifying files, read `ARCHITECTURE.md`, inspect `git status --short`, and record the current `HEAD`.
- A clean current `HEAD` is already a valid rollback anchor; do not create empty snapshot commits.
- If the tree is dirty, classify every change before staging. Commit a pre-task snapshot only when all staged changes are understood, safe, and belong to the user-approved workspace state.
- Never blindly stage secrets, credentials, user data, generated builds, caches, `.tmp/`, or unrelated edits. Never discard user changes with destructive Git commands.
- Use targeted staging (`git add -- <paths>`) for task commits. `git add .` is allowed only after confirming the entire tree is intentional and ignored files are correct.

## 2. Keep changes scoped and reversible

- Make the smallest coherent change that closes the requested workflow.
- Do not combine a bugfix with an unrelated visual redesign, dependency migration, or architecture rewrite.
- Preserve established security boundaries: sandboxed renderers, narrow IPC, validated local protocols, trusted-download semantics, and separation of exploration filtering from library analysis.
- Add or update focused tests for behavior changes and regression fixes.

## 3. Documentation truth

- Update `ARCHITECTURE.md` only when architectural truth changes: modules, protocols, persistence, security boundaries, major interaction systems, or supported capability sets.
- Small copy/CSS fixes do not require architecture churn.
- Record only stable milestones in `docs/snapshots_record.md`. Because a commit cannot contain its own final hash, add the milestone hash in a follow-up documentation commit.
- Archive completed implementation plans according to the existing plans workflow; do not leave an obsolete plan marked active.

## 4. Verification and completion

- Run focused checks while developing.
- Before declaring a modifying task complete, run the full gate from the repository root:

  `npm.cmd run verify`

- The gate must pass TypeScript compilation, Vitest, Python unittest, and the Electron-Vite production build.
- If a test requires GUI/GPU or permissions unavailable in the current sandbox, rerun it through the approved isolated path and report the exact result.
- After verification, create an atomic descriptive task commit unless the user explicitly asks to inspect changes before committing.
- Do not commit a knowingly failing state as a completed milestone.

## 5. Rule precedence

When local documents disagree:

1. Follow system safety constraints and the user's latest explicit request.
2. Follow this file for repository-wide workflow and safety.
3. Follow the relevant `.agents/rules/` file for domain-specific implementation details.
4. Use `ARCHITECTURE.md` as the architectural baseline and verify it against code/tests before correcting stale text.
