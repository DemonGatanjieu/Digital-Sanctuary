import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Isolated real renderer/IPC/database for the image-first gallery. Only native pickers and OS startDrag are substituted.
const root = await mkdtemp(join(resolve(tmpdir()), "sanctuary-gallery-actions-")), userData = join(root, "user-data"), shots = resolve(".tmp/gallery-actions-smoke");
await mkdir(userData); await mkdir(shots, { recursive: true });
const fallback = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const images = await Promise.all(["blue-sky-and-sun", "night-moon-and-stars", "red-square"].map(name => readFile(resolve(`.tmp/semantic-smoke/${name}.png`)).catch(() => fallback)));
const db = new DatabaseSync(join(userData, "library.db"));
db.exec(`CREATE TABLE artworks(id TEXT PRIMARY KEY,path TEXT NOT NULL COLLATE NOCASE UNIQUE,file_name TEXT NOT NULL,imported_at TEXT NOT NULL,assessment_json TEXT,decision_json TEXT,source_platform TEXT,source_work_id TEXT,source_page_index INTEGER,author_id TEXT,author_name TEXT,work_title TEXT);
  CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_artwork_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks(collection_id TEXT NOT NULL,artwork_id TEXT NOT NULL,PRIMARY KEY(collection_id,artwork_id));
  CREATE TABLE user_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
const originals = [], stamp = new Date().toISOString();
for (let index = 0; index < 4; index++) {
  const path = join(root, `${index < 2 ? "456_p" : "external"}${index}.png`); await writeFile(path, images[index % 3]); originals.push(path);
  db.prepare("INSERT INTO artworks(id,path,file_name,imported_at,source_platform,source_work_id,source_page_index,author_id,author_name,work_title)VALUES(?,?,?,?,?,?,?,?,?,?)").run(`seed-${index}`, path, path.split(/[\\/]/).at(-1), stamp, index < 2 ? "pixiv" : null, index < 2 ? "456" : null, index < 2 ? index : null, index < 2 ? "789" : null, index < 2 ? "测试画师" : null, index < 2 ? "双页测试作品" : null);
}
db.prepare("INSERT INTO collections VALUES(?,?,?,?,?)").run("album", "参考相册", "", null, stamp);
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("library.preferences", JSON.stringify({ defaultView: "flat", defaultSortBy: "title", defaultSortDirection: "asc", gridDensity: "comfortable", downloadDirectory: join(root, "Storage", "Pixiv") }), stamp);
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("appearance", JSON.stringify({ displayProfile: "balanced", ambientArtwork: true, reducedMotion: true }), stamp); db.close();
const backgroundPath = join(root, "background.png"); await writeFile(backgroundPath, images[1]);
const port = await availablePort(), mainPort = await availablePort();
const child = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCALAPPDATA: join(root, "LocalAppData") } });
let main, cdp, stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); }); const checks = [];
const tiles = "document.querySelectorAll('[data-work-tile]').length";
try {
  main = await connectElectronMainInspector(mainPort); await showElectronTestWindow(main); cdp = await renderer();
  await main.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    globalThis.__galleryActions={pick:${JSON.stringify(backgroundPath)},drags:[],clipboard:e.clipboard.availableFormats().map(f=>[f,e.clipboard.readBuffer(f).toString('base64')])};
    e.dialog.showOpenDialog=async()=>({canceled:!__galleryActions.pick,filePaths:__galleryActions.pick?[__galleryActions.pick]:[]});
    e.BrowserWindow.getAllWindows()[0].webContents.startDrag=item=>__galleryActions.drags.push({file:item.file,iconSize:item.icon.getSize(),empty:item.icon.isEmpty()});return true;})()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await waitFor(`${tiles}===3`);
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.gallery-banner, .summary-row, .work-preset-row'))"), false);
  checks.push("app-opens-in-gallery-with-image-tiles-and-no-banner-or-counters");
  await shot("gallery-default-1280");

  // Filters live in one menu; active conditions become removable chips.
  await openFilterMenu(); await clickMenu("外部引用"); await waitFor(`${tiles}===2&&!document.querySelector('.work-querying')`);
  assert.ok(await cdp.evaluate("[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(c=>c.textContent.includes('外部引用'))"));
  await openFilterMenu(); await clickMenu("常用筛选");
  await fill('[aria-label="筛选名称"]', "外部参考"); await clickText('.saved-work-filters-dialog button', "保存筛选");
  await waitFor("document.querySelector('.saved-work-filter-list')?.textContent.includes('外部引用')"); await clickText('.saved-work-filters-dialog header button', "关闭");
  await click('.work-filter-chips [aria-label="移除筛选 外部引用"]'); await waitFor(`${tiles}===3&&!document.querySelector('.work-filter-chips')`);
  await openFilterMenu(); await clickMenu("常用筛选"); await click('[data-filter-apply]');
  await waitFor(`${tiles}===2&&[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(c=>c.textContent.includes('外部引用'))`);
  checks.push("ownership-filter-shows-a-chip-saves-removes-and-restores-through-saved-filters");

  // Rename from the context menu; IME composition keeps the dialog open.
  await contextMenu(0); await clickMenu("改名"); await waitFor("document.activeElement?.getAttribute('aria-label')==='图库名称'");
  await cdp.evaluate("document.querySelector('[aria-label=\"图库名称\"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}))");
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.rename-work-dialog'))"), true);
  await cdp.evaluate("document.querySelector('[aria-label=\"图库名称\"]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
  await fill('[aria-label="图库名称"]', "中文参考图"); await clickText('.rename-work-dialog button', "保存名称");
  await waitFor("!document.querySelector('.rename-work-dialog')&&[...document.querySelectorAll('.work-tile-caption strong')].some(e=>e.textContent==='中文参考图')");
  assert.ok(await readFile(originals[2])); checks.push("context-menu-rename-saves-Chinese-display-name-keeps-original-and-respects-IME");

  await contextMenu(0); await clickMenu("复制图片"); await waitFor("document.body.textContent.includes('图片已复制')");
  assert.equal(await main.evaluate("!process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').clipboard.readImage().isEmpty()"), true);
  checks.push("context-menu-copy-writes-real-clipboard-bitmap-with-toast");

  await cdp.evaluate("document.querySelector('[data-work-tile] .work-tile-image').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))");
  await waitForMain("__galleryActions.drags.length===1"); const drag = await main.evaluate("__galleryActions.drags[0]"); assert.ok(originals.includes(drag.file)); assert.equal(drag.empty, false);
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), false);
  checks.push("dragging-the-image-reaches-native-startDrag-with-the-original-and-a-nonempty-icon");

  // Album assignment and selection.
  await contextMenu(1); await clickMenu("加入相册"); await clickMenu("参考相册"); await waitFor("document.body.textContent.includes('加入“参考相册”')");
  await cdp.evaluate("document.querySelector('.work-tile-check').click()"); await waitFor("document.querySelector('.work-selection-bar')?.textContent.includes('已选 1 件')");
  await shot("gallery-selecting-1280"); await click('.work-selection-bar [aria-label="退出选择"]'); await waitFor("!document.querySelector('.work-selection-bar')");
  checks.push("context-menu-adds-to-album-with-undo-toast-and-tile-check-starts-selection");

  // Home keeps its own background picker.
  await click('[data-nav="home"]'); await clickText('.home-background-controls button', '更换背景'); await clickText('.background-source-dialog button', '选择本地图片');
  await waitFor("document.querySelector('.home-background')?.naturalWidth>0"); const home = await cdp.evaluate('window.sanctuary.getHomeBackground()'); assert.ok(home?.startsWith('data:image/jpeg'));
  await cdp.send('Page.reload'); await click('[data-nav="home"]'); await waitFor("document.querySelector('.home-background')?.naturalWidth>0");
  assert.equal(await cdp.evaluate('window.sanctuary.getHomeBackground()'), home);
  await clickText('.home-background-controls button', '恢复默认背景'); await waitFor("!document.querySelector('.home-background')");
  checks.push("home-background-persists-across-reload-and-resets");

  await click('[data-nav="gallery"]'); await waitFor(`${tiles}>=2`);
  for (const width of [1280, 900]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate("document.querySelector('main').scrollTop=0");
    const bounds = await cdp.evaluate("(()=>{const main=document.querySelector('main'),bar=document.querySelector('.gallery-toolbar-row');return{overflow:main.scrollWidth-main.clientWidth,right:bar.getBoundingClientRect().right,width:innerWidth}})()");
    assert.ok(bounds.overflow <= 2 && bounds.right <= bounds.width, JSON.stringify(bounds)); await shot(`gallery-${width}`);
  }
  checks.push("1280-and-900-toolbar-without-horizontal-clipping");

  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  const contrast = await cdp.evaluate(`(()=>{
    const lum=c=>c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
    const bg=getComputedStyle(document.body).backgroundColor;
    return ['.gallery-scope button[aria-current="page"]','[data-gallery-filter]','.gallery-search-field input'].map(sel=>{const a=lum(getComputedStyle(document.querySelector(sel)).color),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
  })()`);
  assert.ok(contrast.every(ratio => ratio >= 4.5), `Dark toolbar contrast: ${contrast}`); await shot("gallery-dark-900");
  checks.push("system-dark-mode-toolbar-text-meets-contrast");

  await rm(drag.file); await cdp.evaluate("document.querySelector('[data-work-tile] .work-tile-image').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))");
  await waitFor("document.body.textContent.includes('找不到原图')"); assert.equal(await main.evaluate("__galleryActions.drags.length"), 1);
  checks.push("missing-external-original-reports-error-instead-of-starting-drag");
  const report = { status: "passed", checks, darkToolbarContrast: contrast, screenshots: shots, limitation: "startDrag is substituted at the OS boundary; actual Explorer/third-party drops need user verification." };
  await writeFile(join(shots, "result.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(error.stack || error); if (cdp) await shot("failure").catch(() => {}); console.error(stderr.slice(-4000)); process.exitCode = 1; }
finally {
  if (main) await main.evaluate("(()=>{const s=globalThis.__galleryActions;if(!s)return;const {clipboard}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');clipboard.clear();for(const [format,data]of s.clipboard)clipboard.writeBuffer(format,Buffer.from(data,'base64'));})()").catch(() => {});
  cdp?.close(); main?.close(); child.kill(); await new Promise(done => { if (child.exitCode !== null) done(); else { child.once("exit", done); setTimeout(done, 2000); } });
  const absolute = resolve(root); if (!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-gallery-actions-`)) throw new Error("Unexpected temporary directory");
  await rm(absolute, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

async function openFilterMenu() { await click('[data-gallery-filter]'); await waitFor("Boolean(document.querySelector('.ui-popover'))"); }
async function clickMenu(text) { await clickText('.ui-popover [role^="menuitem"]', text); }
async function contextMenu(index) {
  await waitFor(`document.querySelectorAll('[data-work-tile] .work-tile-image').length>${index}`);
  await cdp.evaluate(`(()=>{const e=document.querySelectorAll('[data-work-tile] .work-tile-image')[${index}],r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20}))})()`);
  await waitFor("Boolean(document.querySelector('.ui-popover'))");
}
async function waitFor(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await cdp.evaluate(expression)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(`Timed out: ${expression}`); }
async function waitForMain(expression) { const start = Date.now(); while (Date.now() - start < 10000) { if (await main.evaluate(expression)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(`Main timed out: ${expression}`); }
async function click(selector) { await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function clickText(selector, text) { await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled)`); await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled).click()`); }
async function fill(selector, value) { await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); }
async function shot(name) { await cdp.evaluate("new Promise(done=>setTimeout(done,100))"); const capture = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await writeFile(join(shots, `${name}.png`), Buffer.from(capture.data, "base64")); }
async function renderer() { const start = Date.now(); while (Date.now() - start < 20000) { try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), target = targets.find(t => t.type === "page" && t.url?.includes("renderer/index.html")); if (target?.webSocketDebuggerUrl) return connect(target.webSocketDebuggerUrl); } catch {} await new Promise(done => setTimeout(done, 100)); } throw new Error("Renderer unavailable"); }
async function availablePort() { const server = createServer(); return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(error => error ? reject(error) : done(port)); }); }); }
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let next = 1;
  socket.addEventListener("message", e => { const r = JSON.parse(e.data), p = pending.get(r.id); if (!p) return; pending.delete(r.id); r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result); });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = next++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } }); socket.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => socket.close(), evaluate: async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; } };
}
