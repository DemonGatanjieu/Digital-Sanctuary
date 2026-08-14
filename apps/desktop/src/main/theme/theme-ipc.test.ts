import { describe, expect, it, vi } from "vitest";
import { parseThemeId, registerThemeIpc } from "./theme-ipc.js";

describe("theme IPC", () => {
  it("validates theme ids before they cross service boundaries", () => {
    expect(parseThemeId("author.theme-1")).toBe("author.theme-1");
    expect(() => parseThemeId("../theme")).toThrow("Invalid theme id");
  });

  it("registers local and store handlers with bounded event output", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const emitThemeChanged = vi.fn();
    const emitDownloadProgress = vi.fn();
    const manager = {
      getInstalledThemes: vi.fn(async () => []),
      getActiveTheme: vi.fn(async () => ({ themeId: "default", cssContent: "" })),
      setActiveTheme: vi.fn(async (themeId: string) => ({ themeId, cssContent: ":root{}" })),
      deleteTheme: vi.fn(async () => true),
    };
    const store = {
      fetchCatalog: vi.fn(async () => ({ themes: [] })),
      downloadAndInstallTheme: vi.fn(async (themeId: string, onProgress: (value: number) => void) => {
        onProgress(50);
        return { id: themeId };
      }),
    };
    registerThemeIpc({
      ipc: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); } } as never,
      dialog: {} as never,
      manager: manager as never,
      store: store as never,
      emitThemeChanged,
      emitDownloadProgress,
    });
    expect([...handlers.keys()]).toEqual([
      "themes:installed",
      "themes:active",
      "themes:set-active",
      "themes:delete",
      "themes:import",
      "themes:store-catalog",
      "themes:store-install",
    ]);
    await handlers.get("themes:set-active")?.({}, "author.blue");
    expect(emitThemeChanged).toHaveBeenCalledWith({ activeThemeId: "author.blue", cssContent: ":root{}" });
    await handlers.get("themes:store-install")?.({}, "author.blue");
    expect(emitDownloadProgress).toHaveBeenCalledWith({ themeId: "author.blue", progress: 50 });
  });
});
