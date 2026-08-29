import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { VisionSuiteDefinition } from "@sanctuary/domain";
import type { ResolvedRuntimeModel } from "../model-center/model-center-service.js";
import type { PreparedVisionImage } from "./vision-image-preprocessor.js";
import type { ExternalVisionAdapterResult } from "./adapters/types.js";
import { createEvaluationPrompt, validateEvaluationDimensions } from "./adapters/evaluation-contract.js";

interface LocalArtCriticServiceOptions {
  resolveActiveModel: () => Promise<ResolvedRuntimeModel | null>;
  fetchImpl?: typeof fetch;
  startupTimeoutMs?: number;
  inferenceTimeoutMs?: number;
  idleTimeoutMs?: number;
  buildCommand?: (runtime: ResolvedRuntimeModel, port: number, apiKey: string) => {
    executable: string;
    args: string[];
    cwd: string;
  };
}

export interface LocalArtCriticIdentity {
  modelId: string;
  modelVersion: string;
  evaluatorVersion: string;
}

export class LocalArtCriticService {
  readonly #resolveActiveModel: LocalArtCriticServiceOptions["resolveActiveModel"];
  readonly #fetch: typeof fetch;
  readonly #startupTimeoutMs: number;
  readonly #inferenceTimeoutMs: number;
  readonly #idleTimeoutMs: number;
  readonly #buildCommand: NonNullable<LocalArtCriticServiceOptions["buildCommand"]>;
  #process: ChildProcess | null = null;
  #runtime: ResolvedRuntimeModel | null = null;
  #endpoint = "";
  #apiKey = "";
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: LocalArtCriticServiceOptions) {
    this.#resolveActiveModel = options.resolveActiveModel;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.#inferenceTimeoutMs = options.inferenceTimeoutMs ?? 90_000;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
    this.#buildCommand = options.buildCommand ?? defaultCommand;
  }

  async activate(runtime: ResolvedRuntimeModel): Promise<LocalArtCriticIdentity> {
    await this.#ensureStarted(runtime);
    this.#scheduleIdleShutdown();
    return identityOf(runtime);
  }

  async getActiveIdentity(): Promise<LocalArtCriticIdentity | null> {
    const runtime = await this.#resolveActiveModel();
    return runtime?.entry.capability === "art_critic" ? identityOf(runtime) : null;
  }

  async analyze(
    image: PreparedVisionImage,
    suite: VisionSuiteDefinition,
    signal?: AbortSignal
  ): Promise<{ identity: LocalArtCriticIdentity; result: ExternalVisionAdapterResult }> {
    const task: Promise<{ identity: LocalArtCriticIdentity; result: ExternalVisionAdapterResult }> = this.#queue.then(async () => {
      const runtime = await this.#resolveActiveModel();
      if (!runtime || runtime.entry.capability !== "art_critic") {
        throw new Error("请先在模型中心安装并启用本地六维评论模型");
      }
      await this.#ensureStarted(runtime);
      this.#clearIdleTimer();
      const timeoutSignal = AbortSignal.timeout(this.#inferenceTimeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      try {
        const response = await this.#fetch(`${this.#endpoint}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.#apiKey}`
          },
          body: JSON.stringify({
            model: runtime.entry.id,
            messages: [
              { role: "system", content: createEvaluationPrompt(suite) },
              {
                role: "user",
                content: [
                  { type: "text", text: "请只根据这张图片完成评价，并严格输出 JSON。" },
                  {
                    type: "image_url",
                    image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}` }
                  }
                ]
              }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1200,
            stream: false
          }),
          signal: requestSignal
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 300);
          return {
            identity: identityOf(runtime),
            result: {
              status: response.status === 429 ? "rate_limited" as const : "network_error" as const,
              dimensions: [],
              reasonCode: `local_http_${response.status}`,
              summary: detail || `本地评论模型返回 HTTP ${response.status}`
            }
          };
        }
        const payload = await response.json() as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) return invalidLocalResult(runtime, "本地评论模型没有返回内容");
        const parsed = parseJsonObject(content);
        if (!parsed) return invalidLocalResult(runtime, "本地评论模型返回的内容无法解析为 JSON");
        const validation = validateEvaluationDimensions(parsed.dimensions, suite);
        if (!validation.valid || !validation.normalized) {
          return invalidLocalResult(runtime, `本地评论模型返回格式不合规：${validation.errors?.join("；")}`);
        }
        const summary = typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 300)
          : undefined;
        return {
          identity: identityOf(runtime),
          result: {
            status: "success",
            dimensions: validation.normalized,
            ...(summary ? { summary } : {}),
            rawUsage: {
              promptTokens: payload.usage?.prompt_tokens,
              completionTokens: payload.usage?.completion_tokens
            }
          }
        };
      } catch (error) {
        const identity = identityOf(runtime);
        if (signal?.aborted) {
          this.close();
          return {
            identity,
            result: { status: "cancelled", dimensions: [], reasonCode: "local_cancelled", summary: "已取消本次本地图片评论。" }
          };
        }
        if (timeoutSignal.aborted) {
          this.close();
          return {
            identity,
            result: { status: "timeout", dimensions: [], reasonCode: "local_timeout", summary: "本地评论超过 90 秒，已停止模型进程并释放资源。" }
          };
        }
        this.close();
        return {
          identity,
          result: {
            status: "network_error",
            dimensions: [],
            reasonCode: "local_request_failed",
            summary: error instanceof Error ? error.message : "本地评论模型请求失败"
          }
        };
      } finally {
        if (this.#process) this.#scheduleIdleShutdown();
      }
    });
    this.#queue = task.catch(() => undefined);
    return task;
  }

  close(): void {
    this.#clearIdleTimer();
    const child = this.#process;
    this.#process = null;
    this.#runtime = null;
    this.#endpoint = "";
    this.#apiKey = "";
    if (child && !child.killed) child.kill();
  }

  async #ensureStarted(runtime: ResolvedRuntimeModel): Promise<void> {
    if (this.#process && !this.#process.killed && this.#runtime?.entry.id === runtime.entry.id) return;
    this.close();
    const port = await reserveLoopbackPort();
    const apiKey = randomUUID();
    const command = this.#buildCommand(runtime, port, apiKey);
    if (!existsSync(command.executable)) throw new Error("本地评论模型运行时文件缺失");
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.#process = child;
    this.#runtime = runtime;
    this.#endpoint = `http://127.0.0.1:${port}`;
    this.#apiKey = apiKey;
    let recentLog = "";
    const collectLog = (chunk: Buffer) => { recentLog = `${recentLog}${chunk.toString("utf8")}`.slice(-2_000); };
    child.stdout?.on("data", collectLog);
    child.stderr?.on("data", collectLog);
    const deadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        this.close();
        throw new Error(`本地评论模型启动失败：${recentLog.trim() || `进程退出码 ${child.exitCode}`}`);
      }
      try {
        const response = await this.#fetch(`${this.#endpoint}/health`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(1_500)
        });
        if (response.ok) return;
      } catch {
        // Model loading is expected to take multiple probes.
      }
      await delay(350);
    }
    this.close();
    throw new Error(`本地评论模型启动超时。${recentLog.trim() ? `最近日志：${recentLog.trim()}` : ""}`);
  }

  #scheduleIdleShutdown(): void {
    this.#clearIdleTimer();
    this.#idleTimer = setTimeout(() => this.close(), this.#idleTimeoutMs);
    this.#idleTimer.unref?.();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }
}

function defaultCommand(runtime: ResolvedRuntimeModel, port: number, apiKey: string) {
  const directory = runtime.modelDirectory;
  const modelFile = runtime.entry.files.find((file) => file.fileName.endsWith(".gguf") && !/^mmproj/i.test(file.fileName));
  const projectionFile = runtime.entry.files.find((file) => /^mmproj.*\.gguf$/i.test(file.fileName));
  if (!modelFile || !projectionFile) throw new Error("本地评论模型清单缺少 GGUF 权重或视觉投影文件");
  return {
    executable: join(directory, "llama-server.exe"),
    cwd: directory,
    args: [
      "--model", join(directory, modelFile.fileName),
      "--mmproj", join(directory, projectionFile.fileName),
      "--host", "127.0.0.1",
      "--port", String(port),
      "--api-key", apiKey,
      "--ctx-size", "4096",
      "--parallel", "1",
      "--n-gpu-layers", "99",
      "--jinja",
      "--no-webui"
    ]
  };
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function identityOf(runtime: ResolvedRuntimeModel): LocalArtCriticIdentity {
  return {
    modelId: runtime.entry.id,
    modelVersion: runtime.entry.version,
    evaluatorVersion: `llama.cpp-b10516:${runtime.entry.version}`
  };
}

function invalidLocalResult(runtime: ResolvedRuntimeModel, summary: string) {
  return {
    identity: identityOf(runtime),
    result: {
      status: "invalid_response" as const,
      dimensions: [],
      reasonCode: "local_invalid_response",
      summary
    }
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
