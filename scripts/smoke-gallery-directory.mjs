import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { showElectronTestWindow } from "./electron-smoke-support.mjs";

// Workspace runtime packages are normally resolved by Vite's aliases, not npm links.
const domainHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@sanctuary/domain"
      ? new URL("../packages/domain/dist/index.js", import.meta.url).href : specifier, context);
  }
});
let LibraryDatabase;
try { ({ LibraryDatabase } = await import("../packages/database/dist/index.js")); }
finally { domainHooks.deregister(); }

// Run after the production build. Benchmark works declare one page each but contain
// no assets; 70 tiny real image pages separately cover scopes/selection/local protocol.
const temporaryRoot = resolve(tmpdir());
const screenshots = resolve(".tmp/gallery-directory-smoke");
await mkdir(screenshots, { recursive: true });
const results = [];
for (const metadataWorks of [10_000, 50_000]) results.push(await runFixture(metadataWorks));
console.log(JSON.stringify({ status: "passed", results, screenshots }, null, 2));

async function runFixture(metadataWorks) {
  const userData = await mkdtemp(join(temporaryRoot, "sanctuary-gallery-directory-"));
  let child;
  let main;
  let cdp;
  let stderr = "";
  try {
    const fixture = await seedFixture(userData, metadataWorks);
    const port = await availablePort();
    const mainPort = await availablePort();
    // Electron initializes its SDK normally, then this disposable bootstrap installs
    // the spy before importing the unchanged production main module.
    const bootstrapPath = join(userData, "directory-bootstrap.cjs");
    await writeFile(bootstrapPath, `(() => {
      const ipc = require('electron').ipcMain;
      const watched = new Set(['library:list', 'collections:summaries', 'artists:summaries',
        'saved-collection-views:summaries', 'library:scoped-artworks', 'library:get-work', 'library:query-artwork-pages', 'collections:add-artworks']);
      const state = globalThis.__directorySmoke = {
        originalHandle: ipc.handle, originals: new Map(), counts: {}, scopes: [], works: [], pages: [],
        bulkSizes: [], bulkWrites: 0, failPickerOnce: false, failBulkOnce: false,
        maxSavedRows: 0, maxSavedPreview: 0, maxArtistPreview: 0
      };
      ipc.handle = function(channel, handler) {
        if (!watched.has(channel)) return state.originalHandle.call(this, channel, handler);
        state.originals.set(channel, handler);
        return state.originalHandle.call(this, channel, async (...args) => {
          state.counts[channel] = (state.counts[channel] ?? 0) + 1;
          if (channel === 'library:query-artwork-pages' && state.failPickerOnce) {
            state.failPickerOnce = false; throw new Error('隔离夹具读取失败');
          }
          if (channel === 'collections:add-artworks') {
            state.bulkSizes.push(args[1].length);
            if (state.failBulkOnce) { state.failBulkOnce = false; throw new Error('隔离夹具加入失败'); }
          }
          const result = await handler(...args);
          if (channel === 'library:scoped-artworks') state.scopes.push({ scope: args[1], size: result.length });
          if (channel === 'library:get-work') state.works.push({ workId: args[1], size: result?.assets.length ?? 0 });
          if (channel === 'library:query-artwork-pages') state.pages.push({ limit: args[1]?.limit, offset: args[1]?.offset, size: result.items.length });
          if (channel === 'collections:add-artworks') state.bulkWrites += 1;
          if (channel === 'artists:summaries') state.maxArtistPreview = Math.max(state.maxArtistPreview, 0, ...result.map(item => item.previewAssets.length));
          if (channel === 'saved-collection-views:summaries') {
            state.maxSavedRows = Math.max(state.maxSavedRows, result.items.length);
            state.maxSavedPreview = Math.max(state.maxSavedPreview, 0, ...result.items.map(item => item.previewAssets.length));
          }
          return result;
        });
      };
    })();
    void import(${JSON.stringify(pathToFileURL(resolve("apps/desktop/out/main/index.js")).href)}).catch(error => {
      console.error(error); require('electron').app.exit(1);
    });
    `, "utf8");
    child = spawn(resolve("node_modules/electron/dist/electron.exe"),
      [`--inspect=127.0.0.1:${mainPort}`, bootstrapPath,
        `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`,
        "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
      { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const mainTarget = await waitForTarget(mainPort, (entry) => entry.type === "node");
    main = await connectCdp(mainTarget.webSocketDebuggerUrl);
    await showElectronTestWindow(main, 30_000);
    const target = await waitForTarget(port, (entry) => entry.type === "page" && entry.url?.replaceAll("\\", "/").includes("/renderer/index.html"));
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
    const checks = [];
    async function waitFor(expression, page = cdp) {
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        if (await page.evaluate(expression)) return;
        await new Promise(done => setTimeout(done, 60));
      }
      throw new Error(`Timed out: ${expression}`);
    }
    async function click(selector) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      assert.equal(await cdp.evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (button.disabled) return false; button.click(); return true; })()`), true, `Disabled control: ${selector}`);
    }
    async function clickText(selector, text) {
      await cdp.evaluate(`(() => { const node=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>el.textContent.includes(${JSON.stringify(text)})); const menu=node?.closest(".browse-mode-menu,.photobook-display-options"); if(menu && !menu.open) menu.querySelector("summary").click(); })()`);
      await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(el => el.textContent.includes(${JSON.stringify(text)}) && !el.disabled)`);
      await cdp.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.includes(${JSON.stringify(text)}) && !el.disabled).click()`);
    }
    async function fill(selector, text) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await cdp.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }
    async function key(key) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
    }

    await waitFor("document.querySelectorAll('.album-card-book').length === 3");
    await waitFor("document.querySelectorAll('.saved-view-card').length === 12");
    const firstReadyMs = await cdp.evaluate("Math.round(performance.now())");
    const summaries = await cdp.evaluate("(async () => (await window.sanctuary.listCollectionSummaries()).map(item => ({ id:item.id,workCount:item.workCount,pageCount:item.pageCount,bookPageCount:item.bookPageCount,coverCount:item.coverAsset ? 1 : 0 })))()");
    const metadataAlbum = summaries.find(item => item.id === fixture.metadataAlbumId);
    const partialAlbum = summaries.find(item => item.id === fixture.partialAlbumId);
    assert.equal(metadataAlbum.workCount, metadataWorks / 2);
    assert.equal(metadataAlbum.pageCount, metadataWorks / 2);
    assert.equal(metadataAlbum.bookPageCount, 0);
    assert.equal(partialAlbum.workCount, 1);
    assert.equal(partialAlbum.pageCount, 3);
    assert.equal(partialAlbum.bookPageCount, 1);
    assert.ok(summaries.every(item => item.coverCount <= 1));
    const saved = await cdp.evaluate("(async () => { const first=await window.sanctuary.querySavedViewSummaries({offset:0,limit:12}); const next=await window.sanctuary.querySavedViewSummaries({offset:12,limit:12}); return { firstSize:first.items.length,nextSize:next.items.length,total:first.total,counts:first.items.map(item=>item.workCount),previews:first.items.map(item=>item.previewAssets.length) }; })()");
    assert.deepEqual([saved.firstSize, saved.nextSize, saved.total], [12, 3, 15]);
    assert.ok(saved.counts.every(count => count === metadataWorks / 2));
    assert.ok(saved.previews.every(count => count <= 4));
    assert.equal(await cdp.evaluate("document.querySelectorAll('.saved-view-card').length"), 12);
    await clickText(".saved-views-section button", "继续加载组合视图");
    await waitFor("document.querySelectorAll('.saved-view-card').length === 15");
    checks.push("collection-work-vs-book-page-counts-and-bounded-saved-view-previews");

    await clickText('[aria-label="画廊布局"] button', "画师");
    await waitFor("document.querySelectorAll('.author-browser-card').length === 253");
    const artists = await cdp.evaluate("(async () => (await window.sanctuary.listArtistSummaries()).map(item=>({artistId:item.artistId,workCount:item.workCount,pageCount:item.pageCount,previewCount:item.previewAssets.length})))()");
    assert.equal(artists.reduce((sum, item) => sum + item.workCount, 0), metadataWorks + 68);
    assert.equal(artists.reduce((sum, item) => sum + item.pageCount, 0), metadataWorks + 70);
    assert.ok(artists.every(item => item.previewCount <= 3));
    assert.ok(await cdp.evaluate("document.querySelectorAll('.author-browser-card img').length <= 3 * 253"));
    await clickText(".author-browser-card", "待补充作者信息");
    await waitFor("Boolean(document.querySelector('.author-detail-page'))");
    await waitFor("document.querySelectorAll('.author-detail-page .art-card').length === 2");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.author-detail-page .work-group').length"), 2, "numeric local filenames merged unrelated works");
    const unknownScope = await main.evaluate("__directorySmoke.scopes.findLast(item => item.scope.kind === 'artist' && item.scope.artistId === null)");
    assert.equal(unknownScope.size, 2);
    await click(".author-detail-page .art-preview-button");
    await waitFor("Boolean(document.querySelector('.cinema-lightbox-theater')) && document.querySelector('.cinema-image-entity')?.naturalWidth > 0");
    assert.equal(await cdp.evaluate("document.querySelectorAll('.filmstrip-thumb-btn').length"), 0, "single-page work offered a fabricated filmstrip");
    const localWork = await main.evaluate("__directorySmoke.works.findLast(item => item.workId.startsWith('local:'))");
    assert.equal(localWork.size, 1, "a numeric local filename resolved another local work's pages");
    await key("Escape");
    await waitFor("!document.querySelector('.cinema-lightbox-theater')");
    await click(".author-back-btn");
    await waitFor("document.querySelectorAll('.author-browser-card').length === 253");
    checks.push("artist-summary-counts-bounded-previews-and-unattributed-scope");

    await clickText('[aria-label="画廊布局"] button', "相册");
    await waitFor("document.querySelectorAll('.album-card-book').length === 3");
    await clickText(".album-card-book", "只收录第一页");
    await waitFor("Boolean(document.querySelector('.album-fullscreen-theater'))");
    await clickText('[aria-label="画册模式"] button', "典藏网格");
    await waitFor("document.querySelectorAll('.collection-detail-grid .art-card').length === 1");
    const albumScope = await main.evaluate(`__directorySmoke.scopes.findLast(item => item.scope.kind === 'collection' && item.scope.collectionId === ${JSON.stringify(fixture.partialAlbumId)})`);
    assert.equal(albumScope.size, 1, "album scope expanded a partially included work to every page");
    await click(".collection-detail-grid .art-preview-button");
    await waitFor("document.querySelectorAll('.filmstrip-thumb-btn').length === 3");
    await waitFor("document.querySelector('.cinema-image-entity')?.complete && document.querySelector('.cinema-image-entity')?.naturalWidth > 0");
    await click(".filmstrip-thumb-btn:nth-child(2)");
    await waitFor("document.querySelector('.filmstrip-thumb-btn:nth-child(2)')?.classList.contains('active') && document.querySelector('.cinema-image-entity')?.complete && document.querySelector('.cinema-image-entity')?.naturalWidth > 0");
    const fullWork = await main.evaluate(`__directorySmoke.works.findLast(item => item.workId === ${JSON.stringify(fixture.workId)})`);
    assert.equal(fullWork.size, 3, "lightbox did not resolve the whole work from the partial album");
    await key("Escape");
    await waitFor("!document.querySelector('.cinema-lightbox-theater')");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.album-fullscreen-theater'))"), true);
    assert.equal(await cdp.evaluate(`(async () => (await window.sanctuary.listCollectionSummaries()).find(item=>item.id===${JSON.stringify(fixture.partialAlbumId)}).bookPageCount)()`), 1, "viewing an uncollected page changed album membership");
    await waitFor("document.querySelectorAll('.collection-detail-grid .art-card').length === 1");
    checks.push("partial-album-retains-one-page-and-lightbox-loads-all-work-pages");

    await clickText(".theater-action-pill", "添加画作");
    await waitFor("document.querySelectorAll('.paged-picker-artwork').length === 60");
    await fill('[aria-label="搜索未入册画作"]', "待挑选");
    await waitFor("document.querySelector('.paged-picker-status')?.textContent.includes('共 65 张') && document.querySelectorAll('.paged-picker-artwork').length === 60");
    await clickText(".paged-picker-toolbar button", "全选当前页");
    await waitFor("document.querySelector('.paged-picker-footer strong')?.textContent === '已选择 60 张'");
    await main.evaluate("__directorySmoke.failPickerOnce=true");
    await clickText(".paged-picker-pagination button", "下一页");
    await waitFor("document.querySelector('.paged-picker-grid')?.textContent.includes('隔离夹具读取失败')");
    assert.equal(await cdp.evaluate("document.querySelector('.paged-picker-footer strong').textContent"), "已选择 60 张");
    await clickText(".paged-picker-grid button", "重试读取");
    await waitFor("document.querySelectorAll('.paged-picker-artwork').length === 5");
    await clickText(".paged-picker-toolbar button", "全选当前页");
    await waitFor("document.querySelector('.paged-picker-footer strong')?.textContent === '已选择 65 张'");
    await clickText(".paged-picker-pagination button", "上一页");
    await waitFor("document.querySelectorAll('.paged-picker-artwork[aria-pressed=true]').length === 60");
    const imeEscape = await cdp.evaluate(`(() => {
      const input=document.querySelector('[aria-label="搜索未入册画作"]');
      input.focus();
      return [{isComposing:true}, {keyCode:229}].map(mode => {
        const event=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true,...mode});
        input.dispatchEvent(event);
        return { defaultPrevented:event.defaultPrevented, open:!!document.querySelector('.paged-artwork-picker'),
          selected:document.querySelector('.paged-picker-footer strong')?.textContent };
      });
    })()`);
    assert.ok(imeEscape.every(event => !event.defaultPrevented && event.open && event.selected === '已选择 65 张'), "IME candidate Escape closed the picker or lost cross-page selection");
    checks.push("picker-IME-escape-keeps-native-candidate-cancellation-and-cross-page-selection");
    const pickerLayout = await cdp.evaluate("(() => { const dialog=document.querySelector('.paged-artwork-picker'); const rect=dialog.getBoundingClientRect(); return {width:rect.width,right:rect.right,bottom:rect.bottom,overflow:dialog.scrollWidth-dialog.clientWidth,gridOverflow:document.querySelector('.paged-picker-grid').scrollWidth-document.querySelector('.paged-picker-grid').clientWidth}; })()");
    assert.ok(pickerLayout.right <= 902 && pickerLayout.bottom <= 622 && pickerLayout.overflow <= 2 && pickerLayout.gridOverflow <= 2, `picker overflow: ${JSON.stringify(pickerLayout)}`);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(screenshots, `picker-${metadataWorks}-900.png`), Buffer.from(shot.data, "base64"));
    await main.evaluate("__directorySmoke.failBulkOnce=true");
    await clickText(".paged-picker-actions button", "确认加入");
    await waitFor("document.querySelector('.paged-picker-footer [role=alert]')?.textContent.includes('隔离夹具加入失败')");
    assert.equal(await cdp.evaluate("document.querySelector('.paged-picker-footer strong').textContent"), "已选择 65 张");
    await clickText(".paged-picker-actions button", "确认加入");
    await waitFor("!document.querySelector('.paged-artwork-picker')");
    await waitFor("document.querySelectorAll('.collection-detail-grid .art-card').length === 66");
    checks.push("bounded-picker-cross-page-selection-read-and-bulk-retries-and-scope-refresh");

    const updated = await cdp.evaluate(`(async () => { const summaries=await window.sanctuary.listCollectionSummaries(); const album=summaries.find(item=>item.id===${JSON.stringify(fixture.partialAlbumId)}); return {workCount:album.workCount,pageCount:album.pageCount,bookPageCount:album.bookPageCount}; })()`);
    assert.deepEqual(updated, { workCount: 66, pageCount: 68, bookPageCount: 66 });
    assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.listAnalysisJobs()).length)()"), 0, "browsing or album membership started analysis");
    const stats = await main.evaluate("(() => { const state=__directorySmoke; return {listCalls:state.counts['library:list']??0,scopes:state.scopes,works:state.works,pages:state.pages,bulkSizes:state.bulkSizes,bulkWrites:state.bulkWrites,maxSavedRows:state.maxSavedRows,maxSavedPreview:state.maxSavedPreview,maxArtistPreview:state.maxArtistPreview}; })()");
    assert.equal(stats.listCalls, 0, "directory navigation or assignment read the full legacy library");
    assert.ok(stats.pages.every(page => page.limit <= 200 && page.size <= page.limit));
    assert.ok(stats.maxSavedRows <= 12 && stats.maxSavedPreview <= 4 && stats.maxArtistPreview <= 3);
    assert.deepEqual(stats.bulkSizes, [65, 65]);
    assert.equal(stats.bulkWrites, 1, "bulk selection invoked more than one real write transaction");
    const heapMb = await cdp.evaluate("performance.memory?.usedJSHeapSize ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null");
    return { metadataWorks, declaredMetadataPages: metadataWorks, metadataAssets: 0,
      realImagePages: 70, firstReadyMs, heapMb, checks, ...stats, pickerLayout };
  } catch (error) {
    if (stderr.trim()) console.error(stderr.trim());
    throw error;
  } finally {
    if (main) {
      try {
        await main.evaluate(`(() => {
          const state=globalThis.__directorySmoke;
          if (!state) return true;
          const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
          ipc.handle=state.originalHandle;
          for (const [channel, handler] of state.originals) { ipc.removeHandler(channel); ipc.handle(channel, handler); }
          delete globalThis.__directorySmoke;
          return true;
        })()`);
      } catch {}
    }
    cdp?.close(); main?.close(); child?.kill();
    if (child && child.exitCode === null) await new Promise(done => { child.once("exit", done); setTimeout(done, 2000); });
    const directory = resolve(userData);
    if (!directory.startsWith(`${temporaryRoot}${sep}sanctuary-gallery-directory-`)) throw new Error("Unexpected smoke temporary directory");
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

async function seedFixture(userData, metadataWorks) {
  const databasePath = join(userData, "library.db");
  const library = new LibraryDatabase(databasePath);
  library.seedBenchmarkWorks(metadataWorks);
  const metadataAlbum = library.createCollection("元数据压力相册");
  const partialAlbum = library.createCollection("只收录第一页");
  library.createCollection("空相册");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  let firstArtworkId;
  try {
    for (let index = 0; index < 3; index++) {
      const path = join(userData, `123456789_p${index}.png`);
      await writeFile(path, png);
      const artwork = library.importArtwork(path);
      library.saveArtworkSource(artwork.id, { platform: "pixiv", workId: "123456789", pageIndex: index, authorId: "30001", authorName: "完整套图画师", title: "完整三页作品" });
      library.trustArtwork(artwork.id);
      if (!index) { firstArtworkId = artwork.id; library.addArtworkToCollection(artwork.id, partialAlbum.id); }
    }
    for (let index = 0; index < 2; index++) {
      const path = join(userData, `987654321_p${index}.png`);
      await writeFile(path, png);
      const artwork = library.importArtwork(path); library.trustArtwork(artwork.id);
    }
    for (let index = 0; index < 65; index++) {
      const path = join(userData, `${200000000 + index}_p0.png`);
      await writeFile(path, png);
      const artwork = library.importArtwork(path);
      library.saveArtworkSource(artwork.id, { platform: "pixiv", workId: String(200000000 + index), pageIndex: 0, authorId: "30003", authorName: "挑选测试画师", title: `待挑选 ${String(index).padStart(2, "0")}` });
      library.trustArtwork(artwork.id);
    }
    for (let index = 0; index < 15; index++) library.createSavedCollectionView({ name: `压力组合 ${index}`, matchMode: "all", includedCollectionIds: [metadataAlbum.id], excludedCollectionIds: [] });
  } finally { library.close(); }
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare("INSERT INTO user_preferences(key,value_json,updated_at) VALUES('library.preferences',?,?)").run(JSON.stringify({ defaultView: "collections", defaultSortBy: "savedAt", defaultSortDirection: "desc", gridDensity: "comfortable", downloadDirectory: join(userData, "Storage", "Pixiv") }), new Date().toISOString());
    database.prepare("INSERT INTO collection_works(collection_id,work_id,added_at) SELECT ?,id,created_at FROM works WHERE id LIKE 'benchmark-work-%' AND CAST(SUBSTR(id,16) AS INTEGER)%2=0").run(metadataAlbum.id);
    database.prepare("UPDATE collections SET cover_artwork_id=?,cover_work_id='pixiv:123456789' WHERE id=?").run(firstArtworkId, partialAlbum.id);
  } finally { database.close(); }
  return { metadataAlbumId: metadataAlbum.id, partialAlbumId: partialAlbum.id, workId: "pixiv:123456789" };
}

async function availablePort() {
  const server = createServer();
  return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port=server.address().port; server.close(error => error ? reject(error) : done(port)); }); });
}
async function waitForTarget(port, predicate) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response=await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets=await response.json(); const target=targets.find(entry => entry.webSocketDebuggerUrl && predicate(entry));
      if (target) {
        const endpoint=new URL(target.webSocketDebuggerUrl);
        assert.ok(endpoint.hostname === "127.0.0.1" && Number(endpoint.port) === port, "debug endpoint left the isolated loopback port");
        return target;
      }
    } catch {}
    await new Promise(done => setTimeout(done, 80));
  }
  throw new Error("Isolated Electron debug target did not start");
}
async function connectCdp(url) {
  const socket = new WebSocket(url); const pending = new Map(); let nextId = 1;
  socket.addEventListener("message", event => {
    const message=JSON.parse(event.data); const request=pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once:true }); socket.addEventListener("error", reject, { once:true }); });
  const send=(method, params={}) => new Promise((done,reject) => {
    const id=nextId++; const timer=setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id,{resolve:done,reject,timer}); socket.send(JSON.stringify({id,method,params}));
  });
  return { send, close:() => socket.close(), evaluate:async expression => {
    const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  } };
}
