import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  InstalledModelView,
  ModelActivationResult,
  ModelCapability,
  ModelCatalogEntry,
  ModelCenterSnapshot,
  ModelDownloadProgress,
  ModelFileDefinition
} from "@sanctuary/domain";
import { isSafeModelId } from "@sanctuary/domain";
import { MODEL_CATALOG } from "./catalog.js";
import { extractTrustedZip } from "./secure-zip.js";

interface ModelCenterOptions {
  modelsRoot: string;
  bundledModels: Partial<Record<string, string>>;
  readActiveModelId: (capability: ModelCapability) => string | null;
  writeActiveModelId: (capability: ModelCapability, modelId: string) => void;
  catalog?: readonly ModelCatalogEntry[];
  fetchImpl?: typeof fetch;
}

interface DownloadState {
  controller: AbortController;
  progress: ModelDownloadProgress;
}

export interface ResolvedRuntimeModel {
  entry: ModelCatalogEntry;
  modelDirectory: string;
  bundled: boolean;
}

const INSTALL_MARKER = "sanctuary-model.json";

/** Downloaded models live in the per-user local profile, outside the roaming library data. */
export function localModelsRoot(userDataPath: string): string {
  const localAppData = process.env.LOCALAPPDATA;
  return localAppData ? join(localAppData, "digital-sanctuary", "models") : join(userDataPath, "models");
}
const SNAPSHOT_MANIFEST = "sanctuary.manifest.json";

export class ModelCenterService {
  readonly #modelsRoot: string;
  readonly #bundledModels: Partial<Record<string, string>>;
  readonly #readActiveModelId: ModelCenterOptions["readActiveModelId"];
  readonly #writeActiveModelId: ModelCenterOptions["writeActiveModelId"];
  readonly #catalog: readonly ModelCatalogEntry[];
  readonly #fetch: typeof fetch;
  readonly #downloads = new Map<string, DownloadState>();
  readonly #listeners = new Set<(progress: ModelDownloadProgress) => void>();

  constructor(options: ModelCenterOptions) {
    this.#modelsRoot = resolve(options.modelsRoot);
    this.#bundledModels = options.bundledModels;
    this.#readActiveModelId = options.readActiveModelId;
    this.#writeActiveModelId = options.writeActiveModelId;
    this.#catalog = options.catalog ?? MODEL_CATALOG;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  onProgress(listener: (progress: ModelDownloadProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async snapshot(): Promise<ModelCenterSnapshot> {
    await mkdir(this.#modelsRoot, { recursive: true });
    const activeByCapability: ModelCenterSnapshot["activeByCapability"] = {};
    for (const capability of new Set(this.#catalog.map((entry) => entry.capability))) {
      const active = await this.resolveActiveRuntimeModel(capability);
      if (active) activeByCapability[capability] = active.entry.id;
    }
    const models = await Promise.all(this.#catalog.map((entry) => this.#toView(entry, activeByCapability)));
    return {
      modelsRoot: this.#modelsRoot,
      totalRamGb: Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024)),
      models,
      activeByCapability
    };
  }

  async install(modelId: string): Promise<ModelCenterSnapshot> {
    const entry = this.#requireEntry(modelId);
    if (entry.availability !== "ready" || entry.files.length === 0) {
      throw new Error("这个模型的本地运行时还在接入准备中，目前只能查看来源。");
    }
    if (this.#bundledModels[modelId]) return this.snapshot();
    if (this.#downloads.has(modelId)) throw new Error("这个模型已经在下载中。");

    const controller = new AbortController();
    const totalBytes = entry.files.reduce((sum, file) => sum + file.size, 0);
    const state: DownloadState = {
      controller,
      progress: {
        modelId,
        phase: "preparing",
        fileName: "",
        downloadedBytes: 0,
        totalBytes,
        message: "正在准备安全下载…"
      }
    };
    this.#downloads.set(modelId, state);
    this.#emit(state.progress);

    const stagingDirectory = this.#safePath(join(this.#modelsRoot, ".downloads", modelId));
    const installDirectory = this.#safePath(join(this.#modelsRoot, modelId));
    try {
      await mkdir(stagingDirectory, { recursive: true });
      let completedBytes = 0;
      for (const file of entry.files) {
        await this.#downloadFile(entry, file, stagingDirectory, completedBytes, state);
        completedBytes += file.size;
      }
      for (const file of entry.files.filter((candidate) => candidate.extract === "zip")) {
        this.#update(state, {
          phase: "installing",
          fileName: file.fileName,
          downloadedBytes: totalBytes,
          message: `正在展开 ${entry.name} 的本地运行时…`
        });
        const archive = join(stagingDirectory, ...modelFileSegments(file.fileName));
        await extractTrustedZip(archive, stagingDirectory);
        await rm(archive, { force: true });
      }
      this.#update(state, {
        phase: "installing",
        fileName: "",
        downloadedBytes: totalBytes,
        message: "校验通过，正在完成安装…"
      });
      if (entry.snapshot) {
        const files = entry.files.filter((file) => !file.extract).map(({ fileName, size, sha256 }) => ({ path: fileName, size, sha256 }));
        await writeFile(join(stagingDirectory, SNAPSHOT_MANIFEST), JSON.stringify({ ...entry.snapshot, files }, null, 2), "utf8");
      }
      await writeFile(
        join(stagingDirectory, INSTALL_MARKER),
        JSON.stringify({ id: entry.id, version: entry.version, installedAt: new Date().toISOString() }, null, 2),
        "utf8"
      );
      await rm(installDirectory, { recursive: true, force: true });
      await mkdir(dirname(installDirectory), { recursive: true });
      await rename(stagingDirectory, installDirectory);
      this.#update(state, {
        phase: "complete",
        fileName: "",
        downloadedBytes: totalBytes,
        message: "模型已经安全安装。"
      });
      return this.snapshot();
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.#update(state, {
        phase: cancelled ? "cancelled" : "failed",
        message: cancelled ? "下载已暂停，临时文件会保留以便继续。" : messageFrom(error)
      });
      if (cancelled) throw new Error("模型下载已取消");
      throw error;
    } finally {
      this.#downloads.delete(modelId);
    }
  }

  cancel(modelId: string): boolean {
    const state = this.#downloads.get(modelId);
    if (!state) return false;
    state.controller.abort();
    return true;
  }

  async remove(modelId: string): Promise<ModelCenterSnapshot> {
    const entry = this.#requireEntry(modelId);
    if (this.#bundledModels[modelId]) throw new Error("内置基础模型不能删除。");
    if (this.#resolveActiveId(entry.capability) === modelId) {
      throw new Error("请先切换到同类的其他模型，再删除当前模型。");
    }
    // A worker that was just stopped can hold its executable for a moment on Windows.
    await rm(this.#safePath(join(this.#modelsRoot, modelId)), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(this.#safePath(join(this.#modelsRoot, ".downloads", modelId)), { recursive: true, force: true });
    return this.snapshot();
  }

  async activate(modelId: string): Promise<ModelActivationResult> {
    const entry = this.#requireEntry(modelId);
    if (entry.availability !== "ready") throw new Error("这个模型的运行时尚未接通。");
    const runtime = await this.resolveRuntimeModel(modelId);
    if (!runtime) throw new Error("请先下载并安装这个模型。");
    this.#writeActiveModelId(entry.capability, modelId);
    return { modelId, capability: entry.capability, active: true, runtimeRestarted: false };
  }

  async deactivate(modelId: string): Promise<ModelCenterSnapshot> {
    const entry = this.#requireEntry(modelId);
    if (entry.capability === "element_tagging") throw new Error("探索元素模型必须保留一个当前选择。");
    if (this.#resolveActiveId(entry.capability) === modelId) this.#writeActiveModelId(entry.capability, "");
    return this.snapshot();
  }

  async resolveActiveRuntimeModel(capability: ModelCapability): Promise<ResolvedRuntimeModel | null> {
    const activeId = this.#resolveActiveId(capability);
    const active = activeId ? await this.resolveRuntimeModel(activeId) : null;
    if (active) return active;
    const fallback = this.#catalog.find(
      (entry) => entry.capability === capability && Boolean(this.#bundledModels[entry.id])
    );
    if (!fallback) return null;
    const runtime = await this.resolveRuntimeModel(fallback.id);
    if (runtime && activeId !== fallback.id) this.#writeActiveModelId(capability, fallback.id);
    return runtime;
  }

  async resolveRuntimeModel(modelId: string): Promise<ResolvedRuntimeModel | null> {
    const entry = this.#requireEntry(modelId);
    const bundledPath = this.#bundledModels[modelId];
    if (bundledPath && await hasRequiredFiles(bundledPath, entry)) {
      return { entry, modelDirectory: bundledPath, bundled: true };
    }
    const installPath = this.#safePath(join(this.#modelsRoot, modelId));
    if (await hasRequiredFiles(installPath, entry) && await isFile(join(installPath, INSTALL_MARKER))) {
      return { entry, modelDirectory: installPath, bundled: false };
    }
    return null;
  }

  getEntry(modelId: string): ModelCatalogEntry {
    return this.#requireEntry(modelId);
  }

  async #toView(
    entry: ModelCatalogEntry,
    activeByCapability: ModelCenterSnapshot["activeByCapability"]
  ): Promise<InstalledModelView> {
    const runtime = await this.resolveRuntimeModel(entry.id);
    const download = this.#downloads.get(entry.id)?.progress;
    const bundled = Boolean(runtime?.bundled);
    const installed = Boolean(runtime);
    return {
      ...entry,
      installState: download ? "downloading" : bundled ? "bundled" : installed ? "installed" : "available",
      installed,
      active: activeByCapability[entry.capability] === entry.id,
      bundled,
      installPath: runtime?.modelDirectory ?? "",
      downloadedBytes: download?.downloadedBytes ?? 0,
      totalBytes: download?.totalBytes ?? entry.downloadSize,
      ...(download?.phase === "failed" ? { error: download.message } : {})
    };
  }

  async #downloadFile(
    entry: ModelCatalogEntry,
    file: ModelFileDefinition,
    stagingDirectory: string,
    completedBytes: number,
    state: DownloadState
  ): Promise<void> {
    const segments = modelFileSegments(file.fileName);
    if (!/^https:\/\//.test(file.url)) throw new Error("模型下载地址必须使用 HTTPS。");
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("模型文件缺少有效 SHA256。");

    const finalPath = join(stagingDirectory, ...segments);
    const partPath = `${finalPath}.part`;
    await mkdir(dirname(finalPath), { recursive: true });
    // A retried install keeps files that already finished and verified.
    if (await fileSize(finalPath) === file.size && await sha256Of(finalPath) === file.sha256) return;
    let existingBytes = await fileSize(partPath);
    if (existingBytes > file.size) {
      await rm(partPath, { force: true });
      existingBytes = 0;
    }
    let hash = createHash("sha256");
    if (existingBytes > 0) {
      for await (const chunk of createReadStream(partPath)) hash.update(chunk as Buffer);
    }

    const headers = existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined;
    const response = await this.#fetch(file.url, {
      ...(headers ? { headers } : {}),
      signal: state.controller.signal
    });
    if (response.status === 404 && file.extract) throw new Error(`${entry.name} 的运行包还没有发布，暂时无法下载。`);
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
    if (existingBytes > 0 && response.status !== 206) {
      existingBytes = 0;
      hash = createHash("sha256");
    }
    const handle = await open(partPath, existingBytes > 0 && response.status === 206 ? "a" : "w");
    let received = existingBytes > 0 && response.status === 206 ? existingBytes : 0;
    const activeHash = hash;
    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        received += chunk.length;
        if (received > file.size) throw new Error("下载内容超过模型清单声明的大小。");
        activeHash.update(chunk);
        await handle.write(chunk);
        this.#update(state, {
          phase: "downloading",
          fileName: file.fileName,
          downloadedBytes: completedBytes + received,
          message: `正在下载 ${entry.name}`
        });
      }
    } finally {
      await handle.close();
    }
    this.#update(state, {
      phase: "verifying",
      fileName: file.fileName,
      downloadedBytes: completedBytes + received,
      message: `正在校验 ${file.fileName}`
    });
    if (received !== file.size) throw new Error(`文件大小不符：${file.fileName}`);
    if (activeHash.digest("hex") !== file.sha256) throw new Error(`SHA256 校验失败：${file.fileName}`);
    await rm(finalPath, { force: true });
    await rename(partPath, finalPath);
  }

  #resolveActiveId(capability: ModelCapability): string | null {
    const stored = this.#readActiveModelId(capability);
    const validStored = stored && this.#catalog.some((entry) => entry.id === stored && entry.capability === capability);
    if (validStored) return stored;
    return this.#catalog.find((entry) => entry.capability === capability && Boolean(this.#bundledModels[entry.id]))?.id ?? null;
  }

  #requireEntry(modelId: string): ModelCatalogEntry {
    if (!isSafeModelId(modelId)) throw new Error("模型 ID 无效。");
    const entry = this.#catalog.find((candidate) => candidate.id === modelId);
    if (!entry) throw new Error("模型不在受信任目录中。");
    return entry;
  }

  #safePath(candidate: string): string {
    const resolved = resolve(candidate);
    const rel = relative(this.#modelsRoot, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("模型路径超出受控目录。");
    return resolved;
  }

  #update(state: DownloadState, patch: Partial<ModelDownloadProgress>): void {
    state.progress = { ...state.progress, ...patch };
    this.#emit(state.progress);
  }

  #emit(progress: ModelDownloadProgress): void {
    for (const listener of this.#listeners) listener({ ...progress });
  }
}

async function hasRequiredFiles(directory: string, entry: ModelCatalogEntry): Promise<boolean> {
  if (!directory || entry.files.length === 0) return false;
  const required = [
    ...entry.files.filter((file) => !file.extract).map((file) => file.fileName),
    ...(entry.requiredRuntimeFiles ?? [])
  ];
  return (await Promise.all(required.map((fileName) => isFile(join(directory, ...fileName.split("/")))))).every(Boolean);
}

/** Catalog file names are relative paths of plain segments ("1_Pooling/config.json"); nothing may climb out. */
export function modelFileSegments(fileName: string): string[] {
  const segments = fileName.split("/");
  if (segments.length > 4 || segments.some((segment) => !/^[A-Za-z0-9._-]{1,120}$/.test(segment) || /^\.+$/.test(segment))) {
    throw new Error("模型清单包含不安全的文件名。");
  }
  return segments;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

async function fileSize(path: string): Promise<number> {
  try { return (await stat(path)).size; }
  catch { return 0; }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "模型操作失败");
}
