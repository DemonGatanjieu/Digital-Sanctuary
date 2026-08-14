import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const port = 9239;
const userData = await mkdtemp(join(tmpdir(), "sanctuary-library-images-"));
const imagePath = join(userData, "original.png");
const thumbnailPath = join(userData, "registered-thumbnail.png");
const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
await Promise.all([writeFile(imagePath, imageBytes), writeFile(thumbnailPath, imageBytes)]);

const database = new DatabaseSync(join(userData, "library.db"));
database.exec(`
  CREATE TABLE works (
    id TEXT PRIMARY KEY, source_platform TEXT, source_work_id TEXT, artist_id TEXT,
    title TEXT NOT NULL, work_type TEXT NOT NULL, published_at TEXT, bookmarked_at TEXT,
    saved_at TEXT NOT NULL, last_viewed_at TEXT, favorite INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0, cover_asset_id TEXT, ownership TEXT NOT NULL,
    deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL, legacy_artwork_id TEXT UNIQUE,
    page_index INTEGER NOT NULL, path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    media_type TEXT NOT NULL, extension TEXT, width INTEGER, height INTEGER,
    byte_length INTEGER, content_hash TEXT, thumbnail_path TEXT, file_state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (work_id, page_index)
  );
`);
const timestamp = new Date().toISOString();
database.prepare(
  `INSERT INTO works (
    id, title, work_type, saved_at, favorite, page_count, cover_asset_id,
    ownership, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`
).run("fixture-work", "Registered thumbnail fixture", "local", timestamp, "fixture-asset", "managed", timestamp, timestamp);
database.prepare(
  `INSERT INTO assets (
    id, work_id, page_index, path, media_type, extension, width, height,
    byte_length, thumbnail_path, file_state, created_at, updated_at
  ) VALUES (?, ?, 0, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)`
).run("fixture-asset", "fixture-work", imagePath, "image", ".png", imageBytes.length, thumbnailPath, "available", timestamp, timestamp);
database.close();

const electron = resolve("node_modules/electron/dist/electron.exe");
const entry = resolve("apps/desktop/out/main/index.js");
const child = spawn(
  electron,
  [entry, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
);
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  const target = await waitForRenderer(port, 15_000);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    const result = await cdp.evaluate(`(async () => {
      const started = performance.now();
      let image;
      while (!(image = document.querySelector(".work-library-card img")) || !image.currentSrc) {
        if (performance.now() - started > 10000) throw new Error("library image did not render");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!image.complete) await new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
        setTimeout(resolve, 5000);
      });
      return {
        cardCount: document.querySelectorAll(".work-library-card").length,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        protocol: new URL(image.currentSrc).protocol
      };
    })()`);
    const failures = [];
    if (result.cardCount !== 1) failures.push("fixture card did not render");
    if (!result.complete || result.naturalWidth < 1) failures.push("registered thumbnail failed to load");
    if (result.protocol !== "sanctuary-image:") failures.push("renderer bypassed the local image protocol");
    console.log(JSON.stringify({ ...result, status: failures.length ? "failed" : "passed", failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    cdp.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise((resolveTask) => {
    if (child.exitCode !== null) resolveTask();
    else {
      child.once("exit", resolveTask);
      setTimeout(resolveTask, 2_000);
    }
  });
  await rm(userData, { recursive: true, force: true });
}

async function waitForRenderer(debugPort, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {}
    await new Promise((resolveTask) => setTimeout(resolveTask, 100));
  }
  throw new Error("Electron renderer did not expose a CDP target");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolveTask, reject) => {
    socket.addEventListener("open", resolveTask, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    async evaluate(expression) {
      const response = await new Promise((resolveTask, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveTask, reject });
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    },
    close() { socket.close(); }
  };
}
