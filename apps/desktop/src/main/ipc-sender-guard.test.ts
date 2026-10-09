import { describe, expect, it } from "vitest";
import type { IpcMain, WebContents } from "electron";
import { installIpcSenderGuard } from "./ipc-sender-guard";

function contents(): WebContents {
  const frame = {};
  return { mainFrame: frame, isDestroyed: () => false } as unknown as WebContents;
}

function guarded(app: WebContents | undefined) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, listener); } } as unknown as IpcMain;
  installIpcSenderGuard(ipc, () => app);
  ipc.handle("library:delete", (_event, id) => `deleted ${String(id)}`);
  ipc.handle("explore:record-dislike", () => "recorded");
  return (channel: string, event: unknown, ...args: unknown[]) => handlers.get(channel)!(event, ...args);
}

describe("IPC sender guard", () => {
  it("answers the app window's main frame", () => {
    const app = contents();
    expect(guarded(app)("library:delete", { sender: app, senderFrame: app.mainFrame }, 7)).toBe("deleted 7");
  });

  it("rejects other renderers, subframes and calls before the window exists", () => {
    const app = contents(), remote = contents();
    expect(() => guarded(app)("library:delete", { sender: remote, senderFrame: remote.mainFrame })).toThrow("untrusted sender");
    expect(() => guarded(app)("library:delete", { sender: app, senderFrame: {} })).toThrow("untrusted sender");
    expect(() => guarded(undefined)("library:delete", { sender: app, senderFrame: app.mainFrame })).toThrow("untrusted sender");
  });

  it("leaves the explore preload channels to their own explore-view checks", () => {
    const remote = contents();
    expect(guarded(contents())("explore:record-dislike", { sender: remote, senderFrame: remote.mainFrame })).toBe("recorded");
  });
});
