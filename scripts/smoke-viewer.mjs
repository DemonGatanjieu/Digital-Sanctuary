import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { deflateSync } from "node:zlib";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

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
const startElectron = () => spawn(resolve("node_modules/electron/dist/electron.exe"),
  [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
  { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let child = startElectron();
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const checks = [];

try {
  let main = await connectElectronMainInspector(mainPort);
  await showElectronTestWindow(main);
  const target = await waitForRenderer();
  let cdp = await connectCdp(target.webSocketDebuggerUrl);
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
    async function waitForMain(expression) {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        if (await main.evaluate(expression)) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw new Error(`Main fixture timed out: ${expression}`);
    }
    async function click(selector) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
    async function clickText(selector, text) {
      await cdp.evaluate(`(() => { const node=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>el.textContent.includes(${JSON.stringify(text)})); const menu=node?.closest(".browse-mode-menu,.photobook-display-options,.artwork-tools-menu"); if(menu && !menu.open) menu.querySelector("summary").click(); })()`);
      await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(el => el.textContent.includes(${JSON.stringify(text)}))`);
      await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.includes(${JSON.stringify(text)})).click()`);
    }
    async function key(key, code = key) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
    }
    async function changeControl(selector, value) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await cdp.evaluate(`(() => { const control = document.querySelector(${JSON.stringify(selector)}); const prototype = control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(value)}); control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
    }

    // ---- image-first gallery helpers (menus replace the old selects and segmented filters) ----
    const TILE = "[data-work-tile]", OPEN = "[data-work-tile] .work-tile-image", SEARCH = ".gallery-search-field input";
    const ALBUM_CARD = "section[aria-label=相册] .directory-card-open", ALBUM_TILE = ".album-fullscreen-theater .work-tile-image";
    async function menu(trigger, label) {
      await click(trigger);
      await waitFor("Boolean(document.querySelector('.ui-popover'))");
      await clickText('.ui-popover [role^="menuitem"]', label);
    }
    async function setPreset(label) { await menu('[data-gallery-filter]', label); }
    async function setType(label) { await menu('[data-gallery-filter]', label); }
    async function activePreset() {
      return cdp.evaluate("(()=>{const t=[...document.querySelectorAll('.work-filter-chips .ui-chip')].map(c=>c.textContent);return ['喜欢','最近浏览','未分相册'].find(l=>t.some(x=>x.startsWith(l)))??'全部'})()");
    }
    async function hasChip(label) { return cdp.evaluate(`[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(c=>c.textContent.startsWith(${JSON.stringify(label)}))`); }
    async function sortLabel() { return cdp.evaluate("document.querySelector('[aria-label^=\"排序：\"]').getAttribute('aria-label')"); }
    async function sortDisabled() { return cdp.evaluate("document.querySelector('[aria-label^=\"排序：\"]').disabled"); }
    async function sortAscending() {
      await click('[aria-label^="排序："]'); await waitFor("Boolean(document.querySelector('.ui-popover'))");
      const ascending = await cdp.evaluate("[...document.querySelectorAll('.ui-popover [role^=menuitem]')].find(e=>e.textContent.includes('从旧到新')).getAttribute('aria-checked')==='true'");
      await key('Escape'); await waitFor("!document.querySelector('.ui-popover')");
      return ascending;
    }
    async function nameSearch() { if (await cdp.evaluate("document.querySelector('.gallery-search-mode')?.textContent==='按画面'")) await click('.gallery-search-mode'); }
    async function openSavedFilters() { await menu('[data-gallery-filter]', '常用筛选'); await waitFor("Boolean(document.querySelector('.saved-work-filters-dialog'))"); }
    async function contextMenu(selector) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+20}))})()`);
      await waitFor("Boolean(document.querySelector('.ui-popover'))");
    }
    async function waitForProgress(pageIndex) {
      await waitFor(`(async () => { const work = await window.sanctuary.getWork('pixiv:123456789'); return work.readingProgress?.assetId === work.assets[${pageIndex}].id; })()`);
    }
    async function imageReady() {
      await waitFor("Boolean(document.querySelector('.cinema-image-entity')?.complete && document.querySelector('.cinema-image-entity')?.naturalWidth > 0 && document.querySelector('.cinema-image-entity')?.getAttribute('aria-busy') === 'false')");
    }
    async function screenshot(name) {
      await cdp.evaluate("new Promise(resolve => setTimeout(resolve, 280))");
      const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(join(screenshots, `${name}.png`), Buffer.from(result.data, "base64"));
    }
    async function viewerChecks(entry) {
      await imageReady();
      const inspectCount = await main.evaluate('__viewerInspect.requests.length');
      await click('[aria-label="作品信息"]');
      await waitFor("Boolean(document.querySelector('.work-information-drawer [aria-label=\"作品相册\"]'))");
      assert.equal(await cdp.evaluate("document.querySelector('.work-information-drawer').textContent.includes('Pixiv · 123456789')"), true);
      assert.equal(await cdp.evaluate("document.querySelector('.work-information-drawer').textContent.includes('查看器测试相册')"), true);
      assert.equal(await main.evaluate('__viewerInspect.requests.length'), inspectCount, 'reading information started model analysis');
      const informationBounds = await cdp.evaluate("(()=>{const n=document.querySelector('.work-information-drawer'),r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:n.scrollWidth-n.clientWidth};})()");
      assert.ok(informationBounds.left >= 0 && informationBounds.right <= informationBounds.width && informationBounds.top >= 0 && informationBounds.bottom <= informationBounds.height && informationBounds.overflow <= 2, `information panel outside the window: ${JSON.stringify(informationBounds)}`);
      await clickText('.work-information-drawer button', '移出相册');
      await waitFor("document.querySelector('.work-information-drawer').textContent.includes('还未加入相册')");
      await changeControl('[aria-label="作品信息相册"]', 'viewer-album');
      await clickText('.work-information-drawer button', '加入相册');
      await waitFor("Boolean(document.querySelector('.work-information-albums li'))");
      await key('ArrowRight');
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"), true);
      await cdp.evaluate("document.querySelector('[aria-label=\"作品信息相册\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:229,isComposing:true,bubbles:true}))");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.work-information-drawer'))"), true);
      await waitFor("Array.from(document.querySelectorAll('.work-information-drawer button')).some(button=>button.textContent.includes('改名') && !button.disabled)");
      await clickText('.work-information-drawer button','改名');
      await waitFor("document.activeElement?.getAttribute('aria-label')==='图库名称'");
      await changeControl('[aria-label="图库名称"]',' ');
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.work-information-drawer button')).find(button=>button.textContent.includes('保存名称')).disabled"),true);
      const galleryName=`我的三页收藏 · ${entry} 中文长名称 / 只改图库显示`;
      await changeControl('[aria-label="图库名称"]',galleryName);
      await main.evaluate(`(() => {
        const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
        const original=ipc._invokeHandlers.get('library:rename-work');ipc.removeHandler('library:rename-work');
        ipc.handle('library:rename-work',(...args)=>{ipc.removeHandler('library:rename-work');ipc.handle('library:rename-work',original);throw new Error('隔离命名保存失败')});return true;
      })()`);
      await clickText('.work-information-drawer button','保存名称');
      await waitFor("document.querySelector('.work-information-drawer [role=alert]')?.textContent.includes('隔离命名保存失败')");
      assert.equal(await cdp.evaluate("document.querySelector('[aria-label=\"图库名称\"]').value"),galleryName,'failed rename lost the input');
      await clickText('.work-information-drawer button','保存名称');
      await waitFor("document.querySelector('.work-information-drawer [role=status]')?.textContent==='图库名称已保存'");
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group strong').textContent"),galleryName);
      const renamed=await cdp.evaluate("window.sanctuary.getWork('pixiv:123456789')");
      assert.equal(renamed.title,galleryName);assert.deepEqual(renamed.assets.map(asset=>asset.path),fixturePaths);
      assert.equal(await main.evaluate('__viewerInspect.requests.length'),inspectCount,'renaming started model analysis');
      checks.push({name:'gallery-name-edit-focus-empty-failure-retry-original-paths-and-live-heading',entry});
      await screenshot(`${entry}-work-information`);
      await key('Escape');
      await waitFor("!document.querySelector('.work-information-drawer')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), true);
      checks.push({name:'shared-work-information-read-only-album-round-trip-and-topmost-escape',entry,informationBounds});
      const layout = await cdp.evaluate(`(() => {
        const theater = document.querySelector('.cinema-lightbox-theater');
        const buttons = Array.from(theater.querySelectorAll('.cinema-hud-island button,.cinema-hud-island summary')).filter(el=>el.checkVisibility());
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
      assert.equal(await cdp.evaluate("document.querySelector('.viewer-readout').textContent"), "100%", "native pixel scale readout should be 100%");
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
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.ui-popover'))"),false);
      await click('[aria-label="更多工具"]');
      await waitFor("Boolean(document.querySelector('.ui-popover'))");
      const toolsBounds=await cdp.evaluate("(() => {const r=document.querySelector('.ui-popover').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,height:innerHeight,width:innerWidth};})()");
      assert.ok(toolsBounds.left>=0 && toolsBounds.right<=toolsBounds.width && toolsBounds.bottom<=toolsBounds.height,`${entry} tools menu clipped: ${JSON.stringify(toolsBounds)}`);
      await key('ArrowRight');
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"),true);
      await cdp.evaluate("document.querySelector('.ui-popover').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:229,isComposing:true,bubbles:true}))");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.ui-popover'))"),true);
      await key('Escape');
      await waitFor("!document.querySelector('.ui-popover')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"),true);
      await menu('[aria-label="更多工具"]', "画像与画评");
      await waitFor("Boolean(document.querySelector('.cinema-radar-drawer'))");
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.cinema-nav-arrow, .filmstrip-thumb-btn')).every(button => button.disabled)"), true, "background page controls remained enabled under radar");
      await click(".cinema-nav-arrow.next");
      await click(".filmstrip-thumb-btn:last-child");
      await key("ArrowRight");
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"), true);
      await key("Escape");
      await waitFor("!document.querySelector('.cinema-radar-drawer')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), true);
      await menu('[aria-label="更多工具"]', "元素与提示词");
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
    await click('[data-nav="gallery"]');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    await menu('[aria-label^="排序："]', '标题');
    await menu('[aria-label^="排序："]', '从旧到新');
    await setPreset('最近浏览');
    await waitFor("document.querySelector('.gallery-empty h2')?.textContent === '还没有浏览记录'");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.gallery-empty--first'))"), false, "empty recent history was presented as a completely empty library");
    await click('[data-nav="settings"]');
    await click('[data-nav="gallery"]');
    await waitFor("[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(c=>c.textContent.startsWith('最近浏览'))");
    await setPreset('全部作品');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    assert.match(await sortLabel(), /标题/, "leaving recent after visiting settings lost the user's previous sort");
    assert.equal(await sortAscending(), true);
    await setPreset('喜欢');
    await waitFor("document.querySelector('.gallery-empty h2')?.textContent === '还没有喜欢的作品'");
    await setPreset('未分相册');
    await waitFor("document.querySelector('.gallery-empty h2')?.textContent === '没有未分相册的作品'");
    await screenshot('empty-presets-retain-controls');
    await setPreset('全部作品');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    checks.push({ name: "empty-presets-keep-controls-and-recent-restores-sort-across-settings" });
    await cdp.evaluate(`(() => { const RealImage = window.Image; window.__viewerPreloads = []; window.Image = function(...args) { const image = new RealImage(...args); window.__viewerPreloads.push(image); return image; }; })()`);
    await click(OPEN);
    await viewerChecks("flat-gallery");
    const flatPreloads = await cdp.evaluate("({ total: window.__viewerPreloads.length, liveAfterExit: window.__viewerPreloads.filter(image => image.hasAttribute('src')).length })");
    assert.ok(flatPreloads.total <= 3, `unbounded original preload: ${JSON.stringify(flatPreloads)}`);
    assert.equal(flatPreloads.liveAfterExit, 0, "original preloads retained after closing");
    checks.push({ name: "bounded-original-preload-and-exit-release", ...flatPreloads });

    await clickText('.gallery-scope button', "相册");
    await click(ALBUM_CARD);
    await waitFor("Boolean(document.querySelector('.album-fullscreen-theater'))");
    await clickText('.detail-header .ui-segmented button', "网格");
    await click(ALBUM_TILE);
    await viewerChecks("album-gallery");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.album-fullscreen-theater'))"), true, "closing the viewer also closed its parent album");
    await key("Escape");
    await waitFor("!document.querySelector('.album-fullscreen-theater')");

    await click('[data-nav="settings"]');
    await click('[data-settings="appearance"]');
    await clickText(".settings-panel:not([hidden]) button", "省电");
    await waitFor("document.querySelector('.app-shell').dataset.displayProfile === 'efficient'");
    await click('[data-nav="gallery"]');
    await clickText('.gallery-scope button', "作品");
    const before = await cdp.evaluate("window.__viewerPreloads.length");
    await click(OPEN);
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
    await click('[data-nav="gallery"]');
    await waitFor("Boolean(document.querySelector('section[aria-label=相册] .directory-card-open'))");
    await click(ALBUM_CARD);
    await waitFor("Boolean(document.querySelector('.album-fullscreen-theater'))");
    await clickText('.detail-header .ui-segmented button', "网格");
    await waitFor("document.querySelectorAll('.album-fullscreen-theater .work-tile-image').length === 3");
    checks.push({ name: "default-album-after-home-loads-all-three-legacy-pages" });
    await key("Escape");
    await cdp.evaluate("(async () => window.sanctuary.updateLibraryPreferences({ ...(await window.sanctuary.getLibraryPreferences()), defaultView: 'author-work' }))()");
    await cdp.send("Page.reload");
    await click('[data-nav="gallery"]');
    await waitFor("document.querySelectorAll('.author-gallery .directory-card-open').length === 1");
    checks.push({ name: "default-artist-after-home-loads-legacy-pages" });

    await clickText('.gallery-scope button', "作品");
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    await click(OPEN);
    await imageReady();
    await menu('[aria-label="更多工具"]', "元素与提示词");
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
    await menu('[aria-label="更多工具"]', "元素与提示词");
    await waitFor("document.querySelector('.inspector-tag-name')?.textContent === 'fixture_page_0'");
    await main.evaluate("globalThis.__viewerInspect.pending[6].resolve(globalThis.__viewerInspect.response(2))");
    await cdp.evaluate("new Promise(done => setTimeout(done, 100))");
    assert.equal(await cdp.evaluate("document.querySelector('.inspector-tag-name')?.textContent"), "fixture_page_0", "closed drawer request leaked into a new target instance");
    await key("Escape");
    await key("Escape");
    await waitFor("!document.querySelector('.cinema-lightbox-theater')");
    checks.push({ name: "inspector-out-of-order-result-error-loading-current-page-retry-and-unmount" });

    await cdp.evaluate("(() => { const button = document.querySelector('.work-tile-favorite'); button.click(); button.click(); })()");
    await waitFor("document.querySelector('.work-tile-favorite')?.hasAttribute('data-active') && !document.querySelector('.work-tile-favorite')?.disabled");
    await waitFor("document.querySelector('.ui-toast-region .app-notice')?.textContent.includes('已喜欢')");
    await clickText(".ui-toast-region .app-notice button", "撤销");
    await waitFor("!document.querySelector('.work-tile-favorite')?.hasAttribute('data-active') && !document.querySelector('.ui-toast-region .app-notice')");
    await click('[aria-label="选择作品"]');
    await click(OPEN);
    await waitFor("document.querySelector('[data-work-tile]').hasAttribute('data-selected')");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), false, "stable card callbacks used stale selection mode");
    await click('[aria-label="完成选择"]');
    checks.push({ name: "memoized-card-favorite-undo-and-current-selection-mode" });

    await cdp.evaluate("window.sanctuary.updateWorkFavorite(['pixiv:123456789'], true)");
    await setPreset('喜欢');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1 && document.querySelector('.work-tile-favorite').hasAttribute('data-active')");
    await nameSearch();
    await changeControl(SEARCH, '不可能匹配的测试标题');
    await waitFor("document.querySelector('.gallery-empty h2')?.textContent === '当前条件下没有喜欢的作品'");
    await changeControl(SEARCH, '我的三页');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    await setType('本地导入');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 0 && Boolean(document.querySelector('.gallery-empty'))");
    await setType('全部类型');
    await clickText('.gallery-scope button', '相册');
    await click('section[aria-label=相册] .directory-card-more');
    await clickText('.ui-popover [role^="menuitem"]', '在作品中筛选');
    await waitFor("[...document.querySelectorAll('.work-filter-chips .ui-chip')].some(c=>c.textContent.startsWith('相册：')) && document.querySelectorAll('[data-work-tile]').length === 1");
    assert.equal(await activePreset(), '全部');
    assert.equal(await cdp.evaluate("document.querySelector('.gallery-search-field input').value"), '', 'directory entry inherited unrelated old search');
    await click('.work-filter-chips [aria-label^="移除筛选 相册"]');
    await waitFor("!document.querySelector('.work-filter-chips') && ![...document.querySelectorAll('.work-filter-chips .ui-chip')].some(c=>/^(喜欢|最近浏览|未分相册)/.test(c.textContent))");
    assert.equal(await cdp.evaluate("document.querySelector('.gallery-search-field input').value"), '', "return all retained a stale search");
    await changeControl(SEARCH, '');
    await cdp.evaluate("window.sanctuary.updateWorkFavorite(['pixiv:123456789'], false)");
    await setPreset('最近浏览');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    assert.match(await sortLabel(), /浏览时间/);
    assert.equal(await sortDisabled(), true);
    await screenshot('recent-reading-gallery');
    await setPreset('全部作品');
    checks.push({ name: "favorite-recent-uncollected-compose-with-search-type-and-directory-entry-clears-unrelated-scope" });

    await click(OPEN);
    await imageReady();
    await key('End');
    await waitFor("document.querySelector('.cinema-heading-group small')?.textContent.includes('第 3/3 页')");
    await imageReady();
    // Close before the 500 ms coalescing interval: the last displayed page must still be flushed.
    await key('Escape');
    await waitForProgress(2);
    await click(OPEN);
    await imageReady();
    assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 3/3 页')"), true, 'work cover did not resume its last successful page');
    await screenshot('continued-third-page');
    await key('Escape');

    const workBeforeFailure = await cdp.evaluate("window.sanctuary.getWork('pixiv:123456789')");
    const failureAsset = workBeforeFailure.assets[1];
    const fixtureDb = new DatabaseSync(join(userData, 'library.db'));
    fixtureDb.prepare('UPDATE assets SET path = ? WHERE id = ?').run(join(userData, 'missing-original.png'), failureAsset.id);
    fixtureDb.close();
    await main.evaluate(`(() => { const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain; const channel = 'library:record-work-view'; const original = ipc._invokeHandlers.get(channel); globalThis.__viewerReading = { original, requests: [] }; ipc.removeHandler(channel); ipc.handle(channel, (event, request) => { globalThis.__viewerReading.requests.push(request); return original(event, request); }); })()`);
    try {
      await click(OPEN);
      await imageReady();
      await key('ArrowLeft');
      await waitFor("Boolean(document.querySelector('.cinema-load-error'))");
      await key('Escape');
      await waitForProgress(2);
      const writes = await main.evaluate('globalThis.__viewerReading.requests');
      assert.equal(writes.some(request => request.assetId === failureAsset.id), false, 'failed original was recorded as a read page');
      checks.push({ name: 'failed-original-never-recorded-as-reading-progress', writes: writes.length });
    } finally {
      const restoring = new DatabaseSync(join(userData, 'library.db'));
      restoring.prepare('UPDATE assets SET path = ? WHERE id = ?').run(failureAsset.path, failureAsset.id);
      restoring.close();
      await main.evaluate("(() => { const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain; ipc.removeHandler('library:record-work-view'); ipc.handle('library:record-work-view', globalThis.__viewerReading.original); delete globalThis.__viewerReading; })()");
    }

    await clickText('.gallery-scope button', '相册');
    await click(ALBUM_CARD);
    await clickText('.detail-header .ui-segmented button', '网格');
    await main.evaluate("(() => { const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain; const channel = 'library:get-work'; const original = ipc._invokeHandlers.get(channel); globalThis.__viewerMapping = { original, pending: [] }; ipc.removeHandler(channel); ipc.handle(channel, (event, request) => new Promise(resolve => globalThis.__viewerMapping.pending.push({ result: original(event, request), resolve }))); })()");
    try {
      await click(ALBUM_TILE);
      await waitForMain('globalThis.__viewerMapping.pending.length === 1');
      await waitFor("document.querySelector('.app-notice--info')?.textContent.includes('正在读取作品')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), false, 'viewer opened before canonical assets were available');
      await key('Escape');
      await waitFor("!document.querySelector('.app-notice--info')");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.album-fullscreen-theater'))"), true, 'canceling a pending work exited the album');
      await main.evaluate('globalThis.__viewerMapping.pending[0].resolve(globalThis.__viewerMapping.pending[0].result)');
      await cdp.evaluate("new Promise(done => setTimeout(done, 100))");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater'))"), false, 'canceled late work reopened its viewer');
      await click(ALBUM_TILE);
      await waitForMain('globalThis.__viewerMapping.pending.length === 2');
      await main.evaluate('globalThis.__viewerMapping.pending[1].resolve(globalThis.__viewerMapping.pending[1].result)');
      await imageReady();
      assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"), true, 'explicit album page was overwritten by saved reading progress');
      await key('Escape');
      await waitFor("!document.querySelector('.cinema-lightbox-theater')");
    } finally {
      await main.evaluate("(() => { const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain; ipc.removeHandler('library:get-work'); ipc.handle('library:get-work', globalThis.__viewerMapping.original); delete globalThis.__viewerMapping; })()");
    }
    await waitForProgress(0);
    await key('Escape');
    await clickText('.gallery-scope button', '作品');
    await click(OPEN);
    await imageReady();
    assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 1/3 页')"), true, 'album entry did not save its canonical asset progress');
    await key('End');
    await waitFor("document.querySelector('.cinema-heading-group small')?.textContent.includes('第 3/3 页')");
    await imageReady();
    await key('Escape');
    await waitForProgress(2);
    await cdp.evaluate("(async () => window.sanctuary.updateLibraryPreferences({ ...(await window.sanctuary.getLibraryPreferences()), defaultView: 'flat' }))()");
    checks.push({ name: 'cover-resumes-explicit-album-page-flushes-on-close-and-canceled-canonical-read-never-reopens' });

    await cdp.evaluate("(() => { window.__viewerUnhandled = 0; window.addEventListener('unhandledrejection', () => window.__viewerUnhandled++); })()");
    // Take the work out of the album, then make the next real assignment fail once in the main process.
    await cdp.evaluate("window.sanctuary.removeWorkFromCollection('pixiv:123456789','viewer-album')");
    await click('[data-nav="settings"]'); await click('[data-nav="gallery"]'); await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    await main.evaluate(`(() => {
      const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
      const original=ipc._invokeHandlers.get('collections:add-work');ipc.removeHandler('collections:add-work');
      ipc.handle('collections:add-work',()=>{ipc.removeHandler('collections:add-work');ipc.handle('collections:add-work',original);throw new Error('隔离入册失败')});return true;
    })()`);
    await contextMenu(OPEN);
    await clickText('.ui-popover [role^="menuitem"]', '加入相册');
    await clickText('.ui-popover [role^="menuitem"]', '查看器测试相册');
    await waitFor("Boolean(document.querySelector('.app-notice--error')) && !document.querySelector('.work-tile-favorite').disabled");
    assert.equal(await cdp.evaluate("window.__viewerUnhandled"), 0, "card mutation produced an unhandled rejection");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.ui-toast-region .app-notice'))"), false, "failed assignment claimed success");
    checks.push({ name: "failed-card-assignment-surfaces-error-and-releases-busy-without-success-or-rejection" });

    await nameSearch();
    await changeControl(SEARCH, '我的三页');
    await setType('插画');
    await menu('[aria-label^="排序："]', '标题');
    await openSavedFilters();
    await waitFor("Boolean(document.querySelector('.saved-work-filters-dialog input'))");
    await changeControl('[aria-label="筛选名称"]', '三页参考');
    await clickText('.saved-work-filters-dialog button', '保存筛选');
    await waitFor("document.querySelectorAll('[data-filter-apply]').length === 1");
    assert.equal(await cdp.evaluate("document.querySelector('.saved-work-filter-list').textContent.includes('搜索“我的三页” · 插画')"), true);
    const savedBounds = await cdp.evaluate("(()=>{const n=document.querySelector('.saved-work-filters-dialog'),r=n.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:n.scrollWidth-n.clientWidth};})()");
    assert.ok(savedBounds.left >= 0 && savedBounds.right <= savedBounds.width && savedBounds.bottom <= savedBounds.height && savedBounds.overflow <= 2);
    await screenshot('saved-work-filter-900');
    await key('Escape');
    await changeControl(SEARCH, '');
    await setType('全部类型');

    // Restart the actual Electron process, keeping only this disposable SQLite library.
    cdp.close();
    main.close();
    child.kill();
    await new Promise((done) => { if (child.exitCode !== null) done(); else child.once('exit', done); });
    child = startElectron();
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    main = await connectElectronMainInspector(mainPort);
    await showElectronTestWindow(main);
    const restartedTarget = await waitForRenderer();
    cdp = await connectCdp(restartedTarget.webSocketDebuggerUrl);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
    await click('[data-nav="gallery"]');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    await click(OPEN);
    await imageReady();
    assert.equal(await cdp.evaluate("document.querySelector('.cinema-heading-group small').textContent.includes('第 3/3 页')"), true, 'reading progress did not survive an Electron restart');
    assert.match(await cdp.evaluate("document.querySelector('.cinema-heading-group strong').textContent"),/^我的三页收藏/,'gallery name did not survive restart');
    checks.push({name:'gallery-display-name-survives-real-electron-restart'});
    await key('Escape');
    await waitForProgress(2);
    await setPreset('最近浏览');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    checks.push({ name: 'successful-reading-page-and-recent-history-survive-real-electron-restart' });
    await openSavedFilters();
    await waitFor("document.querySelectorAll('[data-filter-apply]').length === 1");
    await click('[data-filter-apply]');
    await waitFor("document.querySelector('.gallery-search-field input')?.value === '我的三页'");
    assert.equal(await hasChip('插画'), true);
    assert.match(await sortLabel(), /标题/);
    assert.equal(await activePreset(), '全部');
    await openSavedFilters();
    await click('[aria-label="删除筛选 三页参考"]');
    await waitFor("document.querySelectorAll('[data-filter-apply]').length === 0");
    assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.queryWorks({})).total)()"), 1);
    await key('Escape');
    checks.push({name:'saved-filter-create-restart-replace-conditions-and-delete-without-removing-works'});
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
  await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
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
