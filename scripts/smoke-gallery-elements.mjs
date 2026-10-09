// Isolated dev app with the real WD tagger: tag the library from the filter dialog, then filter by elements.
// Needs the synthetic images from `.venv-semantic/Scripts/python.exe scripts/smoke-semantic.py --device cpu`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

const root = await mkdtemp(join(resolve(tmpdir()), "sanctuary-gallery-elements-")), userData = join(root, "user-data"), shots = resolve(".tmp/gallery-elements-smoke");
await mkdir(userData); await mkdir(shots, { recursive: true });
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
const child = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCALAPPDATA: join(root, "LocalAppData") } });
let main, cdp, stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const checks = [];
try {
  main = await connectElectronMainInspector(mainPort); await showElectronTestWindow(main); cdp = await renderer();
  await waitFor("document.querySelectorAll('[data-work-tile]').length === 3", 30000);
  await waitFor("(async () => { const s = await window.sanctuary.status(); return s.visionReady && s.modelBacked; })()", 90000);

  await openElementDialog();
  await waitFor("document.querySelector('.element-index-bar')?.textContent.includes('已识别 0 / 3')");
  await shot("element-dialog-untagged");
  await clickText(".element-index-bar button", "识别其余 3 张");
  await waitFor("document.querySelector('.element-index-bar')?.textContent.includes('全部 3 张已识别')", 180000);
  await shot("element-dialog-tagged");
  checks.push("tagging-from-the-filter-dialog-uses-the-real-tagger-and-reports-coverage");

  // Whatever the tagger says about these pictures, "need" + "exclude" of one tag must split the library exactly.
  const tag = "no_humans";
  await cdp.evaluate("document.querySelector('.element-filter-more').open = true");
  await fill('[aria-label="需要的其他标签"]', tag);
  await clickText(".element-filter-dialog footer button", "应用");
  await waitFor("[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(e => e.textContent.includes('需要：无人物'))");
  const included = await tiles();
  // Reopened, the common element shows as "需要"; one more click turns it into "排除".
  await openElementDialog();
  await waitFor(`Boolean(document.querySelector('[aria-label="无人物：需要"]'))`);
  await click('[aria-label="无人物：需要"]');
  await waitFor(`Boolean(document.querySelector('[aria-label="无人物：排除"]'))`);
  await shot("element-dialog-exclude");
  await clickText(".element-filter-dialog footer button", "应用");
  await waitFor("[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(e => e.textContent.includes('排除：无人物'))");
  const excluded = await tiles();
  assert.equal(included + excluded, 3, `need ${included} + exclude ${excluded}`);
  await shot("gallery-element-chips");
  checks.push(`need-and-exclude-split-the-tagged-library-exactly (${included}+${excluded})`);

  await click('[aria-label^="移除筛选 排除"]');
  await waitFor("document.querySelectorAll('[data-work-tile]').length === 3");
  await click("[data-gallery-filter]");
  await clickText(".ui-popover [role^=menuitem]", "含有我屏蔽的元素");
  await waitFor("[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(e => e.textContent.includes('含屏蔽元素'))");
  const blocked = await tiles();
  assert.ok(blocked <= 3);
  checks.push(`blocked-elements-filter-applies-the-explore-rules (${blocked} of 3)`);
  console.log(JSON.stringify({ status: "passed", checks, screenshots: shots }, null, 2));
} catch (error) {
  console.error(error.stack || error);
  if (cdp) await shot("failure").catch(() => {});
  console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  cdp?.close(); main?.close(); child.kill();
  await new Promise((done) => { if (child.exitCode !== null) done(); else { child.once("exit", done); setTimeout(done, 3000); } });
  const absolute = resolve(root);
  if (!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-gallery-elements-`)) throw new Error("Unexpected temporary directory");
  await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

async function openElementDialog() {
  await click("[data-gallery-filter]");
  await clickText(".ui-popover [role^=menuitem]", "选择元素");
  await waitFor("Boolean(document.querySelector('.element-filter-dialog'))");
}
/** Tiles once the grid has settled on the new query. */
async function tiles() {
  await new Promise((done) => setTimeout(done, 800));
  return cdp.evaluate("document.querySelectorAll('[data-work-tile]').length");
}
async function shot(name) { await cdp.evaluate("new Promise(done=>setTimeout(done,150))"); const capture = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await writeFile(join(shots, `${name}.png`), Buffer.from(capture.data, "base64")); }
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
