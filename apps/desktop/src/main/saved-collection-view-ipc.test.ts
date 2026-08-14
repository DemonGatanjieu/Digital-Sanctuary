import { describe, expect, it, vi } from "vitest";
import type { SavedCollectionView, SavedCollectionViewDraft } from "@sanctuary/domain";
import { parseSavedCollectionViewDraft, registerSavedCollectionViewIpc } from "./saved-collection-view-ipc.js";

describe("saved collection view IPC", () => {
  it("normalizes bounded drafts and removes include/exclude overlap", () => {
    expect(parseSavedCollectionViewDraft({
      name: "  Evening references  ",
      matchMode: "all",
      includedCollectionIds: ["a", "a", "b"],
      excludedCollectionIds: ["b", "c"]
    })).toEqual({
      name: "Evening references",
      matchMode: "all",
      includedCollectionIds: ["a", "b"],
      excludedCollectionIds: ["c"]
    });
  });

  it("rejects empty, malformed, and unbounded drafts", () => {
    expect(parseSavedCollectionViewDraft(null)).toBeNull();
    expect(parseSavedCollectionViewDraft({
      name: "Empty",
      matchMode: "any",
      includedCollectionIds: [],
      excludedCollectionIds: []
    })).toBeNull();
    expect(parseSavedCollectionViewDraft({
      name: "Wrong mode",
      matchMode: "none",
      includedCollectionIds: ["a"],
      excludedCollectionIds: []
    })).toBeNull();
    expect(parseSavedCollectionViewDraft({
      name: "Too many",
      matchMode: "any",
      includedCollectionIds: Array.from({ length: 51 }, (_, index) => String(index)),
      excludedCollectionIds: []
    })).toBeNull();
  });

  it("registers a small validated CRUD boundary", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const sample: SavedCollectionView = {
      id: "view-1",
      name: "Sample",
      matchMode: "any",
      includedCollectionIds: ["a"],
      excludedCollectionIds: [],
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z"
    };
    const database = {
      listSavedCollectionViews: vi.fn(() => [sample]),
      createSavedCollectionView: vi.fn((draft: SavedCollectionViewDraft) => ({ ...sample, ...draft })),
      updateSavedCollectionView: vi.fn((_id: string, draft: SavedCollectionViewDraft) => ({ ...sample, ...draft })),
      deleteSavedCollectionView: vi.fn(() => true)
    };
    registerSavedCollectionViewIpc(
      { handle: ((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) } as never,
      database
    );

    expect([...handlers.keys()]).toEqual([
      "saved-collection-views:list",
      "saved-collection-views:create",
      "saved-collection-views:update",
      "saved-collection-views:delete"
    ]);
    const validDraft = {
      name: "Sample",
      matchMode: "any",
      includedCollectionIds: ["a"],
      excludedCollectionIds: []
    } satisfies SavedCollectionViewDraft;
    expect(handlers.get("saved-collection-views:create")?.({}, validDraft)).toMatchObject(validDraft);
    expect(() => handlers.get("saved-collection-views:create")?.({}, {})).toThrow("Invalid saved collection view");
    expect(handlers.get("saved-collection-views:delete")?.({}, "view-1")).toBe(true);
  });
});
