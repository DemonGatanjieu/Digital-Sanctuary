export type LocalImportItemStatus = "pending" | "imported" | "existing" | "duplicate" | "failed" | "cancelled";
export interface LocalImportItem {
  id: string;
  fileName: string;
  status: LocalImportItemStatus;
  artworkId?: string;
  error?: string;
}
export interface LocalImportBatch {
  id: string;
  phase: "ready" | "running" | "completed" | "cancelled";
  items: LocalImportItem[];
  collectionId: string | null;
  duplicatePolicy: "reuse" | "separate";
  cancelRequested: boolean;
}
export interface LocalImportOptions {
  collectionId: string | null;
  duplicatePolicy: "reuse" | "separate";
}
