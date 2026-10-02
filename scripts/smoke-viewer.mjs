import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { deflateSync } from "node:zlib";
import { connectElectronMainInspector } from "./electron-smoke-support.mjs";

// Real renderer, real local image protocol, disposable library; no model or user library required.
const port = await availablePort();
const mainPort = await availablePort();
const temporaryRoot = resolve(tmpdir());
const userData = await mkdtemp(join(temporaryRoot, "sanctuary-viewer-"));
const screenshots = resolve(".tmp/viewer-smoke");
await mkdir(screenshots, { recursive: true });
const timestamp = new Date().toISOString();
const fixturePaths = [];
const database = new DatabaseSync(join(userData, "library.db"));
database.exec(`
  CREATE TABLE artworks (
    id TEXT PRIMARY KEY, path TEXT NOT NULL COLLATE NOCASE UNIQUE, file_name TEXT NOT NULL,
    imported_at TEXT NOT NULL, assessment_json TEXT, decision_json TEXT, source_platform TEXT,
    source_work_id TEXT, source_page_index INTEGER, author_id TEXT, author_name TEXT, work_title TEXT
  );
  CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover_artwork_id TEXT, created_at TEXT NOT NULL);
  CREATE TABLE collection_artworks (collection_id TEXT NOT NULL, artwork_id TEXT NOT NULL, PRIMARY KEY(collection_id, artwork_id));
  CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
`);
database.prepare("INSERT INTO collections(id, name, description, cover_artwork_id, created_at) VALUES ('viewer-album', '查看器测试相册', '', 'viewer-page-0', ?)").run(timestamp);
database.prepare("INSERT INTO user_preferences(key, value_json, updated_at) VALUES ('library.preferences', ?, ?)").run(JSON.stringify({ defaultView: "flat", defaultSortBy: "savedAt", defaultSortDirection: "desc", gridDensity: "comfortable", downloadDirectory: join(userData, "Storage", "Pixiv") }), timestamp);
for (let index = 0; index < 3; index++) {
  const path = join(userData, `123456789_p${index}.png`);
  fixturePaths.push(path);
  await writeFile(path, fixturePng(index === 1 ? 1400 : 2000, index === 1 ? 2000 : 1400, index));
  database.prepare(`INSERT INTO artworks(id, path, file_name, imported_at, source_platform, source_work_id,
    source_page_index, author_id, author_name, work_title) VALUES (?, ?, ?, ?, 'pixiv', '123456789', ?, 'viewer-artist', '测试画师', '横竖画幅三页作品')`)
    .run(`viewer-page-${index}`, path, `123456789_p${index}.png`, timestamp, index);
  database.prepare("INSERT INTO collection_artworks(collection_id, artwork_id) VALUES ('viewer-album', ?)").run(`viewer-page-${index}`);
}
database.close();
const child = spawn(resolve("node_modules/electron/dist/electron.exe"),
  [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
  { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const checks = [];

try {
  const target = await waitForRenderer();
  const main = await connectElectronMainInspector(mainPort);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    // Test-only IPC fixture inside this disposable Electron process; production renderer/preload stay unchanged.
    await main.evaluate(`(() => {
      const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain;
      const channel = 'vision:inspect-artwork';
      const original = ipc._invokeHandlers.get(channel);
      if (!original) throw new Error('Inspector handler unavailable');
      const paths = ${JSON.stringify(fixturePaths)};
      const pages = paths.map((path, pageIndex) => ({ pageIndex, thumbUrl: 'sanctuary-image://local/' + encodeURIComponent(path), regularUrl: 'sanctuary-image://local/' + encodeURIComponent(path) }));
      const state = globalThis.__viewerInspect = { controlled: false, pending: [], requests: [], original };
      state.response = pageIndex => ({ assessment: { status: 'complete', engine: 'fixture', engineVersion: '1', labels: { ['fixture_page_' + pageIndex]: .93 }, elapsedMs: 1 }, pageCount: 3, activePageIndex: pageIndex, pages });
      ipc.removeHandler(channel);
      ipc.handle(channel, (_event, request) => {
        state.requests.push(request);
        if (!state.controlled) return state.response(request.pageIndex ?? 0);
        return new Promise((resolve, reject) => state.pending.push({ request, resolve, reject }));
      });
      return true;
    })()`);
    async function waitFor(expression) {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        if (await cdp.evaluate(expression)) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw new Error(`Timed out: ${expression}`);
    }
    async function click(selector) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
    async function clickText(selector, text) {
      await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(el => el.textContent.includes(${JSON.stringify(text)}))`);
      await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.includes(${JSON.stringify(text)})).click()`);
    }
    async function key(key, code = key) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
    }
    async function imageReady() {
      await waitFor("Boolean(document.querySelector('.cinema-image-entity')?.complete && document.querySelector('.cinema-image-entity')?.naturalWidth > 0 && document.querySelector('.cinema-image-entity')?.getAttribute('aria-busy') === 'false')");
    }
    async function screenshot(name) {
      const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(join(screenshots, `${name}.png`), Buffer.from(result.data, "base64"));
    }
    async function viewerChecks(entry) {
      await imageReady();
      const layout = await cdp.evaluate(`(() => {
        const theater = document.querySelector('.cinema-lightbox-theater');
        const buttons = Array.from(theater.querySelectorAll('.cinema-hud-island button'));
        return { overflow: theater.scrollWidth - theater.clientWidth,
          controlsVisible: buttons.every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width >= 35 && r.height >= 35; }),
          objectFit: getComputedStyle(theater.querySelector('img.cinema-image-entity')).objectFit,
          profile: theater.dataset.displayProfile };
      })()`);
      assert.equal(layout.overflow, 0, `${entry} overflow`);
      assert.equal(layout.controlsVisible, true, `${entry} unreachable controls`);
      assert.equal(layout.objectFit, "contain", `${entry} original was cropped`);
      await screenshot(`${entry}-fit`);
      const initialScroll = await cdp.evaluate("document.querySelector('.app-shell > main').scrollTop");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 550, y: 310, deltaX: 0, deltaY: -60 });
      await waitFor("new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.cinema-image-entity')).transform).a > 1.05");
      assert.equal(await cdp.evaluate("document.querySelector('.app-shell > main').scrollTop"), initialScroll, `${entry} wheel leaked to background`);
      await key("0", "Digit0");
      await key("1", "Digit1");
      await waitFor("document.querySelector('.cinema-image-entity').style.transform !== 'translate(0px, 0px) scale(1)'");
      const native = await cdp.evaluate(`(() => { const img = document.querySelector('.cinema-image-entity'); const matrix = new DOMMatrixReadOnly(getComputedStyle(img).transform); return { scale: matrix.a, expected: img.naturalWidth / img.clientWidth, imageWidth: img.naturalWidth, fittedWidth: img.clientWidth }; })()`);
      // Wait for the tiny transform easing to settle; do not make timing/frame-rate claims.
      await waitFor(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.cinema-image-entity')).transform).a - ${native.expected}) < 0.01`);
      assert.ok(native.expected > 1, "fixture must require a genuine native zoom");
      assert.equal(await cdp.evaluate("document.querySelector('.zoom-readout').textContent"), "100%", "native pixel scale readout should be 100%");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 450, y: 310 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: 450, y: 310 });
      await waitFor("document.querySelector('.cinema-stage-viewport').classList.contains('panning')");
      const drag = await cdp.evaluate(`(async () => {
        const image = document.querySelector('.cinema-image-entity');
        let paints = 0;
        const observer = new MutationObserver(records => { paints += records.filter(record => record.attributeName === 'style').length; });
        observer.observe(image, { attributes: true, attributeFilter: ['style'] });
        const stage = document.querySelector('.cinema-stage-viewport');
        for (let i = 1; i <= 100; i++) stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 450 + i * 2, clientY: 310 + i, pointerType: 'mouse' }));
        await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        observer.disconnect();
        const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
        return { paints, inputEvents: 100, x: matrix.e, y: matrix.f };
      })()`);
      assert.ok(drag.paints >= 1 && drag.paints <= 2, `${entry} pointer burst was not coalesced: ${JSON.stringify(drag)}`);
      assert.ok(drag.x > 0 && drag.y > 0, `${entry} pan did not move`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: 650, y: 410 });
      await waitFor("!document.querySelector('.cinema-stage-viewport').classList.contains('panning')");
      await key("0", "Digit0");
      await waitFor("document.querySelector('.cinema-image-entity').style.transform === 'translate(0px, 0px) scale(1)'");
      await key("ArrowRight");
      await waitFor("document.querySelector('.cinema-heading-group small').textContent.includes('第 2/3 页')");
      await imageReady();
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-image-entity').naturalHeight"), 2000);
      await key("End");
      await waitFor("document.querySelector('.cinema-heading-group small').textContent.includes('第 3/3 页')");
      await imageReady();
      await key("Home");
      await waitFor("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')");
      await imageReady();
      await clickText(".cinema-hud-island button", "雷达画像");
      await waitFor("Boolean(document.querySelector('.cinema-radar-drawer'))");
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.cinema-nav-arrow, .filmstrip-thumb-btn')).every(button => button.disabled)"), true, "background page controls remained enabled under radar");
      await click(".cinema-nav-arrow.next");
      await click(".filmstrip-thumb-btn:last-child");
      await key("ArrowRight");
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"), true);
      await key("Escape");
      await waitFor("!document.querySelector('.cinema-radar-drawer')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), true);
      await clickText(".cinema-hud-island button", "元素透视");
      await waitFor("Boolean(document.querySelector('.element-inspector-drawer'))");
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.cinema-nav-arrow, .filmstrip-thumb-btn')).every(button => button.disabled)"), true, "background page controls remained enabled under inspector");
      // Keep this test independent of installed vision models. An editor in the actual topmost drawer has the same keyboard ownership as its prompt/search inputs.
      await cdp.evaluate(`(() => { const input = document.createElement('input'); input.id = 'viewer-test-editor'; document.querySelector('.element-inspector-drawer').append(input); input.focus(); })()`);
      await key("Tab");
      assert.equal(await cdp.evaluate("Boolean(document.activeElement.closest('.element-inspector-drawer'))"), true, "Tab escaped the topmost drawer");
      await cdp.evaluate("document.querySelector('#viewer-test-editor').focus()");
      await cdp.evaluate("document.querySelector('#viewer-test-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }))");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.element-inspector-drawer'))"), true, "IME composition Escape closed the drawer");
      await key("ArrowRight");
      await key("1", "Digit1");
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"), true);
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-image-entity').style.transform"), "translate(0px, 0px) scale(1)");
      await key("Escape");
      await waitFor("!document.querySelector('.element-inspector-drawer')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), true);
      await key("Escape");
      await waitFor("!document.querySelector('.cinema-lightbox-theater')");
      checks.push({ entry, layout, nativeScale: native.expected, drag, keyboard: "page/home/end and nested input/escape pass" });
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
    await waitFor("document.querySelectorAll('.work-library-card').length === 1");
    await cdp.evaluate(`(() => { const RealImage = window.Image; window.__viewerPreloads = []; window.Image = function(...args) { const image = new RealImage(...args); window.__viewerPreloads.push(image); return image; }; })()`);
    await click(".work-cover-button");
    await viewerChecks("flat-gallery");
    const flatPreloads = await cdp.evaluate("({ total: window.__viewerPreloads.length, liveAfterExit: window.__viewerPreloads.filter(image => image.hasAttribute('src')).length })");
    assert.ok(flatPreloads.total <= 3, `unbounded original preload: ${JSON.stringify(flatPreloads)}`);
    assert.equal(flatPreloads.liveAfterExit, 0, "original preloads retained after closing");
    checks.push({ name: "bounded-original-preload-and-exit-release", ...flatPreloads });

    await clickText('[aria-label="画廊布局"] button', "相册");
    await click(".collection-card");
    await waitFor("Boolean(document.querySelector('.album-fullscreen-theater'))");
    await clickText('[aria-label="画册模式"] button', "典藏网格");
    await click(".collection-detail-grid .art-preview-button");
    await viewerChecks("album-gallery");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.album-fullscreen-theater'))"), true, "closing the viewer also closed its parent album");
    await key("Escape");
    await waitFor("!document.querySelector('.album-fullscreen-theater')");

    await click('[data-nav="settings"]');
    await click('[data-settings="appearance"]');
    await clickText(".settings-panel:not([hidden]) button", "省电");
    await waitFor("document.querySelector('.app-shell').dataset.displayProfile === 'efficient'");
    await click('[data-nav="gallery"]');
    await clickText('[aria-label="画廊布局"] button', "全部作品");
    const before = await cdp.evaluate("window.__viewerPreloads.length");
    await click(".work-cover-button");
    await imageReady();
    const profile = await cdp.evaluate("({ profile: document.querySelector('.cinema-lightbox-theater').dataset.displayProfile, backdrop: getComputedStyle(document.querySelector('.cinema-hud-island')).backdropFilter, addedPreloads: window.__viewerPreloads.length - " + before + " })");
    assert.equal(profile.profile, "efficient");
    assert.equal(profile.backdrop, "none");
    assert.equal(profile.addedPreloads, 0);
    await screenshot("efficient-viewer");
    await key("Escape");
    checks.push({ name: "efficient-viewer-skips-prefetch-and-blur", ...profile });

    await cdp.evaluate("(async () => window.sanctuary.updateLibraryPreferences({ ...(await window.sanctuary.getLibraryPreferences()), defaultView: 'collections' }))()");
    await cdp.send("Page.reload");
    await waitFor("Boolean(document.querySelector('.collection-card'))");
    await click(".collection-card");
    await waitFor("Boolean(document.querySelector('.album-fullscreen-theater'))");
    await clickText('[aria-label="画册模式"] button', "典藏网格");
    await waitFor("document.querySelectorAll('.collection-detail-grid .art-preview-button').length === 3");
    checks.push({ name: "default-album-startup-loads-all-three-legacy-pages" });
    await key("Escape");
    await cdp.evaluate("(async () => window.sanctuary.updateLibraryPreferences({ ...(await window.sanctuary.getLibraryPreferences()), defaultView: 'author-work' }))()");
    await cdp.send("Page.reload");
    await waitFor("document.querySelectorAll('.author-browser-card').length === 1");
    checks.push({ name: "default-artist-startup-loads-legacy-pages" });

    await clickText('[aria-label="画廊布局"] button', "全部作品");
    await waitFor("document.querySelectorAll('.work-library-card').length === 1");
    await click(".work-cover-button");
    await imageReady();
    await clickText(".cinema-hud-island button", "元素透视");
    await waitFor("document.querySelector('.inspector-tag-name')?.textContent === 'fixture_page_0'");
    await main.evaluate("globalThis.__viewerInspect.controlled = true");
    await click('.inspector-page-pill:nth-child(2)');
    await click('.inspector-page-pill:nth-child(3)');
    assert.equal(await main.evaluate("globalThis.__viewerInspect.pending.length"), 2);
    await main.evaluate("globalThis.__viewerInspect.pending[1].resolve(globalThis.__viewerInspect.response(2))");
    await waitFor("document.querySelector('.inspector-tag-name')?.textContent === 'fixture_page_2'");
    await main.evaluate("globalThis.__viewerInspect.pending[0].resolve(globalThis.__viewerInspect.response(1))");
    await cdp.evaluate("new Promise(done => setTimeout(done, 100))");
    assert.equal(await cdp.evaluate("document.querySelector('.inspector-tag-name')?.textContent"), "fixture_page_2", "slow old page replaced the newer response");
    assert.equal(await cdp.evaluate("document.querySelector('.inspector-page-pill[aria-selected=true]').textContent.trim()"), "P3");

    await click('.inspector-page-pill:nth-child(2)');
    await click('.inspector-page-pill:nth-child(1)');
    assert.equal(await main.evaluate("globalThis.__viewerInspect.pending.length"), 4);
    await main.evaluate("globalThis.__viewerInspect.pending[2].reject(new Error('obsolete fixture error'))");
    await cdp.evaluate("new Promise(done => setTimeout(done, 100))");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.inspector-loading'))"), true, "old finally cleared current loading");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.element-inspector-drawer .app-notice--error'))"), false, "obsolete error escaped into the current page");
    await main.evaluate("globalThis.__viewerInspect.pending[3].resolve(globalThis.__viewerInspect.response(0))");
    await waitFor("document.querySelector('.inspector-tag-name')?.textContent === 'fixture_page_0'");

    await click('.inspector-page-pill:nth-child(2)');
    await main.evaluate("globalThis.__viewerInspect.pending[4].reject(new Error('current fixture error'))");
    await waitFor("document.querySelector('.element-inspector-drawer .app-notice--error')?.textContent.includes('current fixture error')");
    await click('.inspector-empty button');
    assert.equal(await main.evaluate("globalThis.__viewerInspect.pending[5].request.pageIndex"), 1, "retry used the original target page instead of the current page");
    await main.evaluate("globalThis.__viewerInspect.pending[5].resolve(globalThis.__viewerInspect.response(1))");
    await waitFor("document.querySelector('.inspector-tag-name')?.textContent === 'fixture_page_1'");
    await click('.inspector-page-pill:nth-child(3)');
    await key("Escape");
    await waitFor("!document.querySelector('.element-inspector-drawer')");
    await main.evaluate("globalThis.__viewerInspect.controlled = false");
    await clickText(".cinema-hud-island button", "元素透视");
    await waitFor("document.querySelector('.inspector-tag-name')?.textContent === 'fixture_page_0'");
    await main.evaluate("globalThis.__viewerInspect.pending[6].resolve(globalThis.__viewerInspect.response(2))");
    await cdp.evaluate("new Promise(done => setTimeout(done, 100))");
    assert.equal(await cdp.evaluate("document.querySelector('.inspector-tag-name')?.textContent"), "fixture_page_0", "closed drawer request leaked into a new target instance");
    await key("Escape");
    await key("Escape");
    await waitFor("!document.querySelector('.cinema-lightbox-theater')");
    checks.push({ name: "inspector-out-of-order-result-error-loading-current-page-retry-and-unmount" });

    await cdp.evaluate("(() => { const button = document.querySelector('.work-card-favorite'); button.click(); button.click(); })()");
    await waitFor("document.querySelector('.work-card-favorite')?.classList.contains('active') && !document.querySelector('.work-card-favorite')?.disabled");
    await waitFor("document.querySelector('.work-operation-notice')?.textContent.includes('已喜欢')");
    await clickText(".work-operation-notice button", "撤销");
    await waitFor("!document.querySelector('.work-card-favorite')?.classList.contains('active') && !document.querySelector('.work-operation-notice')");
    await click(".work-select-toggle");
    await click(".work-cover-button");
    await waitFor("document.querySelector('.work-library-card').classList.contains('selected')");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), false, "stable card callbacks used stale selection mode");
    await click(".work-select-toggle");
    checks.push({ name: "memoized-card-favorite-undo-and-current-selection-mode" });

    await cdp.evaluate("(() => { window.__viewerUnhandled = 0; window.addEventListener('unhandledrejection', () => window.__viewerUnhandled++); })()");
    // Delete only this fixture album through IPC while leaving the rendered select stale, then exercise a genuine failed assignment.
    await cdp.evaluate("window.sanctuary.deleteCollection('viewer-album')");
    await cdp.evaluate("(() => { const select = document.querySelector('.work-card-foot select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'viewer-album'); select.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await waitFor("Boolean(document.querySelector('.app-notice--error')) && !document.querySelector('.work-card-foot select').disabled");
    assert.equal(await cdp.evaluate("window.__viewerUnhandled"), 0, "card mutation produced an unhandled rejection");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.work-operation-notice'))"), false, "failed assignment claimed success");
    checks.push({ name: "failed-card-assignment-surfaces-error-and-releases-busy-without-success-or-rejection" });
    console.log(JSON.stringify({ status: "passed", checks, screenshots }, null, 2));
  } finally {
    cdp.close();
    await main.evaluate("(() => { const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain; ipc.removeHandler('vision:inspect-artwork'); ipc.handle('vision:inspect-artwork', globalThis.__viewerInspect.original); delete globalThis.__viewerInspect; })()").catch(() => {});
    main.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise((done) => { if (child.exitCode !== null) done(); else { child.once("exit", done); setTimeout(done, 2000); } });
  const resolved = resolve(userData);
  if (!resolved.startsWith(`${temporaryRoot}${sep}sanctuary-viewer-`)) throw new Error("Unexpected temporary directory");
  await rm(resolved, { recursive: true, force: true });
}

function fixturePng(width, height, variant) {
  const bytes = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      bytes[offset] = 50 + (variant * 60 + Math.floor(x / 50) * 8) % 150;
      bytes[offset + 1] = 70 + Math.floor(y / 50) * 4 % 140;
      bytes[offset + 2] = 180;
      bytes[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(bytes)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type, data) {
  const label = Buffer.from(type);
  const bytes = Buffer.concat([label, data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}

async function waitForRenderer() {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page" && entry.url?.replaceAll("\\", "/").includes("/renderer/index.html"));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Isolated Electron renderer did not start");
}

async function availablePort() {
  const server = createServer();
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : done(port));
    });
  });
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
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve: (result) => { clearTimeout(timeout); done(result); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close(), evaluate: async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  } };
}
