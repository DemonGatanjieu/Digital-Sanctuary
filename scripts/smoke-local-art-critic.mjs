import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { extname, join, resolve } from "node:path";

const runtimeDirectory = resolve(process.argv[2] ?? ".");
const modelDirectory = resolve(process.argv[3] ?? ".");
const imagePath = resolve(process.argv[4] ?? "");
const executable = join(runtimeDirectory, "llama-server.exe");
const modelPath = join(modelDirectory, "Qwen3VL-2B-Instruct-Q4_K_M.gguf");
const projectionPath = join(modelDirectory, "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf");
const apiKey = `sanctuary-smoke-${randomUUID()}`;
const port = await reservePort();
const endpoint = `http://127.0.0.1:${port}`;
const logs = [];
let detectedProvider = "CPU / unknown";

const child = spawn(executable, [
  "--model", modelPath,
  "--mmproj", projectionPath,
  "--host", "127.0.0.1",
  "--port", String(port),
  "--api-key", apiKey,
  "--ctx-size", "4096",
  "--parallel", "1",
  "--n-gpu-layers", "99",
  "--jinja",
  "--no-webui"
], {
  cwd: runtimeDirectory,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill();
    process.exitCode = 130;
  });
}

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    const text = String(chunk);
    if (/Vulkan|ggml_vulkan|CUDA/i.test(text)) detectedProvider = "GPU";
    logs.push(text);
    while (logs.join("").length > 12_000) logs.shift();
  });
}

try {
  await waitForHealth(child, endpoint, apiKey, 150_000);
  const image = await readFile(imagePath);
  const mime = mimeType(imagePath);
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "qwen3-vl-2b-instruct-q4",
      messages: [
        {
          role: "system",
          content: `你是一位谨慎的视觉艺术评论者。先真正观察这张具体图片，再自行选择恰好六个最能解释这张作品特点的画面维度。作品不同，六个维度也应当可能不同。每项都必须包含唯一英文 lowercase_snake_case 的 key、原创简短中文 label、0 到 100 的真实数字 score，以及点出这张图中可见具体证据的中文 reason。既然维度是你主动选择的显著方面，分数必须有区分度，不得全部填 0，不得照抄字段说明或占位词。只返回一个含 dimensions 数组和一句中文 summary 的有效 JSON 对象，不要输出 Markdown、示例值或前后解释。`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "请只根据这张图片完成评价，并严格输出 JSON。" },
            { type: "image_url", image_url: { url: `data:${mime};base64,${image.toString("base64")}` } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1200,
      stream: false
    }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) throw new Error(`inference HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("model response has no message content");
  const parsed = parseJsonObject(content);
  validateAdaptiveDimensions(parsed?.dimensions);
  console.log(JSON.stringify({
    status: "passed",
    runtime: "llama.cpp b10516",
    model: "Qwen3-VL 2B Instruct Q4_K_M",
    executionProvider: detectedProvider,
    dimensions: parsed.dimensions.map(({ label, score }) => ({ label, score })),
    summary: parsed.summary,
    usage: payload.usage
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    recentRuntimeLog: logs.join("").slice(-4_000)
  }, null, 2));
  process.exitCode = 1;
} finally {
  child.kill();
}

function reservePort() {
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

async function waitForHealth(process, baseUrl, key, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`runtime exited with code ${process.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(1_500)
      });
      if (response.ok) return;
    } catch {
      // Loading a local model may need dozens of probes.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
  throw new Error("runtime health probe timed out");
}

function mimeType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function parseJsonObject(content) {
  const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").trim();
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("model output is not JSON");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function validateAdaptiveDimensions(dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length !== 6) throw new Error("model did not return exactly six dimensions");
  const keys = new Set();
  const labels = new Set();
  for (const dimension of dimensions) {
    if (!dimension || typeof dimension !== "object") throw new Error("dimension is not an object");
    if (!/^[a-z][a-z0-9_]{1,48}$/.test(dimension.key) || keys.has(dimension.key)) throw new Error("dimension key is invalid or duplicated");
    if (typeof dimension.label !== "string" || !dimension.label.trim()) throw new Error("dimension label is missing");
    const label = dimension.label.trim().toLowerCase();
    if (["short chinese label", "label", "标签", "维度"].includes(label) || labels.has(label)) throw new Error("dimension label is a placeholder or duplicated");
    if (typeof dimension.score !== "number" || dimension.score < 0 || dimension.score > 100) throw new Error("dimension score is out of range");
    if (typeof dimension.reason !== "string" || dimension.reason.trim().length < 4) throw new Error("dimension has no concrete visual reason");
    keys.add(dimension.key);
    labels.add(label);
  }
  if (dimensions.every((dimension) => dimension.score === 0)) throw new Error("model returned zero for every dimension");
}
