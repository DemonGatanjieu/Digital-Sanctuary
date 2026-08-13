import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const resources = resolve(process.argv[2] ?? ".");
const bundledLayout = resources.endsWith("resources");
const executable = bundledLayout
  ? join(resources, "vision-runtime", "sanctuary-vision.exe")
  : resolve("build/vision/sanctuary-vision/sanctuary-vision.exe");
const modelDirectory = bundledLayout
  ? join(resources, "models", "wd-swinv2-tagger-v3")
  : resolve("models/wd-swinv2-tagger-v3");
const directory = await mkdtemp(join(tmpdir(), "sanctuary-vision-smoke-"));
const imagePath = join(directory, "pixel.png");
await writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

try {
  const response = await classify(executable, modelDirectory, imagePath);
  const payload = response?.payload;
  const failures = [];
  if (response?.type !== "classify-image-result") failures.push("vision protocol response failed");
  if (payload?.engine !== "wd-swinv2-tagger-v3") failures.push("wrong packaged engine");
  if (payload?.status !== "complete") failures.push("packaged inference did not complete");
  console.log(JSON.stringify({ executable, engine: payload?.engine, provider: payload?.executionProvider, elapsedMs: payload?.elapsedMs, status: failures.length ? "failed" : "passed", failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

function classify(command, model, image) {
  return new Promise((resolveTask, reject) => {
    const child = spawn(command, [], { windowsHide: true, env: { ...process.env, WD_TAGGER_MODEL_DIR: model } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Packaged inference timed out")); }, 45_000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(stderr || `Vision runtime exited with ${code}`)); return; }
      try { resolveTask(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); }
      catch { reject(new Error(`Invalid vision output: ${stdout || stderr}`)); }
    });
    child.stdin.end(`${JSON.stringify({ version: 1, id: "bundle-smoke", type: "classify-image", payload: { imagePath: image } })}\n`);
  });
}
