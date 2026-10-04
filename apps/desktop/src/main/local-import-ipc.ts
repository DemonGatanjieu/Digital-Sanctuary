import type { IpcMain, Dialog } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import { LocalImportService } from "./local-import-service.js";

export function registerLocalImportIpc(ipc: Pick<IpcMain, "handle">, database: LibraryDatabase, dialog: Pick<Dialog, "showOpenDialog">) {
  const service = new LocalImportService(database);
  ipc.handle("library:import", async (event) => {
    const selected = await dialog.showOpenDialog({ title: "选择要导入的图片", properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"] }] });
    return service.choose(event.sender.id, selected.canceled ? [] : selected.filePaths);
  });
  ipc.handle("library:import-get", (event, id: unknown) => service.get(event.sender.id, id));
  ipc.handle("library:import-start", (event, id: unknown, options: unknown) => service.start(event.sender.id, id, options));
  ipc.handle("library:import-cancel", (event, id: unknown) => service.cancel(event.sender.id, id));
  ipc.handle("library:import-retry", (event, id: unknown) => service.retry(event.sender.id, id));
}
