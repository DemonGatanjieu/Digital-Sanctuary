export type ModelCapability =
  | "element_tagging"
  | "aesthetic_scoring"
  | "art_critic"
  | "semantic_embedding";

export type ModelRuntimeKind =
  | "wd_onnx"
  | "aesthetic_head"
  | "llama_cpp_vlm";

export type ModelTier = "light" | "balanced" | "advanced";

export type ModelAvailability = "ready" | "runtime_pending";

export type ModelInstallState =
  | "available"
  | "downloading"
  | "installed"
  | "bundled"
  | "failed";

export interface ModelFileDefinition {
  fileName: string;
  url: string;
  size: number;
  sha256: string;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  capability: ModelCapability;
  runtime: ModelRuntimeKind;
  tier: ModelTier;
  availability: ModelAvailability;
  license: string;
  homepage: string;
  downloadSize: number;
  diskSize: number;
  recommendedRamGb: number;
  recommendedVramGb: number;
  badges: string[];
  files: ModelFileDefinition[];
}

export interface InstalledModelView extends ModelCatalogEntry {
  installState: ModelInstallState;
  installed: boolean;
  active: boolean;
  bundled: boolean;
  installPath: string;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface ModelCenterSnapshot {
  modelsRoot: string;
  totalRamGb: number;
  models: InstalledModelView[];
  activeByCapability: Partial<Record<ModelCapability, string>>;
}

export interface ModelDownloadProgress {
  modelId: string;
  phase: "preparing" | "downloading" | "verifying" | "installing" | "complete" | "failed" | "cancelled";
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  message: string;
}

export interface ModelActivationResult {
  modelId: string;
  capability: ModelCapability;
  active: boolean;
  runtimeRestarted: boolean;
}

export function isSafeModelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{1,79}$/.test(value);
}
