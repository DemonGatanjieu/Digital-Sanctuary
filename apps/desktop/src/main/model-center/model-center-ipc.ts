import type { BrowserWindow, IpcMain } from "electron";
import { shell } from "electron";
import type { ModelActivationResult, ModelCenterSnapshot } from "@sanctuary/domain";
import { isSafeModelId } from "@sanctuary/domain";
import type { ModelCenterService } from "./model-center-service.js";

export function registerModelCenterIpc(options: {
  ipc: IpcMain;
  service: ModelCenterService;
  getWindow: () => BrowserWindow | undefined;
  onActivate: (modelId: string) => Promise<boolean>;
}): () => void {
  const { ipc, service, getWindow, onActivate } = options;
  const unsubscribe = service.onProgress((progress) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("models:download-progress", progress);
  });

  ipc.handle("models:snapshot", (): Promise<ModelCenterSnapshot> => service.snapshot());
  ipc.handle("models:install", (_event, modelId: unknown): Promise<ModelCenterSnapshot> => {
    return service.install(requireModelId(modelId));
  });
  ipc.handle("models:cancel", (_event, modelId: unknown): boolean => {
    return service.cancel(requireModelId(modelId));
  });
  ipc.handle("models:remove", (_event, modelId: unknown): Promise<ModelCenterSnapshot> => {
    return service.remove(requireModelId(modelId));
  });
  ipc.handle("models:activate", async (_event, modelId: unknown): Promise<ModelActivationResult> => {
    const safeModelId = requireModelId(modelId);
    const runtimeRestarted = await onActivate(safeModelId);
    if (!runtimeRestarted) throw new Error("这个模型当前还没有可用的本地运行时。");
    const result = await service.activate(safeModelId);
    return { ...result, runtimeRestarted };
  });
  ipc.handle("models:open-homepage", async (_event, modelId: unknown): Promise<boolean> => {
    const entry = service.getEntry(requireModelId(modelId));
    const url = new URL(entry.homepage);
    if (url.protocol !== "https:" || !["huggingface.co", "github.com"].includes(url.hostname)) {
      throw new Error("模型来源地址不在允许列表中。");
    }
    await shell.openExternal(url.toString());
    return true;
  });
  ipc.handle("models:open-directory", async (): Promise<boolean> => {
    const snapshot = await service.snapshot();
    return (await shell.openPath(snapshot.modelsRoot)) === "";
  });

  return unsubscribe;
}

function requireModelId(value: unknown): string {
  if (!isSafeModelId(value)) throw new Error("模型 ID 无效。");
  return value;
}
