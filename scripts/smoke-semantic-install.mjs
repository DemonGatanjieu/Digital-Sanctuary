// Packaged app, isolated profile: install "按画面找图" through the model center, then search the gallery with it.
// The main process network layer is pointed at local copies of the exact pinned files (models/embeddinggemma-2 and
// build/semantic/sanctuary-semantic-runtime-1.zip), so download verification, unpacking, the manifest and the
// frozen worker all run for real without touching Hugging Face or GitHub.
// Usage: node scripts/smoke-semantic-install.mjs [packaged-exe]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

const executable = resolve(process.argv[2] ?? "release/win-unpacked/DigitalSanctuary.exe");
const modelSource = resolve("models/embeddinggemma-2"), runtimePack = resolve("build/semantic/sanctuary-semantic-runtime-1.zip");
const root = await mkdtemp(join(resolve(tmpdir()), "sanctuary-semantic-install-")), userData = join(root, "user-data"), localAppData = join(root, "LocalAppData");
await mkdir(userData);
const names = ["blue-sky-and-sun", "night-moon-and-stars", "red-square"];
const db = new DatabaseSync(join(userData, "library.db"));
db.exec(`CREATE TABLE artworks(id TEXT PRIMARY KEY,path TEXT NOT NULL COLLATE NOCASE UNIQUE,file_name TEXT NOT NULL,imported_at TEXT NOT NULL,assessment_json TEXT,decision_json TEXT,source_platform TEXT,source_work_id TEXT,source_page_index INTEGER,author_id TEXT,author_name TEXT,work_title TEXT);
  CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_artwork_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks(collection_id TEXT NOT NULL,artwork_id TEXT NOT NULL,PRIMARY KEY(collection_id,artwork_id));
  CREATE TABLE user_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
const stamp = new Date().toISOString();
for (const [index, name] of names.entries()) {
  const path = join(root, `${name}.png`);
  await writeFile(path, await readFile(resolve(`.tmp/semantic-smoke/${name}.png`)));
  db.prepare("INSERT INTO artworks(id,path,file_name,imported_at,work_title)VALUES(?,?,?,?,?)").run(`seed-${index}`, path, `${name}.png`, stamp, name);
}
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("library.preferences", JSON.stringify({ defaultView: "flat", defaultSortBy: "title", defaultSortDirection: "asc", gridDensity: "comfortable", downloadDirectory: join(root, "Storage", "Pixiv") }), stamp);
db.close();

const port = await availablePort(), mainPort = await availablePort();
const child = spawn(executable, [`--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
  { windowsHide: true, stdio: "ignore", env: { ...process.env, LOCALAPPDATA: localAppData } });
let main, cdp;
const step = (name) => console.log(`[step] ${name}`);
try {
  main = await connectElectronMainInspector(mainPort);
  await showElectronTestWindow(main);
  await main.evaluate(`(() => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { net } = require('electron'), fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), { Readable } = process.getBuiltinModule('stream');
    const original = net.fetch.bind(net), modelSource = ${JSON.stringify(modelSource)}, runtimePack = ${JSON.stringify(runtimePack)};
    globalThis.__semanticServed = [];
    net.fetch = async (input, init) => {
      const url = String(input), pinned = url.match(/^https:\\/\\/huggingface\\.co\\/google\\/embeddinggemma-2\\/resolve\\/[0-9a-f]{40}\\/(.+)$/);
      const file = pinned ? path.join(modelSource, ...pinned[1].split('/')) : url.endsWith('/sanctuary-semantic-runtime-1.zip') ? runtimePack : null;
      if (!file) return original(input, init);
      globalThis.__semanticServed.push(url);
      return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { 'content-length': String(fs.statSync(file).size) } });
    };
    return true;
  })()`);
  step('renderer');
  cdp = await renderer();
  await waitFor("Boolean(window.sanctuary && document.querySelector('.gallery-search-field input'))");
  assert.equal((await cdp.evaluate("window.sanctuary.semanticAvailability()")).available, false);
  await waitFor("document.querySelector('.gallery-search-field input').placeholder.includes('Pixiv ID') && !document.querySelector('.gallery-search-mode')");

  step('open model center');
  await click('[data-nav="settings"]');
  await clickText(".settings-navigation button", "模型管理");
  await clickText(".model-capability-tabs button", "按画面找图");
  await waitFor("[...document.querySelectorAll('.model-card h2')].some(e => e.textContent === 'EmbeddingGemma 2')");
  step('install');
  const installStarted = Date.now();
  await clickText(".model-card button", "下载到本机");
  await waitFor("document.querySelector('.model-center-notice')?.textContent.includes('找图模型已安装') || /失败|校验|错误/.test(document.querySelector('.model-center-notice, [role=alert]')?.textContent ?? '')", 900_000);
  const notice = await cdp.evaluate("document.querySelector('.model-center-notice')?.textContent ?? ''");
  assert.match(notice, /找图模型已安装/);
  const installMs = Date.now() - installStarted;
  const served = await main.evaluate("globalThis.__semanticServed.length");
  assert.equal(served, 16);
  assert.equal((await cdp.evaluate("window.sanctuary.semanticAvailability()")).available, true);
  await waitFor("[...document.querySelectorAll('.model-card')].some(e => e.textContent.includes('已安装，可以使用'))");

  step('search');
  await click('[data-nav="gallery"]');
  await waitFor("document.querySelector('.gallery-search-mode')?.textContent === '按名称'");
  await click(".gallery-search-mode");
  await fill(".gallery-search-field input", "夜晚，月亮和星星");
  const searchStarted = Date.now();
  await cdp.evaluate("document.querySelector('.gallery-search-field').requestSubmit()");
  await waitFor("(async()=>{const s=await window.sanctuary.currentGalleryPictureSearch();return s&&!['scanning','analyzing'].includes(s.progress.phase)})()", 300_000);
  const search = await cdp.evaluate("window.sanctuary.currentGalleryPictureSearch()");
  assert.equal(search.progress.phase, "completed", JSON.stringify(search.progress));
  assert.equal(search.result.items[0].id, "local:seed-1");
  console.log(JSON.stringify({ status: "passed", executable, installMs, servedFiles: served, searchMs: Date.now() - searchStarted, topResult: search.result.items[0].title }, null, 2));
} catch (error) {
  console.error(error.stack || error);
  if (cdp) console.error(await cdp.evaluate("document.querySelector('.model-center-notice, [role=alert]')?.textContent ?? ''").catch(() => ""));
  process.exitCode = 1;
} finally {
  cdp?.close(); main?.close(); child.kill();
  await new Promise(done => { if (child.exitCode !== null) done(); else { child.once("exit", done); setTimeout(done, 3000); } });
  const absolute = resolve(root);
  if (!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-semantic-install-`)) throw new Error("Unexpected temporary directory");
  await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

async function waitFor(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await cdp.evaluate(expression)) return; await new Promise(done => setTimeout(done, 250)); } throw new Error(`Timed out: ${expression}`); }
async function click(selector) { await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function clickText(selector, text) { await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled)`); await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled).click()`); }
async function fill(selector, value) { await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
async function renderer() { const start = Date.now(); while (Date.now() - start < 20000) { try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), target = targets.find(t => t.type === "page" && t.url?.includes("index.html")); if (target?.webSocketDebuggerUrl) return connect(target.webSocketDebuggerUrl); } catch {} await new Promise(done => setTimeout(done, 100)); } throw new Error("Renderer unavailable"); }
async function availablePort() { const server = createServer(); return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(error => error ? reject(error) : done(port)); }); }); }
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let next = 1;
  socket.addEventListener("message", e => { const r = JSON.parse(e.data), p = pending.get(r.id); if (!p) return; pending.delete(r.id); r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result); });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = next++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); socket.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => socket.close(), evaluate: async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; } };
}
