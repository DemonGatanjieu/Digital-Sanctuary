import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Isolated real renderer/IPC/database. Only native picker answers and OS startDrag are substituted.
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
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("library.preferences", JSON.stringify({ defaultView: "flat", defaultSortBy: "title", defaultSortDirection: "asc", gridDensity: "comfortable", downloadDirectory: join(root, "Storage", "Pixiv") }), stamp);
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("appearance", JSON.stringify({ displayProfile: "balanced", ambientArtwork: true, reducedMotion: true }), stamp); db.close();
const bannerPath = join(root, "banner.png"); await writeFile(bannerPath, images[1]);
const port = await availablePort(), mainPort = await availablePort();
const child = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCALAPPDATA: join(root, "LocalAppData") } });
let main, cdp, stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); }); const checks = [];
try {
  main = await connectElectronMainInspector(mainPort); await showElectronTestWindow(main); cdp = await renderer();
  await main.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    globalThis.__galleryActions={pick:${JSON.stringify(bannerPath)},drags:[],clipboard:e.clipboard.availableFormats().map(f=>[f,e.clipboard.readBuffer(f).toString('base64')])};
    e.dialog.showOpenDialog=async()=>({canceled:!__galleryActions.pick,filePaths:__galleryActions.pick?[__galleryActions.pick]:[]});
    e.BrowserWindow.getAllWindows()[0].webContents.startDrag=item=>__galleryActions.drags.push({file:item.file,iconSize:item.icon.getSize(),empty:item.icon.isEmpty()});return true;})()`);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await click('[data-home-task="gallery"]'); await waitFor("document.querySelectorAll('.work-library-card').length===3");
  await waitFor("document.querySelector('.work-ambient-backdrop')?.naturalWidth>0");
  assert.equal(await cdp.evaluate("document.querySelectorAll('.work-card-title-row button').length"), 3);
  checks.push("all-cards-expose-rename-without-opening-viewer");
  await shot("gallery-default-1280");
  await fill('[aria-label="保存方式"]', "external"); await waitFor("document.querySelectorAll('.work-library-card').length===2&&!document.querySelector('.work-querying')");
  assert.ok(await cdp.evaluate("Array.from(document.querySelectorAll('.work-ownership-label')).every(e=>e.textContent==='外部引用')"));
  await click('[data-saved-filters="open"]'); await fill('[aria-label="筛选名称"]', "外部参考"); await clickText('.saved-work-filters-dialog button', "保存筛选");
  await waitFor("document.querySelector('.saved-work-filter-list')?.textContent.includes('外部引用')"); await clickText('.saved-work-filters-dialog header button', "关闭");
  await fill('[aria-label="保存方式"]', "managed"); await waitFor("document.querySelectorAll('.work-library-card').length===1&&!document.querySelector('.work-querying')");
  assert.equal(await cdp.evaluate("document.querySelector('.work-card-use-actions').textContent.includes('复制封面')&&document.querySelector('.work-card-use-actions').textContent.includes('拖出封面')"), true);
  await click('[data-saved-filters="open"]'); await click('[data-filter-apply]'); await waitFor("document.querySelector('[aria-label=\"保存方式\"]')?.value==='external'&&document.querySelectorAll('.work-library-card').length===2");
  checks.push("ownership-filter-counts-results-and-restores-through-saved-filter");
  await click('.work-card-title-row button'); await waitFor("document.activeElement?.getAttribute('aria-label')==='图库名称'");
  await cdp.evaluate("document.querySelector('[aria-label=\"图库名称\"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}))");
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.rename-work-dialog'))"), true);
  await cdp.evaluate("document.querySelector('[aria-label=\"图库名称\"]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
  await fill('[aria-label="图库名称"]', "中文参考图"); await clickText('.rename-work-dialog button', "保存名称");
  await waitFor("!document.querySelector('.rename-work-dialog')&&Array.from(document.querySelectorAll('.work-card-title-row strong')).some(e=>e.textContent==='中文参考图')");
  assert.ok(await readFile(originals[2])); checks.push("quick-rename-saves-Chinese-display-name-keeps-original-and-respects-IME");
  await click('.work-card-use-actions button'); await waitFor("document.querySelector('.app-notice')?.textContent.includes('已复制')||document.body.textContent.includes('图片已复制，可以粘贴使用')");
  assert.equal(await main.evaluate("!process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').clipboard.readImage().isEmpty()"), true);
  checks.push("card-copy-writes-real-clipboard-bitmap-with-feedback");
  await cdp.evaluate("document.querySelector('.image-drag-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))");
  await waitForMain("__galleryActions.drags.length===1"); const drag = await main.evaluate("__galleryActions.drags[0]"); assert.ok(originals.includes(drag.file)); assert.equal(drag.empty, false);
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.artwork-lightbox'))"), false);
  checks.push("drag-handle-reaches-native-startDrag-with-indexed-original-and-nonempty-icon");
  await clickText('.gallery-banner-actions button', "更换横幅"); await waitFor("Boolean(document.querySelector('.gallery-banner-custom'))");
  const banner = await cdp.evaluate("window.sanctuary.getGalleryBanner()"); assert.ok(banner.startsWith("data:image/jpeg;base64,")); await rm(bannerPath);
  await click('[data-nav="settings"]'); await click('[data-nav="gallery"]'); await waitFor("document.querySelector('.gallery-banner-custom .work-ambient-backdrop')?.naturalWidth>0");
  assert.equal(await cdp.evaluate("window.sanctuary.getGalleryBanner()"), banner);
  await main.evaluate("__galleryActions.pick=null"); await clickText('.gallery-banner-actions button', "更换横幅"); await waitFor("!document.querySelector('.gallery-banner-actions [aria-busy=true]')");
  assert.equal(await cdp.evaluate("window.sanctuary.getGalleryBanner()"), banner);
  checks.push("native-banner-becomes-owned-JPEG-survives-source-removal-navigation-and-cancel");
  await fill('[aria-label="保存方式"]', ""); await waitFor("document.querySelectorAll('.work-library-card').length===3");
  for (const width of [1280, 900]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate("document.querySelector('main').scrollTop=0");
    const bounds = await cdp.evaluate("(()=>{const main=document.querySelector('main'),controls=document.querySelector('.work-library-controls');return{overflow:main.scrollWidth-main.clientWidth,right:controls.getBoundingClientRect().right,width:innerWidth}})()");
    assert.ok(bounds.overflow <= 2 && bounds.right <= bounds.width); await shot(`gallery-custom-${width}`);
  }
  await cdp.evaluate("document.querySelector('.app-notice [aria-label=\"关闭消息\"]')?.click();document.querySelector('.work-card-title-row').scrollIntoView({block:'center'})");
  const actionsFit = await cdp.evaluate("Array.from(document.querySelectorAll('.work-library-card')).every(card=>{const r=card.getBoundingClientRect();return Array.from(card.querySelectorAll('.work-card-title-row button,.work-card-use-actions button')).every(button=>{const b=button.getBoundingClientRect();return b.height>=36&&b.left>=r.left&&b.right<=r.right&&b.bottom<=r.bottom})})");
  assert.equal(actionsFit, true); await shot("card-quick-actions-900");
  await cdp.evaluate("document.querySelector('main').scrollTop=0");
  checks.push("1280-and-900-gallery-toolbar-and-card-actions-without-horizontal-clipping");
  await cdp.evaluate("window.sanctuary.setActiveTheme('builtin.cyber-deck')");
  await waitFor("(async()=>{const t=await window.sanctuary.getActiveTheme();return t.themeId==='builtin.cyber-deck'&&document.querySelector('#ds-dynamic-theme')?.textContent===t.cssContent})()");
  const contrast = await cdp.evaluate(`(()=>{
    const luminance=c=>c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
    return ['[aria-label="保存方式"]','.work-search input','.work-sort-direction'].map(selector=>{
      const s=getComputedStyle(document.querySelector(selector)),a=luminance(s.color),b=luminance(s.backgroundColor);
      return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
  })()`);
  assert.ok(contrast.every(ratio=>ratio>=4.5),`Dark toolbar contrast: ${contrast}`); await shot("gallery-custom-dark-900");
  await clickText('.gallery-banner-actions button', "恢复自动精选"); await waitFor("!document.querySelector('.gallery-banner-custom')&&document.querySelector('.work-ambient-backdrop')?.naturalWidth>0");
  assert.equal(await cdp.evaluate("window.sanctuary.getGalleryBanner()"), null); await shot("gallery-auto-dark-900");
  checks.push("custom-banner-reset-restores-auto-selection-and-dark-theme-layout");
  await cdp.evaluate("window.sanctuary.updateAppearancePreferences({displayProfile:'efficient',reducedMotion:true,ambientArtwork:true})");
  await cdp.send("Page.reload"); await click('[data-home-task="gallery"]'); await waitFor("Boolean(document.querySelector('.gallery-banner-collapsed .gallery-banner-actions button'))");
  checks.push("efficient-profile-keeps-banner-controls-available-without-decorative-image");
  await rm(drag.file); await cdp.evaluate("document.querySelector('.image-drag-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}))");
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

async function waitFor(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await cdp.evaluate(expression)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(`Timed out: ${expression}`); }
async function waitForMain(expression) { const start = Date.now(); while (Date.now() - start < 10000) { if (await main.evaluate(expression)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(`Main timed out: ${expression}`); }
async function click(selector) { await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function clickText(selector, text) { await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled)`); await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`); }
async function fill(selector, value) { await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); }
async function key(key) { await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key }); }
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
