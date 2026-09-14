import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { LibraryDatabase } from "@sanctuary/database";
import {
  DEFAULT_COMFY_UI_CONFIG,
  summarizeComfyWorkflowTemplate,
  type ComfyUiConfig,
  type ComfyUiJob,
  type ComfyUiSendRequest,
  type ComfyWorkflowTemplate,
  type ComfyWorkflowTemplateSummary
} from "@sanctuary/domain";
import { ComfyUiClient, normalizeLoopbackComfyUrl } from "./client.js";
import { prepareComfyWorkflow } from "./workflow.js";

const CONFIG_PREFERENCE = "comfyui.config.v1";
const TEMPLATES_PREFERENCE = "comfyui.templates.v1";
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const JOB_TIMEOUT_MS = 10 * 60 * 1_000;

export class ComfyUiService {
  readonly #database: LibraryDatabase;
  readonly #outputDirectory: string | (() => string);
  readonly #clientFactory: (baseUrl: string) => ComfyUiClient;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    database: LibraryDatabase,
    outputDirectory: string | (() => string),
    clientFactory: (baseUrl: string) => ComfyUiClient = (baseUrl) => new ComfyUiClient(baseUrl)
  ) {
    this.#database = database;
    this.#outputDirectory = outputDirectory;
    this.#clientFactory = clientFactory;
  }

  get outputDirectory(): string {
    return typeof this.#outputDirectory === "function" ? this.#outputDirectory() : this.#outputDirectory;
  }

  getConfig(): ComfyUiConfig {
    return normalizeConfig(this.#database.getPreference<unknown>(CONFIG_PREFERENCE));
  }

  saveConfig(value: unknown): ComfyUiConfig {
    if (!value || typeof value !== "object") throw new Error("ComfyUI 配置无效");
    const input = value as Partial<ComfyUiConfig>;
    if (typeof input.enabled !== "boolean" || typeof input.baseUrl !== "string") throw new Error("ComfyUI 配置无效");
    const config = { enabled: input.enabled, baseUrl: normalizeLoopbackComfyUrl(input.baseUrl) };
    this.#database.setPreference(CONFIG_PREFERENCE, config);
    return config;
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number; deviceName?: string; error?: string }> {
    const config = this.getConfig();
    try {
      const result = await this.#clientFactory(config.baseUrl).testConnection();
      return result;
    } catch (error) {
      return { success: false, latencyMs: 0, error: errorMessage(error) };
    }
  }

  listTemplates(): ComfyWorkflowTemplateSummary[] {
    return this.#templates().map(summarizeComfyWorkflowTemplate);
  }

  saveTemplate(template: ComfyWorkflowTemplate): ComfyWorkflowTemplateSummary {
    const templates = this.#templates().filter((item) => item.id !== template.id);
    const next = [template, ...templates].slice(0, 30);
    this.#database.setPreference(TEMPLATES_PREFERENCE, next);
    return summarizeComfyWorkflowTemplate(template);
  }

  deleteTemplate(templateId: string): boolean {
    const current = this.#templates();
    const next = current.filter((item) => item.id !== templateId);
    if (next.length === current.length) return false;
    this.#database.setPreference(TEMPLATES_PREFERENCE, next);
    return true;
  }

  listJobs(): ComfyUiJob[] {
    return this.#database.listComfyUiJobs();
  }

  startJob(request: ComfyUiSendRequest): ComfyUiJob {
    const config = this.getConfig();
    if (!config.enabled) throw new Error("请先在设置中显式启用 ComfyUI 本地桥接");
    const work = this.#database.getWork(request.workId);
    if (!work) throw new Error("来源作品不存在");
    const asset = work.assets.find((item) => item.pageIndex === request.pageIndex);
    if (!asset || asset.fileState !== "available" || !existsSync(asset.path)) throw new Error("当前页没有可用的本地原图");
    if (statSync(asset.path).size > MAX_SOURCE_BYTES) throw new Error("来源图片超过 128 MiB 上限");
    const template = this.#templates().find((item) => item.id === request.templateId);
    if (!template) throw new Error("工作流模板不存在");
    const sourceName = template.hasSourceImageBinding ? safeSourceName(asset.id, asset.path) : undefined;
    const prepared = prepareComfyWorkflow(template, {
      positivePrompt: request.positivePrompt,
      negativePrompt: request.negativePrompt,
      ...(sourceName ? { sourceImageName: sourceName } : {})
    });
    const job = this.#database.createComfyUiJob({
      sourceWorkId: work.id,
      sourceAssetId: asset.id,
      templateId: template.id,
      templateName: template.name,
      positivePrompt: request.positivePrompt,
      negativePrompt: request.negativePrompt,
      workflowSummary: prepared.summary,
      parameters: { endpoint: config.baseUrl, pageIndex: asset.pageIndex }
    });
    this.#queue = this.#queue.then(() => this.#run(job.id, template, asset.path, sourceName, config)).catch(() => undefined);
    return job;
  }

  cancelJob(jobId: string): ComfyUiJob {
    if (!this.#database.requestComfyUiJobCancellation(jobId)) throw new Error("任务已经结束或不存在");
    return this.#database.getComfyUiJob(jobId)!;
  }

  async #run(jobId: string, template: ComfyWorkflowTemplate, sourcePath: string, sourceName: string | undefined, config: ComfyUiConfig): Promise<void> {
    if (!this.#database.startComfyUiJob(jobId)) return;
    const initial = this.#database.getComfyUiJob(jobId);
    if (!initial) return;
    try {
      if (this.#database.isComfyUiJobCancellationRequested(jobId)) {
        this.#database.finishComfyUiJob(jobId, "cancelled", null, null);
        return;
      }
      const client = this.#clientFactory(config.baseUrl);
      const uploadedName = sourceName
        ? await client.uploadImage(await readFile(sourcePath), sourceName, mimeForPath(sourcePath))
        : undefined;
      const prepared = prepareComfyWorkflow(template, {
        positivePrompt: initial.positivePrompt,
        negativePrompt: initial.negativePrompt,
        ...(uploadedName ? { sourceImageName: uploadedName } : {})
      });
      const promptId = await client.queuePrompt(prepared.workflow, randomUUID());
      this.#database.setComfyUiRemotePrompt(jobId, promptId);

      const deadline = Date.now() + JOB_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (this.#database.isComfyUiJobCancellationRequested(jobId)) {
          this.#database.finishComfyUiJob(jobId, "cancelled", null, "已停止本地等待；ComfyUI 端任务可能仍在运行");
          return;
        }
        const history = await client.getHistory(promptId);
        if (history.error) throw new Error(history.error);
        if (history.complete) {
          if (history.images.length === 0) throw new Error("ComfyUI 任务完成，但没有返回图片输出");
          const directory = join(this.outputDirectory, jobId);
          await mkdir(directory, { recursive: true });
          const outputWorkIds: string[] = [];
          for (const [index, image] of history.images.entries()) {
            const downloaded = await client.downloadImage(image);
            if (!hasRasterImageSignature(downloaded.bytes, downloaded.contentType)) {
              throw new Error("ComfyUI 输出图片的内容与声明格式不一致");
            }
            const outputExtension = extensionForMime(downloaded.contentType);
            const finalPath = join(directory, `result-${index + 1}${outputExtension}`);
            const temporaryPath = `${finalPath}.part-${randomUUID()}`;
            await writeFile(temporaryPath, downloaded.bytes, { flag: "wx" });
            await rename(temporaryPath, finalPath);
            const artwork = this.#database.importArtwork(finalPath);
            this.#database.trustArtwork(artwork.id);
            const outputWork = this.#database.listWorks().find((work) => work.assets.some((asset) => asset.path === finalPath));
            if (!outputWork) throw new Error("生成结果已保存，但未能建立画廊索引");
            outputWorkIds.push(outputWork.id);
            this.#database.saveGenerationProvenance({
              outputWorkId: outputWork.id,
              sourceWorkId: initial.sourceWorkId,
              sourceAssetId: initial.sourceAssetId,
              provider: "comfyui",
              templateName: initial.templateName,
              positivePrompt: initial.positivePrompt,
              negativePrompt: initial.negativePrompt,
              workflowSummary: prepared.summary,
              parameters: { ...initial.parameters, outputIndex: index, outputCount: history.images.length },
              createdAt: new Date().toISOString()
            });
          }
          this.#database.finishComfyUiJob(jobId, "completed", outputWorkIds[0] ?? null, null);
          return;
        }
        await delay(1_000);
      }
      throw new Error("等待 ComfyUI 输出超过 10 分钟，已停止本地等待");
    } catch (error) {
      this.#database.finishComfyUiJob(jobId, "failed", null, errorMessage(error));
    }
  }

  #templates(): ComfyWorkflowTemplate[] {
    const value = this.#database.getPreference<unknown>(TEMPLATES_PREFERENCE);
    if (!Array.isArray(value)) return [];
    return value.filter(isStoredTemplate).slice(0, 30);
  }
}

function normalizeConfig(value: unknown): ComfyUiConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_COMFY_UI_CONFIG };
  const input = value as Partial<ComfyUiConfig>;
  try {
    return {
      enabled: input.enabled === true,
      baseUrl: normalizeLoopbackComfyUrl(typeof input.baseUrl === "string" ? input.baseUrl : DEFAULT_COMFY_UI_CONFIG.baseUrl)
    };
  } catch {
    return { ...DEFAULT_COMFY_UI_CONFIG };
  }
}

function isStoredTemplate(value: unknown): value is ComfyWorkflowTemplate {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<ComfyWorkflowTemplate>;
  return typeof input.id === "string" && typeof input.name === "string" && typeof input.createdAt === "string" &&
    typeof input.nodeCount === "number" && input.workflow !== null && typeof input.workflow === "object" && !Array.isArray(input.workflow);
}

function safeSourceName(assetId: string, sourcePath: string): string {
  const extension = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(extname(sourcePath).toLowerCase())
    ? extname(sourcePath).toLowerCase()
    : ".png";
  return `sanctuary-${assetId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 80)}${extension}`;
}

function mimeForPath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  return "image/png";
}

function extensionForMime(value: string): string {
  if (value === "image/jpeg") return ".jpg";
  if (value === "image/webp") return ".webp";
  if (value === "image/gif") return ".gif";
  if (value === "image/avif") return ".avif";
  return ".png";
}

function hasRasterImageSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/png") return bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/gif") return new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a";
  if (contentType === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (contentType === "image/avif") return new TextDecoder().decode(bytes.slice(4, 12)).includes("ftypavif");
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : "ComfyUI 任务失败";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
