import type { IpcMain } from "electron";
import type { LibraryDatabase } from "@sanctuary/database";
import type { WorkInformation } from "@sanctuary/domain";
import { parseWorkId } from "../shared/library-query.js";

export function registerWorkInformationIpc(ipc: Pick<IpcMain, "handle">, database: LibraryDatabase) {
  ipc.handle("library:work-information", (_event, value: unknown, pageValue: unknown): WorkInformation | null => {
    const id = parseWorkId(value);
    if (!id || typeof pageValue !== "number" || !Number.isSafeInteger(pageValue) || pageValue < 0 || pageValue > 100_000) {
      throw new Error("作品信息请求无效");
    }
    const work = database.getWork(id);
    if (!work) return null;
    const asset = work.assets.find((item) => item.pageIndex === pageValue);
    return { work, collections: database.listCollections(),
      assessment: asset ? database.getStoredAssetAssessment(work.id, asset.id) : null,
      evaluations: database.listVisionEvaluationsForWork(work.id), provenance: database.getGenerationProvenance(work.id) };
  });
  ipc.handle("library:rename-work", (_event, value: unknown, name: unknown) => {
    const id = parseWorkId(value);
    if (!id || typeof name !== "string") throw new Error("图库名称请求无效");
    return database.renameWork(id, name);
  });
}
