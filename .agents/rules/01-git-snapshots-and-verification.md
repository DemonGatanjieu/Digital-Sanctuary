# 01. Mandatory Git Snapshots & Verification Gate

> 🔒 Dedicated Rule for Antigravity / Gemini Workspace Assistant in Digital Sanctuary (纯净领域).

---

## 1. Mandatory Git Snapshots Before & After Tasks
- **Pre-Task Snapshot**: Before performing any modifying code changes or launching experiments, ALWAYS execute `git add .` and `git commit -m "..."` to anchor the workspace baseline.
- **Milestone Snapshot**: Upon completing any feature, UI/UX adjustment, or bugfix, commit the atomic change with a descriptive conventional commit message.
- **Snapshot Ledger Synchronization**: Keep `docs/snapshots_record.md` updated with the snapshot name, commit hash, date, and core rationale.

---

## 2. Architecture Synchronization
- **Baseline Alignment**: Always read and adhere to `e:\PIxiv\ARCHITECTURE.md` before designing components.
- **Architectural Update**: Whenever introducing new modules, protocols, stores, or UI patterns, update `ARCHITECTURE.md` to reflect the active architectural truth.

---

## 3. Strict Verification Gate
- **Zero Regression Principle**: Always run `npm.cmd run verify` before completing any task.
  - Package TypeScript compilation (`build:core`)
  - Desktop client TypeScript compilation
  - Vitest test suite (all unit & integration tests must pass 100%)
  - Python vision test suite (`test:python` 100% pass)
  - Electron-Vite production build
