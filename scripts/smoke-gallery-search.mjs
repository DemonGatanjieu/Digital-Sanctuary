import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Isolated production renderer, IPC, SQLite and native sandbox views.
// Real offline EmbeddingGemma model, production search, SQLite and renderer; disposable pictures only.
const root = await mkdtemp(join(resolve(tmpdir()), "sanctuary-gallery-search-")), userData = join(root, "user-data"), shots = resolve(".tmp/gallery-search-smoke");
await mkdir(userData); await mkdir(shots, { recursive: true });
const fallback = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const images = await Promise.all(["blue-sky-and-sun", "night-moon-and-stars", "red-square"].map(name => readFile(resolve(`.tmp/semantic-smoke/${name}.png`))));
const db = new DatabaseSync(join(userData, "library.db"));
db.exec(`CREATE TABLE artworks(id TEXT PRIMARY KEY,path TEXT NOT NULL COLLATE NOCASE UNIQUE,file_name TEXT NOT NULL,imported_at TEXT NOT NULL,assessment_json TEXT,decision_json TEXT,source_platform TEXT,source_work_id TEXT,source_page_index INTEGER,author_id TEXT,author_name TEXT,work_title TEXT);
  CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_artwork_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks(collection_id TEXT NOT NULL,artwork_id TEXT NOT NULL,PRIMARY KEY(collection_id,artwork_id));
  CREATE TABLE user_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
const originals = [], stamp = new Date().toISOString();
for (let index = 0; index < 5; index++) {
  const path = join(root, `${index < 2 ? "456_p" : "external"}${index}.png`); await writeFile(path, index===4?Buffer.from("broken image"):images[index % 3]); originals.push(path);
  db.prepare("INSERT INTO artworks(id,path,file_name,imported_at,source_platform,source_work_id,source_page_index,author_id,author_name,work_title)VALUES(?,?,?,?,?,?,?,?,?,?)").run(`seed-${index}`, path, path.split(/[\\/]/).at(-1), stamp, index < 2 ? "pixiv" : null, index < 2 ? "456" : null, index < 2 ? index : null, index < 2 ? "789" : null, index < 2 ? "测试画师" : null, index < 2 ? "双页测试作品" : null);
}
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("library.preferences", JSON.stringify({ defaultView: "flat", defaultSortBy: "title", defaultSortDirection: "asc", gridDensity: "comfortable", downloadDirectory: join(root, "Storage", "Pixiv") }), stamp);
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("appearance", JSON.stringify({ displayProfile: "balanced", ambientArtwork: true, reducedMotion: true }), stamp); db.close();
const port = await availablePort(), mainPort = await availablePort();
const child = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCALAPPDATA: join(root, "LocalAppData") } });
let main, cdp, stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); }); const checks = [];
try {
  main=await connectElectronMainInspector(mainPort);await showElectronTestWindow(main);cdp=await renderer();
  await waitFor("Boolean(document.querySelector('.gallery-search-field'))");
  assert.equal(await cdp.evaluate("document.querySelector('.gallery-search-mode').textContent"),'按画面');
  assert.equal(await cdp.evaluate("!document.querySelector('.image-workbench')&&document.querySelector('.gallery-search-field input').placeholder.includes('描述画面')"),true);
  await fill('.gallery-search-field input','夜晚，月亮和星星');
  await cdp.evaluate("document.querySelector('.gallery-search-field input').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('.gallery-search-field').requestSubmit()");
  assert.equal(await cdp.evaluate("window.sanctuary.currentGalleryPictureSearch()"),null);
  await cdp.evaluate("document.querySelector('.gallery-search-field input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));document.querySelector('.gallery-search-field').requestSubmit()");
  await waitFor("document.querySelector('.gallery-search-status')?.textContent.includes('正在准备找图模型')");
  await click('[aria-label="停止找图"]');
  await waitFor("(async()=>{const s=await window.sanctuary.currentGalleryPictureSearch();return s?.progress.phase==='cancelled'})()",30000);
  await waitFor("document.querySelector('.gallery-search-status')?.textContent.includes('已停止')");
  checks.push('gallery-default-Chinese-search-and-IME-guard-with-cancellable-first-model-load');
  const started=Date.now();await cdp.evaluate("document.querySelector('.gallery-search-field').requestSubmit()");
  await click('[aria-label="任务与进度"]');await waitFor("document.querySelector('.task-center-dialog')?.textContent.includes('返回图库搜索')");
  await clickText('.task-center-dialog button','返回图库搜索');
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.gallery-search-field'))&&!document.querySelector('.image-workbench')"),true);
  const first=await finished(),coldMs=Date.now()-started;
  assert.equal(first.progress.total,5);assert.equal(first.progress.failed,1);assert.equal(first.result.items[0].id,'pixiv:456');assert.equal(first.result.items[0].matchedPage,1);
  assert.equal(first.result.total,1);assert.equal(first.result.totalPages,1);assert.equal(first.relevance.hiddenWorks,2);assert.equal(first.relevance.hiddenPages,3);
  await waitFor("document.querySelector('[data-work-tile] .work-tile-pages')?.textContent.includes('第 2/2 页')");await shot('gallery-picture-results-1280');
  const indexPath=join(userData,'semantic-index.db'),cacheCount=()=>{const cache=new DatabaseSync(indexPath,{readOnly:true});try{return cache.prepare('SELECT COUNT(*) AS count FROM vectors').get().count;}finally{cache.close();}};
  const cached=cacheCount();assert.equal(cached,3);
  checks.push('one-submit-real-offline-model-builds-content-index-and-isolates-unreadable-original');
  await click('[aria-label="显示更多搜索结果"]');await waitFor("document.querySelectorAll('[data-work-tile]').length===3");
  const all=await cdp.evaluate(`window.sanctuary.galleryPictureResults(${JSON.stringify(first.progress.id)},0,'all')`);
  assert.equal(all.result.totalPages,4);assert.equal(cacheCount(),cached);
  assert.equal((await cdp.evaluate("window.sanctuary.currentGalleryPictureSearch()")).progress.id,first.progress.id);
  await click('[data-nav=inspiration]');await click('[data-nav=gallery]');await waitFor("document.querySelectorAll('[data-work-tile]').length===3");
  await click('[aria-label="只看较相关结果"]');await waitFor("document.querySelectorAll('[data-work-tile]').length===1");
  checks.push('default-relevance-hides-unrelated-images-and-expansion-reuses-the-same-index-and-survives-navigation');
  await click('[data-work-tile] .work-tile-image');await waitFor("document.querySelector('.cinema-lightbox-theater')?.textContent.includes('2 / 2')");
  await click('[aria-label="关闭大图"]');
  checks.push('best-matching-page-becomes-card-cover-and-opens-the-same-original-page');
  await click('[data-nav=inspiration]');await click('[data-nav=gallery]');assert.equal(await cdp.evaluate("document.querySelector('.gallery-search-field input').value"),'夜晚，月亮和星星');
  await waitFor("Boolean(document.querySelector('[data-work-tile] .work-tile-pages'))");
  checks.push('search-query-and-results-survive-navigation-away-and-back');
  await fill('.gallery-search-field input','红色的方块');const secondStarted=Date.now();await cdp.evaluate("document.querySelector('.gallery-search-field').requestSubmit()");const second=await finished(),warmMs=Date.now()-secondStarted;
  assert.equal(second.result.items[0].id,'local:seed-2');assert.equal(cacheCount(),cached);
  checks.push('another-Chinese-query-ranks-a-different-image-and-reuses-the-persistent-index');
  await setOwnership('外部引用');await waitFor("document.querySelector('.gallery-search-status')?.textContent.includes('筛选已变化')&&document.querySelectorAll('[data-work-tile]').length===0");
  await cdp.evaluate("document.querySelector('.gallery-search-field').requestSubmit()");const external=await finished();assert.equal(external.progress.total,3);assert.ok(external.result.items.every(work=>work.ownership==='external'));
  checks.push('storage-filter-invalidates-old-results-and-restricts-the-next-content-search');
  await fill('.gallery-search-field input','夜晚，月亮和星星');await cdp.evaluate("document.querySelector('.gallery-search-field').requestSubmit()");const noMatches=await finished();
  assert.equal(noMatches.result.total,0);assert.equal(noMatches.relevance.hiddenWorks,2);
  await waitFor("document.querySelector('.library-empty')?.textContent.includes('没有较相关的图片')||document.querySelector('main')?.textContent.includes('没有较相关的图片')");
  assert.equal(await cdp.evaluate("document.querySelectorAll('[data-work-tile]').length"),0);
  await click('[aria-label="显示更多搜索结果"]');await waitFor("document.querySelectorAll('[data-work-tile]').length===2");assert.equal(cacheCount(),cached);
  checks.push('zero-relevant-matches-stays-empty-with-an-obvious-show-more-recovery');
  await setOwnership('全部');await click('.gallery-search-mode');await fill('.gallery-search-field input','双页');
  await waitFor("document.querySelectorAll('[data-work-tile]').length===1&&document.querySelector('.work-tile-caption strong')?.textContent==='双页测试作品'");
  assert.equal(cacheCount(),cached);await click('[aria-label="清除搜索"]');await waitFor("document.querySelectorAll('[data-work-tile]').length===4");
  checks.push('ordinary-title-search-remains-available-and-clear-restores-normal-browsing');
  await click('.gallery-search-mode');await fill('.gallery-search-field input','夜晚，月亮和星星');await cdp.evaluate("document.querySelector('.gallery-search-field').requestSubmit()");await finished();
  await main.evaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');e.BrowserWindow.getAllWindows()[0].setBounds({x:40,y:40,width:900,height:620});return true;})()");
  await waitFor("innerWidth<=900");await cdp.evaluate("document.querySelector('main').scrollTop=0");
  const fits=await cdp.evaluate("(()=>{const r=document.querySelector('.gallery-toolbar').getBoundingClientRect();return {right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};})()");assert.ok(fits.right<=fits.width&&fits.bottom<=fits.height&&!fits.overflow,JSON.stringify(fits));
  await shot('gallery-picture-search-900');
  await cdp.evaluate("window.sanctuary.setActiveTheme('builtin.cyber-deck')");await waitFor("document.querySelector('#ds-dynamic-theme')?.textContent");await shot('gallery-picture-search-dark-900');
  checks.push('Chinese-search-and-progress-stay-visible-in-small-window-and-dark-theme');
  const report={status:'passed',checks,coldMs,warmMs,indexedUniqueContents:cached,screenshots:shots,limits:'Synthetic image fixtures with real offline EmbeddingGemma CPU inference; not a benchmark of arbitrary large personal libraries.'};await writeFile(join(shots,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error) {console.error(error.stack||error);if(cdp){console.error(await cdp.evaluate("(async()=>JSON.stringify({feedback:document.querySelector('.gallery-search-status')?.textContent,visibility:document.visibilityState,progress:(await window.sanctuary.currentGalleryPictureSearch())?.progress.phase}))()").catch(()=>''));await shot('failure').catch(()=>{});}console.error(stderr.slice(-4000));process.exitCode=1;}
finally {cdp?.close();main?.close();child.kill();await new Promise(done=>{if(child.exitCode!==null)done();else{child.once('exit',done);setTimeout(done,2000);}});const absolute=resolve(root);if(!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-gallery-search-`))throw new Error('Unexpected temporary directory');await rm(absolute,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
async function finished(){await waitFor("(async()=>{const s=await window.sanctuary.currentGalleryPictureSearch();return s&&!['scanning','analyzing'].includes(s.progress.phase)})()",180000);const s=await cdp.evaluate("window.sanctuary.currentGalleryPictureSearch()");assert.equal(s.progress.phase,'completed',JSON.stringify(s.progress));await waitFor("!document.querySelector('.gallery-search-status [role=status]')?.textContent.includes('正在建立')&&!document.querySelector('.gallery-search-status [role=status]')?.textContent.includes('正在准备找图模型')");return s;}

async function waitFor(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await cdp.evaluate(expression)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(`Timed out: ${expression}`); }
async function waitForMain(expression) { const start = Date.now(); while (Date.now() - start < 10000) { if (await main.evaluate(expression)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error(`Main timed out: ${expression}`); }
async function click(selector) { await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function clickText(selector, text) { await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.textContent.includes(${JSON.stringify(text)})&&!e.disabled)`); await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`); }
async function fill(selector, value) { await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); }
// Storage filter moved into the filter menu.
async function setOwnership(label) { await click('[data-gallery-filter]'); await waitFor("Boolean(document.querySelector('.ui-popover'))"); await cdp.evaluate(`(()=>{const items=[...document.querySelectorAll('.ui-popover [role^=menuitem]')];const start=items.findIndex(e=>e.textContent.includes('全部')&&e.previousElementSibling?.textContent==='保存方式');const pool=start>=0?items.slice(start):items;pool.find(e=>e.textContent.trim()===${JSON.stringify(label)})?.click();})()`); }
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
