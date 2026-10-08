export type LocalImportItemStatus = "pending" | "imported" | "existing" | "duplicate" | "failed" | "cancelled";
export interface LocalImportItem {
  id: string;
  fileName: string;
  status: LocalImportItemStatus;
  artworkId?: string;
  error?: string;
}
export interface LocalImportBatch {
  storageMode?: "copy" | "reference";
  id: string;
  phase: "ready" | "running" | "completed" | "cancelled";
  items: LocalImportItem[];
  collectionId: string | null;
  duplicatePolicy: "reuse" | "separate";
  cancelRequested: boolean;
}
export interface LocalImportOptions {
  /** Missing on older clients means reference, to preserve their existing behavior. */
  storageMode?: "copy" | "reference";
  collectionId: string | null;
  duplicatePolicy: "reuse" | "separate";
}
