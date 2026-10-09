import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { stat, mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { connectElectronMainInspector } from "./electron-smoke-support.mjs";
import { DEFAULT_LIBRARY_PREFERENCES } from "../packages/domain/dist/index.js";

const executable = resolve(process.argv[2] ?? "release/win-unpacked/DigitalSanctuary.exe");
const resources = join(executable, "..", "resources");
const visionExecutable = join(resources, "vision-runtime", "sanctuary-vision.exe");
const model = join(resources, "models", "wd-swinv2-tagger-v3", "model.onnx");
const userData = await mkdtemp(join(tmpdir(), "sanctuary-packaged-smoke-"));
const oldStorage = join(userData, "OldStorage", "Pixiv");
const newStorage = join(userData, "NewStorage", "Pixiv");
const oldPaths = [0, 1].map((page) => join(oldStorage, "900", `900_p${page}.png`));
const newPaths = [0, 1].map((page) => join(newStorage, "900", `900_p${page}.png`));
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
await mkdir(join(oldStorage, "900"), { recursive: true });
for (const path of oldPaths) await writeFile(path, image);
// A pre-work-model library, including a multi-page Pixiv work and an existing album.
const legacy = new DatabaseSync(join(userData, "library.db"));
legacy.exec(`CREATE TABLE artworks (id TEXT PRIMARY KEY, path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  file_name TEXT NOT NULL, imported_at TEXT NOT NULL, assessment_json TEXT, decision_json TEXT,
  source_platform TEXT, source_work_id TEXT, source_page_index INTEGER, author_id TEXT, author_name TEXT, work_title TEXT);
  CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    cover_artwork_id TEXT REFERENCES artworks(id), created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks (collection_id TEXT NOT NULL, artwork_id TEXT NOT NULL, PRIMARY KEY(collection_id, artwork_id));
  CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);`);
const now = new Date().toISOString();
for (const [page, path] of oldPaths.entries()) legacy.prepare("INSERT INTO artworks VALUES (?, ?, ?, ?, NULL, NULL, 'pixiv', '900', ?, '77', '旧版作者', '旧版双页作品')")
  .run(`a${page}`, path, `900_p${page}.png`, now, page);
legacy.prepare("INSERT INTO collections VALUES ('c1', '旧版相册', '', 'a1', ?)").run(now);
legacy.exec("INSERT INTO collection_artworks VALUES ('c1', 'a0'), ('c1', 'a1')");
legacy.prepare("INSERT INTO user_preferences VALUES ('library.preferences', ?, ?)")
  .run(JSON.stringify({ ...DEFAULT_LIBRARY_PREFERENCES, downloadDirectory: oldStorage }), now);
legacy.close();
const port = await availablePort(), mainPort = await availablePort();
function launch() {
  return spawn(executable, [`--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
    { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") }, stdio: "ignore", windowsHide: true });
}
let child = launch();
let inspector;

try {
  const [visionStat, modelStat, target] = await Promise.all([
    stat(visionExecutable),
    stat(model),
    waitForRenderer(port, 20_000)
  ]);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  inspector = await connectElectronMainInspector(mainPort);
  try {
    const state = await cdp.evaluate(`(async () => {
      const bridgeStarted = Date.now();
      while (!window.sanctuary && Date.now() - bridgeStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));

      let appStatus = await window.sanctuary.status();
      const visionStarted = Date.now();
      while (appStatus.visionState === "starting" && Date.now() - visionStarted < 60000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        appStatus = await window.sanctuary.status();
      }

      // The installer ships without the offline picture model, so the gallery search must fall back to names.
      const searchStarted = Date.now();
      while (!(document.querySelector(".gallery-search-field input")?.placeholder.includes("Pixiv ID") && !document.querySelector(".gallery-search-mode"))
        && Date.now() - searchStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));
      const searchPlaceholder = document.querySelector(".gallery-search-field input")?.placeholder ?? "";
      const pictureSearchToggle = Boolean(document.querySelector(".gallery-search-mode"));

      const navigationStarted = Date.now();
      while (!document.querySelector('[data-nav="inspiration"]') && Date.now() - navigationStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));
      const creation = document.querySelector('[data-nav="inspiration"]');
      creation?.click();
      const analysisStarted = Date.now();
      while (!document.querySelector(".inspiration-view") && Date.now() - analysisStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        title: document.title,
        searchPlaceholder,
        pictureSearchToggle,
        appStatus,
        creationReady: Boolean(document.querySelector(".inspiration-view")),
        activeNavigation: document.querySelector(".app-rail [aria-current='page']")?.textContent.trim() ?? ""
      };
    })()`);
    const failures = [];
    if (!visionStat.isFile() || visionStat.size < 100_000) failures.push("vision runtime missing");
    if (!modelStat.isFile() || modelStat.size < 100_000_000) failures.push("WD Tagger model missing");
    if (state.appStatus.visionEngine !== "wd-swinv2-tagger-v3") failures.push("packaged app did not select WD Tagger");
    if (!state.appStatus.visionReady || state.appStatus.visionState !== "ready") failures.push("packaged WD Tagger did not become ready");
    if (!state.searchPlaceholder.includes("Pixiv ID") || state.pictureSearchToggle) failures.push("gallery search did not fall back to names");
    if (!state.creationReady) failures.push("creation view did not render");
    if (state.activeNavigation !== "创作") failures.push("navigation accessibility state is missing");
    console.log(JSON.stringify({ executable, visionRuntimeMb: Math.round(visionStat.size / 1024 / 1024 * 10) / 10, modelMb: Math.round(modelStat.size / 1024 / 1024), ...state, status: failures.length ? "failed" : "passed", failures }, null, 2));
    if (failures.length) process.exitCode = 1;
    assert.equal(failures.length, 0, failures.join("; "));
    const before = await cdp.evaluate("window.sanctuary.queryWorks({})");
    assert.equal(before.total, 1);
    assert.equal(before.items[0].pageCount, 2);
    assert.equal((await cdp.evaluate("window.sanctuary.getLibraryPreferences()")).downloadDirectory, oldStorage);
    await stat(join(userData, "library.db.pre-v2.bak"));
    await cdp.evaluate("window.sanctuary.updateWorkFavorite(['pixiv:900'], true)");
    await inspector.evaluate(`(() => {
      const { dialog } = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(newStorage)}] });
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    })()`);
    await mkdir(join(newStorage, "900"), { recursive: true });
    await writeFile(newPaths[0], "conflict");
    const conflict = await cdp.evaluate("window.sanctuary.chooseDownloadDirectory().then(() => false, error => error.message)");
    assert.match(conflict, /未覆盖/);
    assert.equal(await readFile(newPaths[0], "utf8"), "conflict");
    assert.equal((await cdp.evaluate("window.sanctuary.getLibraryPreferences()")).downloadDirectory, oldStorage);
    await rm(newPaths[0]);
    const migrated = await cdp.evaluate("window.sanctuary.chooseDownloadDirectory()");
    assert.equal(migrated.migrationResult.migratedAssets, 2);
    assert.equal(migrated.preferences.downloadDirectory, newStorage);
    for (const path of [...oldPaths, ...newPaths]) assert.deepEqual(await readFile(path), image);
    const work = await cdp.evaluate("window.sanctuary.getWork('pixiv:900')");
    assert.deepEqual(work.assets.map((asset) => asset.path), newPaths);
    assert.deepEqual(work.collectionIds, ["c1"]);
    assert.equal((await cdp.evaluate("window.sanctuary.queryWorks({ favorite: true })")).total, 1);
    assert.ok((await readdir(join(userData, "Backups"))).some((name) => name.startsWith("library.pre-storage-")));
    console.log(JSON.stringify({ legacyUpgrade: "passed", storageMigration: "passed", pages: 2,
      originalsRetained: true, conflictPreserved: true, albumAndFavoriteRetained: true }, null, 2));
  } finally {
    cdp.close();
  }
  inspector.close(); inspector = undefined;
  await stopChild();
  child = launch();
  const restartedTarget = await waitForRenderer(port, 20_000);
  const restarted = await connectCdp(restartedTarget.webSocketDebuggerUrl);
  try {
    const work = await restarted.evaluate(`(async () => {
      while (!window.sanctuary) await new Promise(done => setTimeout(done, 25));
      return window.sanctuary.getWork('pixiv:900');
    })()`);
    assert.deepEqual(work.assets.map((asset) => asset.path), newPaths);
    assert.deepEqual(work.collectionIds, ["c1"]);
    assert.equal((await restarted.evaluate("window.sanctuary.queryWorks({ favorite: true })")).total, 1);
    console.log(JSON.stringify({ restartAfterMigration: "passed" }));
  } finally { restarted.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  inspector?.close();
  await stopChild();
  await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

async function stopChild() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolveTask) => {
    if (child.exitCode !== null || child.signalCode !== null) resolveTask();
    else { child.once("exit", resolveTask); setTimeout(resolveTask, 2_000); }
  });
  assert.ok(child.exitCode !== null || child.signalCode !== null, "Isolated application did not exit before restart/cleanup");
}

async function availablePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function waitForRenderer(debugPort, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {}
    await new Promise((resolveTask) => setTimeout(resolveTask, 100));
  }
  throw new Error("Packaged renderer did not expose a CDP target");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  await new Promise((resolveTask, reject) => {
    socket.addEventListener("open", resolveTask, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    async evaluate(expression) {
      const response = await new Promise((resolveTask, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve: resolveTask, reject });
        socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    },
    close() { socket.close(); }
  };
}
