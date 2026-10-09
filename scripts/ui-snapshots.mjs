// Visual baseline: launches the built app against an isolated, seeded library and captures
// the main screens. Usage: node scripts/ui-snapshots.mjs <label>   (run `npm run build` first)
// Output: .tmp/ui-snapshots/<label>/*.png  — compare labels side by side before/after UI work.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

const label = (process.argv[2] ?? "current").replace(/[^\w.-]/g, "_");
const shots = resolve(".tmp/ui-snapshots", label);
const root = await mkdtemp(join(resolve(tmpdir()), "sanctuary-ui-snapshots-"));
const userData = join(root, "user-data");
await mkdir(userData); await mkdir(shots, { recursive: true });

// ---- Seed library -------------------------------------------------------------------------
const ratios = [[3, 4], [2, 3], [16, 9], [1, 1], [9, 16], [4, 3], [3, 5], [21, 9], [4, 5]];
const palettes = [["#f6d5c4", "#e88d72", "#5a3d5c"], ["#c9e4f2", "#5aa0c8", "#1e3a5f"], ["#e8f0d0", "#9cc07a", "#3e5a2e"], ["#f3e2f7", "#b98ad0", "#4b2c63"], ["#fff1c9", "#f2b84b", "#7a4a12"], ["#dfe3ea", "#8a94a8", "#2c3240"]];
const db = new DatabaseSync(join(userData, "library.db"));
db.exec(`CREATE TABLE artworks(id TEXT PRIMARY KEY,path TEXT NOT NULL COLLATE NOCASE UNIQUE,file_name TEXT NOT NULL,imported_at TEXT NOT NULL,assessment_json TEXT,decision_json TEXT,source_platform TEXT,source_work_id TEXT,source_page_index INTEGER,author_id TEXT,author_name TEXT,work_title TEXT);
  CREATE TABLE collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_artwork_id TEXT,created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks(collection_id TEXT NOT NULL,artwork_id TEXT NOT NULL,PRIMARY KEY(collection_id,artwork_id));
  CREATE TABLE user_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);`);
const artists = [["1001", "星野画室"], ["1002", "青葉"], ["1003", "Mika"]];
const titles = ["夏日海边", "夜色街角", "白裙少女", "雨后", "星空下", "花园午后", "旧书店", "樱花道", "雪原", "黄昏电车", "猫与窗台", "灯塔"];
const insert = db.prepare("INSERT INTO artworks(id,path,file_name,imported_at,source_platform,source_work_id,source_page_index,author_id,author_name,work_title)VALUES(?,?,?,?,?,?,?,?,?,?)");
let index = 0;
for (let work = 0; work < 32; work++) {
  const pages = work % 7 === 0 ? 3 : 1;
  const pixiv = work % 3 !== 2;
  const [artistId, artistName] = artists[work % artists.length];
  for (let page = 0; page < pages; page++) {
    const [w, h] = ratios[(work + page) % ratios.length];
    const scale = 560 / Math.max(w, h);
    const png = makeArtwork(Math.round(w * scale), Math.round(h * scale), palettes[(work + page) % palettes.length], work * 31 + page);
    const name = pixiv ? `${90000 + work}_p${page}.png` : `local-${work}-${page}.png`;
    const path = join(root, name); await writeFile(path, png);
    const stamp = new Date(Date.UTC(2026, 8, 1 + work, 12, page)).toISOString();
    insert.run(`seed-${index++}`, path, name, stamp, pixiv ? "pixiv" : null, pixiv ? String(90000 + work) : null, pixiv ? page : null,
      pixiv ? artistId : null, pixiv ? artistName : null, pixiv ? titles[work % titles.length] : null);
  }
}
const stamp = new Date().toISOString();
db.prepare("INSERT INTO collections VALUES(?,?,?,?,?)").run("c1", "海与天空", "蓝色系参考", null, stamp);
db.prepare("INSERT INTO collections VALUES(?,?,?,?,?)").run("c2", "人物立绘", "", null, stamp);
for (let i = 0; i < 10; i++) db.prepare("INSERT INTO collection_artworks VALUES(?,?)").run(i % 2 ? "c1" : "c2", `seed-${i * 2}`);
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("library.preferences", JSON.stringify({ defaultView: "flat", defaultSortBy: "savedAt", defaultSortDirection: "desc", gridDensity: "comfortable", downloadDirectory: join(root, "Storage", "Pixiv") }), stamp);
db.prepare("INSERT INTO user_preferences VALUES(?,?,?)").run("appearance", JSON.stringify({ displayProfile: "balanced", ambientArtwork: true, reducedMotion: true }), stamp);
db.close();

// ---- Launch ------------------------------------------------------------------------------
const port = await availablePort(), mainPort = await availablePort();
const child = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOCALAPPDATA: join(root, "LocalAppData") } });
let main, cdp, stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const taken = [];
try {
  main = await connectElectronMainInspector(mainPort); await showElectronTestWindow(main); cdp = await renderer();
  await cdp.send("Page.enable");
  for (const scheme of ["light", "dark"]) {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    for (const [width, height] of [[1280, 800], [900, 620]]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const suffix = `${width}-${scheme}`;
      await nav("home"); await shot(`home-${suffix}`);
      await nav("gallery"); await imagesSettled();
      await settle(); await shot(`gallery-${suffix}`);
      if (width === 1280) {
        await cdp.evaluate("document.querySelector('main').scrollTop=600"); await imagesSettled(); await shot(`gallery-scrolled-${suffix}`);
        await cdp.evaluate("document.querySelector('main').scrollTop=0"); await imagesSettled();
        await galleryInteractions(suffix);
        if (await openFirstWork()) {
          await settle(400); await shot(`viewer-${suffix}`);
          if (await cdp.evaluate("(()=>{const b=document.querySelector('[aria-label=\"作品信息\"]');b?.click();return Boolean(b)})()")) {
            await waitFor("Boolean(document.querySelector('.work-information-drawer dl'))", 8000).catch(() => {}); await settle(300); await shot(`viewer-info-${suffix}`);
            await key("Escape"); await settle(150);
          }
          await key("Escape"); await settle();
        }
        if (await openFirstWork("[data-work-tile]:has(.work-tile-pages) .work-tile-image")) { await settle(500); await shot(`viewer-pages-${suffix}`); await key("Escape"); await settle(); }
        if (await clickFirst(["[data-scope='collections']", "button"], "相册")) {
          await imagesSettled(); await shot(`albums-${suffix}`);
          if (await cdp.evaluate("(()=>{const e=document.querySelector('.directory-card-open, .collection-card');e?.click();return Boolean(e)})()")) { await settle(600); await shot(`album-detail-${suffix}`);
            if (await clickFirst([".detail-header .ui-segmented button"], "画册")) { await settle(800); await shot(`album-book-${suffix}`); await clickFirst([".detail-header .ui-segmented button"], "网格"); await settle(); } }
          await clickFirst(["[data-scope='collections']", "button"], "相册"); await settle();
        }
        if (await clickFirst(["[data-scope='author-work']", "button"], "画师")) {
          await imagesSettled(); await shot(`artists-${suffix}`);
          if (await cdp.evaluate("(()=>{const e=document.querySelector('.directory-card-open, .author-browser-card');e?.click();return Boolean(e)})()")) { await settle(600); await shot(`artist-detail-${suffix}`); }
          await clickFirst(["[data-scope='author-work']", "button"], "画师"); await settle();
        }
        await clickFirst(["[data-scope='flat']", "button"], "全部作品") || await clickFirst(["button"], "作品");
      }
      await nav("organize"); await shot(`organize-${suffix}`);
      if (width === 1280) {
        await nav("inspiration"); await shot(`creation-${suffix}`);
        await nav("settings"); await shot(`settings-${suffix}`);
        await nav("explore"); await settle(600); await shot(`explore-${suffix}`);
      }
    }
  }
  console.log(JSON.stringify({ label, directory: shots, screenshots: taken }, null, 2));
} catch (error) {
  console.error(error.stack || error); if (cdp) await shot("failure").catch(() => {}); console.error(stderr.slice(-3000)); process.exitCode = 1;
} finally {
  cdp?.close(); main?.close(); child.kill();
  await new Promise((done) => { if (child.exitCode !== null) done(); else { child.once("exit", done); setTimeout(done, 2000); } });
  const absolute = resolve(root); if (!absolute.startsWith(`${resolve(tmpdir())}${sep}sanctuary-ui-snapshots-`)) throw new Error("Unexpected temporary directory");
  await rm(absolute, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

// ---- Navigation helpers (tolerant of old and new DOM) ------------------------------------
async function nav(view) {
  const selector = `[data-nav="${view}"]`;
  const clicked = await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(e){e.click();return true}return false})()`);
  if (!clicked && view === "home") await cdp.evaluate("document.querySelector('[data-nav-home], .brand-row')?.click()");
  await settle(350);
  await cdp.evaluate("document.querySelector('main')&&(document.querySelector('main').scrollTop=0)");
}
async function openFirstWork(selector = "[data-work-tile] .work-tile-image, .work-cover-button") {
  return cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`)
    .then(async (ok) => { if (ok) await waitFor("Boolean(document.querySelector('[role=dialog] img'))", 8000).catch(() => {}); return ok; });
}
async function clickFirst(selectors, text) {
  return cdp.evaluate(`(()=>{for(const s of ${JSON.stringify(selectors)}){const e=Array.from(document.querySelectorAll(s)).find(n=>n.textContent.trim()===${JSON.stringify(text)}&&!n.disabled&&n.offsetParent!==null);if(e){e.click();return true}}return false})()`);
}
// Hover, context menu, filter menu and batch selection on the redesigned grid (skipped on the old DOM).
async function galleryInteractions(suffix) {
  const box = await cdp.evaluate(`(()=>{const e=document.querySelectorAll('[data-work-tile] .work-tile-image')[1];if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  if (!box) return;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await settle(200); await shot(`gallery-hover-${suffix}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "right", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "right", clickCount: 1 });
  await settle(200); await shot(`gallery-context-menu-${suffix}`);
  await key("Escape"); await settle(100);
  await cdp.evaluate("document.querySelector('[data-gallery-filter]')?.click()"); await settle(200); await shot(`gallery-filter-menu-${suffix}`);
  await key("Escape"); await settle(100);
  await cdp.evaluate("[...document.querySelectorAll('.work-tile-check')].slice(0,3).forEach(b=>b.click())"); await settle(250);
  await shot(`gallery-selecting-${suffix}`);
  await cdp.evaluate("document.querySelector('.work-selection-bar [aria-label=\"退出选择\"]')?.click()"); await settle(100);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
}

// Every image tile visible in the viewport has decoded (or the wait gives up and the shot shows what is there).
async function imagesSettled(timeout = 15000) {
  const visibleLoaded = `(()=>{const imgs=[...document.querySelectorAll('main img')].filter(i=>{const r=i.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0});
    return imgs.length>0&&imgs.every(i=>i.complete&&i.naturalWidth>0)})()`;
  await waitFor(visibleLoaded, timeout).catch(() => console.error("[snapshots] images still loading at capture"));
  await settle(150);
}
async function settle(ms = 250) { await cdp.evaluate(`new Promise(done=>setTimeout(done,${ms}))`); }
async function waitFor(expression, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await cdp.evaluate(expression)) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error(`Timed out: ${expression}`); }
async function key(name) { await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: name === "Escape" ? 27 : 0 }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: name === "Escape" ? 27 : 0 }); }
async function shot(name) { const capture = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }); await writeFile(join(shots, `${name}.png`), Buffer.from(capture.data, "base64")); taken.push(name); }
async function renderer() { const start = Date.now(); while (Date.now() - start < 20000) { try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), target = targets.find((t) => t.type === "page" && t.url?.includes("renderer/index.html")); if (target?.webSocketDebuggerUrl) return connect(target.webSocketDebuggerUrl); } catch {} await new Promise((done) => setTimeout(done, 100)); } throw new Error("Renderer unavailable"); }
async function availablePort() { const server = createServer(); return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close((error) => error ? reject(error) : done(p)); }); }); }
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let next = 1;
  socket.addEventListener("message", (e) => { const r = JSON.parse(e.data), p = pending.get(r.id); if (!p) return; pending.delete(r.id); r.error ? p.reject(new Error(r.error.message)) : p.resolve(r.result); });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = next++, timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 20000); pending.set(id, { resolve: (r) => { clearTimeout(timer); res(r); }, reject: (e) => { clearTimeout(timer); rej(e); } }); socket.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => socket.close(), evaluate: async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; } };
}

// ---- Synthetic artwork: soft vertical gradient, a sun disc and two hill bands ------------
function makeArtwork(width, height, palette, seed) {
  const [sky, mid, ground] = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const rand = mulberry(seed);
  const sunX = width * (0.2 + rand() * 0.6), sunY = height * (0.2 + rand() * 0.25), sunR = Math.min(width, height) * (0.08 + rand() * 0.08);
  const hill1 = height * (0.6 + rand() * 0.1), hill2 = height * (0.75 + rand() * 0.1), phase = rand() * 6;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const t = y / height; let c = mix(sky, mid, t);
      if ((x - sunX) ** 2 + (y - sunY) ** 2 < sunR ** 2) c = mix([255, 250, 235], mid, 0.15);
      if (y > hill1 + Math.sin(x / width * 5 + phase) * height * 0.04) c = mix(mid, ground, 0.55);
      if (y > hill2 + Math.sin(x / width * 3 + phase * 2) * height * 0.03) c = ground;
      const o = row + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); }
function crc32(buf) { let c = -1; for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ -1) >>> 0; }
