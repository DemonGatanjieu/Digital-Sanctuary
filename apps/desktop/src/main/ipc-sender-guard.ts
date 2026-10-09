import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";

/** Invoke channels the Pixiv explore preload calls; their handlers check the explore view themselves. */
export const EXPLORE_INVOKE_CHANNELS: ReadonlySet<string> = new Set([
  "explore:get-dislike-candidates",
  "explore:record-dislike",
  "explore:mark-false-positive",
  "explore:undo-preference-feedback"
]);

export function isAppSender(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame"> | undefined, appContents: WebContents | undefined): boolean {
  return Boolean(event && appContents && !appContents.isDestroyed() && event.sender === appContents && event.senderFrame === appContents.mainFrame);
}

/**
 * Defense in depth: every invoke channel except the explore ones answers only the app window's main frame,
 * so a compromised remote page renderer cannot reach library, file or settings handlers.
 * Must be installed before any handler is registered.
 */
export function installIpcSenderGuard(ipc: Pick<IpcMain, "handle">, appContents: () => WebContents | undefined): void {
  const handle = ipc.handle.bind(ipc);
  ipc.handle = ((channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    handle(channel, (event, ...args) => {
      if (!EXPLORE_INVOKE_CHANNELS.has(channel) && !isAppSender(event, appContents())) {
        throw new Error(`Rejected IPC from an untrusted sender: ${channel}`);
      }
      return listener(event, ...args);
    })) as IpcMain["handle"];
}
