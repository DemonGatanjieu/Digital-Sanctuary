const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

export class ComfyUiClient {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImplementation: typeof fetch = globalThis.fetch) {
    this.baseUrl = normalizeLoopbackComfyUrl(baseUrl);
    this.#fetch = fetchImplementation;
  }

  async testConnection(): Promise<{ success: true; latencyMs: number; deviceName: string }> {
    const started = Date.now();
    const data = await this.#requestJson("/system_stats", { method: "GET" });
    const deviceName = extractDeviceName(data);
    return { success: true, latencyMs: Date.now() - started, deviceName };
  }

  async uploadImage(bytes: Uint8Array, fileName: string, mimeType: string): Promise<string> {
    if (!isSafeFileComponent(fileName)) throw new Error("参考图文件名无效");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("参考图大小无效");
    const form = new FormData();
    form.append("image", new Blob([Uint8Array.from(bytes).buffer], { type: mimeType }), fileName);
    form.append("type", "input");
    form.append("overwrite", "true");
    const data = await this.#requestJson("/upload/image", { method: "POST", body: form }, 60_000);
    const uploaded = isPlainObject(data) && typeof data.name === "string" ? data.name : "";
    if (!isSafeFileComponent(uploaded)) throw new Error("ComfyUI 返回了无效的上传文件名");
    return uploaded;
  }

  async queuePrompt(workflow: Record<string, unknown>, clientId: string): Promise<string> {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(clientId)) throw new Error("ComfyUI client ID 无效");
    const data = await this.#requestJson("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    }, 30_000);
    const promptId = isPlainObject(data) && typeof data.prompt_id === "string" ? data.prompt_id : "";
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(promptId)) throw new Error("ComfyUI 未返回有效任务 ID");
    return promptId;
  }

  async getHistory(promptId: string): Promise<{ complete: boolean; error: string; images: ComfyOutputImage[] }> {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(promptId)) throw new Error("ComfyUI 任务 ID 无效");
    const data = await this.#requestJson(`/history/${encodeURIComponent(promptId)}`, { method: "GET" });
    if (!isPlainObject(data)) throw new Error("ComfyUI 历史响应格式无效");
    const record = data[promptId];
    if (!record) return { complete: false, error: "", images: [] };
    if (!isPlainObject(record)) throw new Error("ComfyUI 任务历史格式无效");
    const status = isPlainObject(record.status) ? record.status : {};
    const statusText = typeof status.status_str === "string" ? status.status_str : "";
    const completed = status.completed === true || statusText === "success";
    const error = statusText === "error" ? "ComfyUI 工作流执行失败" : "";
    const images: ComfyOutputImage[] = [];
    if (isPlainObject(record.outputs)) {
      for (const output of Object.values(record.outputs)) {
        if (!isPlainObject(output) || !Array.isArray(output.images)) continue;
        for (const image of output.images) {
          if (!isPlainObject(image)) continue;
          const filename = typeof image.filename === "string" ? image.filename : "";
          const subfolder = typeof image.subfolder === "string" ? image.subfolder : "";
          const type = typeof image.type === "string" ? image.type : "output";
          if (!isSafeFileComponent(filename) || !isSafeRelativePath(subfolder) || !/^(?:output|temp)$/.test(type)) continue;
          images.push({ filename, subfolder, type });
        }
      }
    }
    return { complete: completed, error, images: images.slice(0, 32) };
  }

  async downloadImage(image: ComfyOutputImage): Promise<{ bytes: Uint8Array; contentType: string }> {
    if (!isSafeFileComponent(image.filename) || !isSafeRelativePath(image.subfolder) || !/^(?:output|temp)$/.test(image.type)) {
      throw new Error("ComfyUI 输出图片路径无效");
    }
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
    const response = await this.#fetchWithTimeout(`/view?${query.toString()}`, { method: "GET" }, 60_000);
    if (!response.ok) throw new Error(`ComfyUI 图片下载失败 (${response.status})`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(contentType)) {
      throw new Error("ComfyUI 输出不是受支持的安全栅格图片");
    }
    const bytes = await readResponseBytes(response, MAX_IMAGE_BYTES);
    return { bytes, contentType };
  }

  async #requestJson(path: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const response = await this.#fetchWithTimeout(path, init, timeoutMs);
    if (!response.ok) throw new Error(`ComfyUI 请求失败 (${response.status})`);
    const bytes = await readResponseBytes(response, MAX_JSON_BYTES);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("ComfyUI 返回了无效 JSON");
    }
  }

  async #fetchWithTimeout(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.#fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store"
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("ComfyUI 请求超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function normalizeLoopbackComfyUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("ComfyUI 地址无效");
  }
  const host = url.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (url.protocol !== "http:" || !isLoopback) throw new Error("ComfyUI 只允许使用本机 HTTP 回环地址");
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("ComfyUI 地址不能包含账号、路径、查询参数或片段");
  }
  return `${url.protocol}//${url.host}`;
}

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > limit) throw new Error("ComfyUI 响应超过大小上限");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("ComfyUI 响应超过大小上限");
    }
    chunks.push(result.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function extractDeviceName(data: unknown): string {
  if (!isPlainObject(data) || !isPlainObject(data.devices)) return "本地 ComfyUI";
  return "本地 ComfyUI";
}

function isSafeFileComponent(value: string): boolean {
  return value.length > 0 && value.length <= 255 && !/[\\/:*?"<>|]/.test(value) && value !== "." && value !== "..";
}

function isSafeRelativePath(value: string): boolean {
  return value.length <= 500 && !/^(?:[a-zA-Z]:|\\|\/|file:)/i.test(value) && !value.split(/[\\/]/).includes("..");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
