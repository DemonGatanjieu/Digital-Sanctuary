import { clipboard, type IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import {
  normalizePromptWorkspace,
  type PromptWorkspacePreferences
} from "@sanctuary/domain";

const PROMPT_PREFERENCE_PREFIX = "prompt.workspace.v2";
const LEGACY_PROMPT_PREFERENCE_PREFIX = "prompt.workspace.v1";

export function promptWorkspacePreferenceKey(engine: string, engineVersion: string): string {
  return `${PROMPT_PREFERENCE_PREFIX}:${normalizeIdentity(engine)}:${normalizeIdentity(engineVersion)}`;
}

export function registerPromptBridgeIpc(ipc: IpcMain, database: LibraryDatabase): void {
  ipc.handle("prompt-bridge:get-workspace", (_event, engineValue: unknown, versionValue: unknown): PromptWorkspacePreferences => {
    const [engine, engineVersion] = parseModelIdentity(engineValue, versionValue);
    const key = promptWorkspacePreferenceKey(engine, engineVersion);
    const current = database.getPreference<unknown>(key);
    if (current !== null) return normalizePromptWorkspace(current);

    const legacyKey = `${LEGACY_PROMPT_PREFERENCE_PREFIX}:${normalizeIdentity(engine)}:${normalizeIdentity(engineVersion)}`;
    const legacy = database.getPreference<unknown>(legacyKey);
    const migrated = normalizePromptWorkspace(legacy);
    if (legacy !== null) database.setPreference(key, migrated);
    return migrated;
  });

  ipc.handle("prompt-bridge:save-workspace", (_event, engineValue: unknown, versionValue: unknown, value: unknown): PromptWorkspacePreferences => {
    const [engine, engineVersion] = parseModelIdentity(engineValue, versionValue);
    const normalized = normalizePromptWorkspace(value);
    database.setPreference(promptWorkspacePreferenceKey(engine, engineVersion), normalized);
    return normalized;
  });

  ipc.handle("prompt-bridge:copy", (_event, value: unknown): boolean => {
    if (typeof value !== "string" || value.length > 100_000) throw new Error("Invalid prompt text");
    clipboard.writeText(value);
    return true;
  });
}

function parseModelIdentity(engineValue: unknown, versionValue: unknown): [string, string] {
  if (typeof engineValue !== "string" || typeof versionValue !== "string") {
    throw new Error("Invalid prompt model identity");
  }
  const engine = normalizeIdentity(engineValue);
  const version = normalizeIdentity(versionValue);
  if (!engine || !version) throw new Error("Invalid prompt model identity");
  return [engine, version];
}

function normalizeIdentity(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}
