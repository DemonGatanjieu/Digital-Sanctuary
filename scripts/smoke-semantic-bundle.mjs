// Runs the frozen picture-search worker against a model folder, outside the app.
// Usage: node scripts/smoke-semantic-bundle.mjs [runtime-folder] [model-folder]
// Needs the synthetic images from `.venv-semantic/Scripts/python.exe scripts/smoke-semantic.py --device cpu`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

const runtime = resolve(process.argv[2] ?? "build/semantic/sanctuary-semantic");
const model = resolve(process.argv[3] ?? "models/embeddinggemma-2");
const images = resolve(".tmp/semantic-smoke");
const executable = join(runtime, "sanctuary-semantic.exe");
for (const path of [executable, join(model, "sanctuary.manifest.json"), join(images, "blue-sky-and-sun.png")]) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
}

const requests = [
  { id: "query", kind: "query", value: "蓝天和太阳" },
  { id: "sky", kind: "image", value: join(images, "blue-sky-and-sun.png") },
  { id: "night", kind: "image", value: join(images, "night-moon-and-stars.png") },
  { id: "red", kind: "image", value: join(images, "red-square.png") }
];
const started = Date.now();
const child = spawn(executable, [model], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let diagnostics = "";
child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-6000); });
const vectors = new Map();
let readyMs = 0;
const timeout = setTimeout(() => finish(new Error("Frozen worker timed out")), 240_000);

createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.ready) {
    readyMs = Date.now() - started;
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    return;
  }
  if (message.error) return finish(new Error(`${message.id ?? "startup"}: ${message.error}`));
  vectors.set(message.id, message.vector);
  if (vectors.size === requests.length) finish();
});
child.once("exit", (code) => { if (vectors.size < requests.length) finish(new Error(`Frozen worker exited with ${code}`)); });

let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.kill();
  if (error) {
    console.error(diagnostics);
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const failures = [];
  for (const [id, vector] of vectors) {
    const norm = Math.hypot(...vector);
    if (vector.length !== 768 || !vector.every(Number.isFinite) || Math.abs(norm - 1) > 0.02) failures.push(`${id} is not a unit 768-d vector`);
  }
  const query = vectors.get("query");
  const similarity = Object.fromEntries(["sky", "night", "red"].map((id) => [id, round(dot(query, vectors.get(id)))]));
  if (!(similarity.sky > similarity.night && similarity.sky > similarity.red)) failures.push("the sky picture did not rank first for a sky query");
  console.log(JSON.stringify({ executable, readyMs, similarity, status: failures.length ? "failed" : "passed", failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

function dot(a, b) { return a.reduce((sum, value, index) => sum + value * b[index], 0); }
function round(value) { return Math.round(value * 1000) / 1000; }
