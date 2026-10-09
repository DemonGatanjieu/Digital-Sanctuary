import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Isolated production renderer, IPC, SQLite and native sandbox views.
// Native picker/Menu and website responses are controlled fixtures; no model inference.
const root = await mkdtemp(join(resolve(tmpdir()), "sanctuary-discovery-")), userData = join(root, "user-data"), shots = resolve(".tmp/discovery-smoke");
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
const port = await availablePort(), mainPort = await availablePort();
const child = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCALAPPDATA: join(root, "LocalAppData") } });
let main, cdp, stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); }); const checks = [];
try {
  main = await connectElectronMainInspector(mainPort); await showElectronTestWindow(main); cdp = await renderer();
  await click('[data-nav="home"]');await waitFor("Boolean(document.querySelector('.home-library-entry button'))");
  await main.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__discovery={pick:${JSON.stringify([originals[2]])},menu:null};e.dialog.showOpenDialog=async()=>({canceled:!__discovery.pick,filePaths:__discovery.pick??[]});const original=e.Menu.buildFromTemplate;e.Menu.buildFromTemplate=(template)=>{const menu=original(template);menu.popup=()=>{__discovery.menu=menu;};return menu;};return true;})()`);
  await click('.home-library-entry button');await waitFor("Boolean(document.querySelector('.import-images-dialog'))");
  assert.equal(await cdp.evaluate("document.querySelector('input[name=storage-mode]')?.checked"),true);
  await click('[data-import-action=start]');await waitFor("document.querySelector('.import-images-dialog')?.textContent.includes('导入结果')");await clickText('.import-images-dialog button','完成');
  const copied=await cdp.evaluate("window.sanctuary.queryWorks({ownership:'managed',limit:20})");const managed=copied.items.find(item=>item.id!=='pixiv:456');assert.ok(managed);
  const managedWork=await cdp.evaluate(`window.sanctuary.getWork(${JSON.stringify(managed.id)})`);assert.equal(await readFile(managedWork.assets[0].path).then(b=>b.equals(images[2])),true);assert.notEqual(managedWork.assets[0].path,originals[2]);
  checks.push('native-import-defaults-to-managed-copy-and-keeps-existing-external-reference');
  const referencePath=join(root,'reference-only.png');await writeFile(referencePath,Buffer.concat([images[2],Buffer.from('reference-specific')]));
  await main.evaluate(`__discovery.pick=${JSON.stringify([referencePath])}`);await click('.gallery-toolbar-actions .ui-button--primary');await waitFor("Boolean(document.querySelector('.import-images-dialog'))");await cdp.evaluate("document.querySelectorAll('input[name=storage-mode]')[1].click()");await click('[data-import-action=start]');await waitFor("document.querySelector('.import-images-dialog')?.textContent.includes('导入结果')");await clickText('.import-images-dialog button','完成');
  const external=(await cdp.evaluate("window.sanctuary.queryWorks({ownership:'external',limit:50})")).items.find(item=>item.title==='reference-only.png');assert.ok(external);
  const externalWork=await cdp.evaluate(`window.sanctuary.getWork(${JSON.stringify(external.id)})`);const moved=join(root,'moved-reference.png');await writeFile(moved,await readFile(referencePath));await rm(referencePath);
  await main.evaluate(`__discovery.pick=${JSON.stringify([moved])}`);const relinked=await cdp.evaluate(`window.sanctuary.relinkExternalImage(${JSON.stringify(external.id)},${JSON.stringify(externalWork.assets[0].id)})`);assert.equal(relinked.assets[0].path,moved);assert.equal(relinked.id,external.id);
  await main.evaluate(`__discovery.pick=${JSON.stringify([originals[0]])}`);const rejected=await cdp.evaluate(`window.sanctuary.relinkExternalImage(${JSON.stringify(external.id)},${JSON.stringify(externalWork.assets[0].id)}).then(()=>null,e=>e.message)`);assert.ok(rejected.includes('内容不同'));
  checks.push('external-reference-relinks-identical-moved-file-and-rejects-another-image');
  await main.evaluate(`(async()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),s=e.session.fromPartition('persist:explore-web');await s.protocol.handle('https',request=>{const u=new URL(request.url);if(u.pathname.endsWith('.png'))return new Response(Buffer.from(${JSON.stringify(images[1].toString('base64'))},'base64'),{headers:{'content-type':'image/png'}});return new Response('<html><title>收图测试站</title><body style="background:white"><h1>远程图片</h1><img src="https://example.com/sanctuary-fixture.png" width="260" height="180"></body></html>',{headers:{'content-type':'text/html; charset=utf-8'}});});return true;})()`);
  await click('[data-nav=explore]');await waitFor("Boolean(document.querySelector('[aria-label=\"网址或图片搜索\"]'))");
  await fill('[aria-label="网址或图片搜索"]','https://example.com/sanctuary-fixture');await cdp.evaluate("document.querySelector('.explore-address-form').requestSubmit()");
  await waitFor("document.querySelector('.shield-status')?.textContent.includes('未适配元素拦截')");await waitForMain("process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').webContents.getAllWebContents().some(c=>c.getURL().includes('example.com/sanctuary-fixture'))");
  const remoteId=await main.evaluate("process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').webContents.getAllWebContents().find(c=>c.getURL().includes('example.com/sanctuary-fixture')).id");
  assert.equal(await main.evaluate(`process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').webContents.fromId(${remoteId}).executeJavaScript('typeof window.sanctuary')`),'undefined');
  await clickText('.explore-site-shortcuts button','收藏网站');await waitFor("document.querySelector('.explore-site-shortcuts')?.textContent.includes('收图测试站')");
  await main.evaluate(`(()=>{const c=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').webContents.fromId(${remoteId});c.emit('context-menu',{}, {hasImageContents:true,srcURL:'https://example.com/sanctuary-fixture.png'});__discovery.menu.items[0].click();return true;})()`);
  await waitFor("document.body.textContent.includes('已加入图库')",35000);
  await click('[data-nav=gallery]');await waitFor("Array.from(document.querySelectorAll('.work-tile-caption strong')).some(e=>e.textContent==='收图测试站')");
  const webWork=(await cdp.evaluate("window.sanctuary.queryWorks({search:'收图测试站',limit:20})")).items[0];const info=await cdp.evaluate(`window.sanctuary.getWorkInformation(${JSON.stringify(webWork.id)},0)`);assert.equal(info.work.ownership,'managed');assert.equal(info.webSource.pageUrl,'https://example.com/sanctuary-fixture');
  checks.push('isolated-browser-address-site-shortcut-context-image-import-and-gallery-provenance');
  await click('[data-nav=explore]');await waitFor("document.querySelector('.shield-status')?.textContent.includes('未适配元素拦截')");await shot('web-explore-1280');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:620,deviceScaleFactor:1,mobile:false});await waitFor("document.querySelector('.explore-surface')?.getBoundingClientRect().height>100");await shot('web-explore-900');
  const overlap=await cdp.evaluate("(()=>{const r=document.querySelector('.explore-surface').getBoundingClientRect(),a=document.querySelector('.explore-site-shortcuts').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth-innerWidth,surfaceY:r.y,toolbarBottom:a.bottom};})()");assert.ok(overlap.overflow<=2&&overlap.surfaceY>=overlap.toolbarBottom-1);
  const nativeBounds=await main.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),v=e.BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.id===${remoteId});return {bounds:v.getBounds(),visible:v.getVisible()};})()`);
  const surface=await cdp.evaluate("(()=>{const r=document.querySelector('.explore-surface').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
  assert.equal(nativeBounds.visible,true);for(const axis of ['x','y','width','height'])assert.ok(Math.abs(nativeBounds.bounds[axis]-surface[axis])<=2,JSON.stringify({nativeBounds,surface}));
  checks.push('browser-small-window-address-shortcuts-native-surface-do-not-overlap');
  // Pick two pictures in the gallery and take them to creation.
  await click('[data-nav=gallery]');await click('[aria-label="选择作品"]');
  await waitFor("document.querySelectorAll('[data-work-tile] .work-tile-check').length>=2");await cdp.evaluate("document.querySelectorAll('[data-work-tile] .work-tile-check')[0].click();document.querySelectorAll('[data-work-tile] .work-tile-check')[1].click()");await clickText('.work-selection-bar button','拿去创作');
  await waitFor("document.querySelectorAll('.inspiration-source').length===2");assert.equal(await cdp.evaluate("document.querySelector('.inspiration-composer textarea').value.includes('逐张')"),true);
  const bounds=await cdp.evaluate("(()=>{const r=document.querySelector('.inspiration-send').getBoundingClientRect();return {bottom:r.bottom,right:r.right,height:innerHeight,width:innerWidth};})()");assert.ok(bounds.bottom<=bounds.height&&bounds.right<=bounds.width);await shot('multi-reference-900');
  assert.equal(await main.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');return e.BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.id===${remoteId}).getVisible();})()`),false);
  checks.push('gallery-selection-takes-two-real-reference-pages-to-creation-with-a-visible-composer');
  const report={status:'passed',checks,screenshots:shots,limits:'Network responses and native picker/Menu boundaries are controlled fixtures. Production webview, import service, database, IPC and renderer are real; no model inference in this GUI smoke.'};await writeFile(join(shots,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error) {console.error(error.stack||error);if(cdp)await shot('failure').catch(()=>{});console.error(stderr.slice(-3000));process.exitCode=1;}
finally {cdp?.close();main?.close();child.kill();await new Promise(done=>{if(child.exitCode!==null)done();else{child.once('exit',done);setTimeout(done,2000);}});const absolute=resolve(root);if(!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-discovery-`))throw new Error('Unexpected temporary directory');await rm(absolute,{recursive:true,force:true,maxRetries:8,retryDelay:150});}

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
