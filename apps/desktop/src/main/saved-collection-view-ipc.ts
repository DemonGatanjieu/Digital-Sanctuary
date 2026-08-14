import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { SavedCollectionViewDraft } from "@sanctuary/domain";
import { parseWorkId, parseWorkIds } from "../shared/library-query.js";

type SavedCollectionViewDatabase = Pick<
  LibraryDatabase,
  | "listSavedCollectionViews"
  | "createSavedCollectionView"
  | "updateSavedCollectionView"
  | "deleteSavedCollectionView"
>;

export function registerSavedCollectionViewIpc(
  ipc: Pick<IpcMain, "handle">,
  database: SavedCollectionViewDatabase
): void {
  ipc.handle("saved-collection-views:list", () => database.listSavedCollectionViews());
  ipc.handle("saved-collection-views:create", (_event, value: unknown) => {
    const draft = parseSavedCollectionViewDraft(value);
    if (!draft) throw new Error("Invalid saved collection view");
    return database.createSavedCollectionView(draft);
  });
  ipc.handle("saved-collection-views:update", (_event, value: unknown, draftValue: unknown) => {
    const id = parseWorkId(value);
    const draft = parseSavedCollectionViewDraft(draftValue);
    if (!id || !draft) throw new Error("Invalid saved collection view update");
    return database.updateSavedCollectionView(id, draft);
  });
  ipc.handle("saved-collection-views:delete", (_event, value: unknown) => {
    const id = parseWorkId(value);
    if (!id) throw new Error("Invalid saved collection view id");
    return database.deleteSavedCollectionView(id);
  });
}

export function parseSavedCollectionViewDraft(value: unknown): SavedCollectionViewDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof SavedCollectionViewDraft, unknown>>;
  if (
    typeof candidate.name !== "string" ||
    (candidate.matchMode !== "all" && candidate.matchMode !== "any")
  ) return null;
  const name = candidate.name.trim();
  const includedCollectionIds = parseCollectionIds(candidate.includedCollectionIds);
  const excludedCollectionIds = parseCollectionIds(candidate.excludedCollectionIds);
  if (
    !name ||
    name.length > 80 ||
    !includedCollectionIds ||
    !excludedCollectionIds ||
    (includedCollectionIds.length === 0 && excludedCollectionIds.length === 0)
  ) return null;
  const included = new Set(includedCollectionIds);
  return {
    name,
    matchMode: candidate.matchMode,
    includedCollectionIds,
    excludedCollectionIds: excludedCollectionIds.filter((id) => !included.has(id))
  };
}

function parseCollectionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  if (value.length === 0) return [];
  return parseWorkIds(value, 50);
}
