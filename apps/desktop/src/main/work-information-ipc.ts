import type { IpcMain, Dialog, BrowserWindow } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { WorkInformation } from "@sanctuary/domain";
import { parseWorkId } from "../shared/library-query.js";
import { fingerprintImage } from "./local-import-service.js";

export function registerWorkInformationIpc(ipc: Pick<IpcMain, "handle">, database: LibraryDatabase, picker?: Pick<Dialog, "showOpenDialog">, getWindow?: () => BrowserWindow | null) {
  ipc.handle("library:relink-external", async (event, workValue: unknown, assetValue: unknown) => {
    const window = getWindow?.();
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame || !picker) throw new Error("请从图库重新定位图片");
    const id = parseWorkId(workValue);
    const work = id ? database.getWork(id) : null;
    const asset = work?.assets.find((item) => item.id === assetValue);
    if (!work || work.ownership !== "external" || !asset) throw new Error("只能重新定位外部图片");
    const result = await picker.showOpenDialog(window, { title: "找到这张图片的新位置", properties: ["openFile"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const hash = await fingerprintImage(result.filePaths[0]);
    if (asset.contentHash && hash !== asset.contentHash) throw new Error("所选文件与原图片内容不同，请选择原图片");
    return database.relinkExternalAsset(work.id, asset.id, result.filePaths[0], hash);
  });
  ipc.handle("library:work-information", (_event, value: unknown, pageValue: unknown): WorkInformation | null => {
    const id = parseWorkId(value);
    if (!id || typeof pageValue !== "number" || !Number.isSafeInteger(pageValue) || pageValue < 0 || pageValue > 100_000) {
      throw new Error("作品信息请求无效");
    }
    const work = database.getWork(id);
    if (!work) return null;
    const asset = work.assets.find((item) => item.pageIndex === pageValue);
    return { work, collections: database.listCollections(), webSource: database.getPreference(`web-source:${work.id}`),
      assessment: asset ? database.getStoredAssetAssessment(work.id, asset.id) : null,
      evaluations: database.listVisionEvaluationsForWork(work.id), provenance: database.getGenerationProvenance(work.id) };
  });
  ipc.handle("library:rename-work", (_event, value: unknown, name: unknown) => {
    const id = parseWorkId(value);
    if (!id || typeof name !== "string") throw new Error("图库名称请求无效");
    return database.renameWork(id, name);
  });
}
