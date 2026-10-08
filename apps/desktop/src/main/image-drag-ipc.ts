import type { BrowserWindow, IpcMain, NativeImage } from "electron";
import type { ImageOutputService } from "./image-output-service.js";

export function registerImageDragIpc(ipc: Pick<IpcMain, "handle">, output: ImageOutputService, getWindow: () => BrowserWindow | null, icon: NativeImage) {
  ipc.handle("images:drag", (event, target: unknown) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("请从本地图片的拖出按钮开始");
    return output.drag(event.sender.id, target, file => {
      if (event.sender.isDestroyed()) throw new Error("图库已关闭，请重新打开");
      // Electron 43 on Windows offers COPY | LINK, never MOVE. Keep indexed originals in place.
      try { event.sender.startDrag({ file, icon }); }
      catch { throw new Error("暂时无法拖出，请使用复制图片或复制原图到文件夹"); }
    });
  });
}
