import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import type { BrowserWindow, Dialog, IpcMain } from "electron";
import { isComfyUiSendRequest, type ComfyUiConfig } from "@sanctuary/domain";
import type { ComfyUiService } from "./service.js";
import { parseComfyWorkflowTemplate } from "./workflow.js";

export function registerComfyUiIpc(options: {
  ipc: IpcMain;
  dialog: Pick<Dialog, "showOpenDialog">;
  service: ComfyUiService;
  getWindow: () => BrowserWindow | undefined;
}): void {
  const { ipc, dialog, service, getWindow } = options;
  ipc.handle("comfyui:get-config", () => service.getConfig());
  ipc.handle("comfyui:save-config", (_event, value: unknown): ComfyUiConfig => service.saveConfig(value));
  ipc.handle("comfyui:test-connection", () => service.testConnection());
  ipc.handle("comfyui:list-templates", () => service.listTemplates());
  ipc.handle("comfyui:import-template", async () => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: "导入 ComfyUI API 工作流 JSON",
          properties: ["openFile"],
          filters: [{ name: "ComfyUI API 工作流", extensions: ["json"] }]
        })
      : await dialog.showOpenDialog({
          title: "导入 ComfyUI API 工作流 JSON",
          properties: ["openFile"],
          filters: [{ name: "ComfyUI API 工作流", extensions: ["json"] }]
        });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const text = await readFile(path, "utf8");
    return service.saveTemplate(parseComfyWorkflowTemplate(text, basename(path)));
  });
  ipc.handle("comfyui:delete-template", (_event, value: unknown) => {
    if (typeof value !== "string" || value.length > 100) throw new Error("工作流模板 ID 无效");
    return service.deleteTemplate(value);
  });
  ipc.handle("comfyui:list-jobs", () => service.listJobs());
  ipc.handle("comfyui:start-job", (_event, value: unknown) => {
    if (!isComfyUiSendRequest(value)) throw new Error("ComfyUI 任务参数无效");
    return service.startJob(value);
  });
  ipc.handle("comfyui:cancel-job", (_event, value: unknown) => {
    if (typeof value !== "string" || value.length > 100) throw new Error("ComfyUI 任务 ID 无效");
    return service.cancelJob(value);
  });
}
