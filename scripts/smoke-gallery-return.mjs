import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Run with Node 24 after the production build. Vite normally supplies this alias.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "@sanctuary/domain"
    ? new URL("../packages/domain/dist/index.js", import.meta.url).href : specifier, context);
} });
let LibraryDatabase;
try { ({ LibraryDatabase } = await import("../packages/database/dist/index.js")); }
finally { hooks.deregister(); }

const temporaryRoot = resolve(tmpdir());
const userData = await mkdtemp(join(temporaryRoot, "sanctuary-gallery-return-"));
const screenshots = resolve(".tmp/gallery-return-smoke");
const checks = [];
let child, main, cdp;
let stderr = "", currentCheck = "fixture", currentWidth = 0, currentHeight = 0;
const detailSelector = { collection: ".album-fullscreen-theater", artist: ".author-detail-page" };
const modes = { collection: { flip: "翻页画册", grid: "典藏网格", toc: "篇目目录" },
  artist: { works: "套图展区", artbook: "翻页画集", catalog: "篇目编目" } };
const pause = (ms) => new Promise(done => setTimeout(done, ms));

try {
  await mkdir(screenshots, { recursive: true });
  const fixture = await seedFixture();
  const rendererPort = await availablePort(), mainPort = await availablePort();
  const bootstrap = join(userData, "return-bootstrap.cjs");
  await writeFile(bootstrap, `(() => {
    const ipc = require('electron').ipcMain;
    const state = globalThis.__galleryReturnSmoke = {
      originalHandle: ipc.handle, originals: new Map(), listCalls: 0, scopes: [],
      holdCollectionId: null, heldScope: null, releaseHeld: null
    };
    ipc.handle = function(channel, handler) {
      if (!['library:list', 'library:scoped-artworks'].includes(channel)) return state.originalHandle.call(this, channel, handler);
      state.originals.set(channel, handler);
      return state.originalHandle.call(this, channel, async (...args) => {
        if (channel === 'library:list') state.listCalls += 1;
        const hold = channel === 'library:scoped-artworks' && args[1]?.kind === 'collection'
          && args[1].collectionId === state.holdCollectionId;
        if (hold) state.holdCollectionId = null;
        const result = await handler(...args);
        if (channel === 'library:scoped-artworks') state.scopes.push({ scope: args[1], size: result.length });
        if (hold) {
          state.heldScope = args[1];
          await new Promise(done => { state.releaseHeld = () => { state.heldScope = null; state.releaseHeld = null; done(); }; });
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
    [`--inspect=127.0.0.1:${mainPort}`, bootstrap, `--remote-debugging-port=${rendererPort}`,
      `--user-data-dir=${userData}`, "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
    { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-24_000); });
  main = await connectElectronMainInspector(mainPort, 30_000);
  await showElectronTestWindow(main, 30_000);
  cdp = await connectCdp((await waitForTarget(rendererPort)).webSocketDebuggerUrl);
  // Exercise all four production animations independently of the host OS motion preference.
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await click('[data-nav="gallery"]');
  await waitFor("document.querySelectorAll('.album-card-book').length === 63");

  for (const width of [1280, 900]) {
    await resize(width);
    await directory("collection");
    await check("collection-directory-synchronous-scroll-capture", async () => {
      await directoryReturn("collection", fixture.albumName);
    });
    await check("collection-book-cross-settings-explore-inspiration", async () => {
      await mode("collection", "flip");
      await goToBookPage(14);
      await assertLayout("collection");
      const settled = await bookState();
      for (const label of ["典藏相角", "和纸手账", "画廊浮雕", "复古拍立得"]) {
        await clickText('.photobook-mount-switcher:not(.photobook-effect-switcher) button', label);
        await assertLayout("collection");
        await leaveAndReturn("settings", "collection", "flip");
        await assertBook(settled);
        assert.ok(await cdp.evaluate(`document.querySelector('.photobook-mount-switcher:not(.photobook-effect-switcher) button.active')?.textContent.includes(${JSON.stringify(label)})`));
      }
      for (const destination of ["settings", "explore", "inspiration"]) {
        await leaveAndReturn(destination, "collection", "flip");
        await assertBook(settled);
      }
      if (width === 900) {
        await scrollReturn(".theater-stage-canvas", "collection", "flip", "settings");
        await assertBook(settled);
      }
    });
    await check("collection-grid-and-catalog-scroll", async () => {
      await mode("collection", "grid");
      await scrollReturn(".theater-grid-scroll-box", "collection", "grid", "settings");
      await mode("collection", "toc");
      await scrollReturn(".theater-toc-scroll-box", "collection", "toc", "inspiration");
    });
    await check("collection-TOC-scroll-is-retained-without-reopening-drawer", async () => {
      await mode("collection", "flip");
      await click(".photobook-toc-trigger-btn");
      await waitFor("Boolean(document.querySelector('.toc-drawer-items-scroll'))");
      const before = await scrollAndCapture(".toc-drawer-items-scroll");
      await leaveAndReturn("settings", "collection", "flip");
      await assertOverlaysClosed();
      await click(".photobook-toc-trigger-btn");
      await assertScroll(".toc-drawer-items-scroll", before);
      await click(".toc-drawer-close-btn");
    });
    for (const [effect, label] of [["3d-flip", "3D 翻页"], ["slide", "平移动画"], ["fade", "柔光渐隐"], ["deck-stack", "层叠抽拉"]]) {
      await check(`leave-during-${effect}-restores-last-settled-spread`, async () => {
        await mode("collection", "flip");
        await clickText(".photobook-effect-switcher button", label);
        const settled = await bookState();
        // Observe the real animation before navigating, inside one renderer task.
        // No timer/animation mocking: the production leave handler captures the last settled page.
        const leftDuringAnimation = await cdp.evaluate(`(async () => {
          document.querySelector('.photobook-double-spread > .page-recto').click();
          for (let frame=0; frame<4; frame++) {
            await new Promise(done => requestAnimationFrame(done));
            if (document.querySelector('.photobook-double-spread')?.classList.contains('is-animating')) {
              document.querySelector('[data-nav="settings"]').click(); return true;
            }
          }
          return false;
        })()`);
        assert.equal(leftDuringAnimation, true, `${effect} did not enter a real animation`);
        await waitFor("document.querySelector('[data-nav=settings]')?.getAttribute('aria-current') === 'page'");
        await returnToDetail("collection", "flip");
        await assertBook(settled);
      });
    }
    if (width === 1280) for (const preference of [
      { profile: 'balanced', reduced: true, system: false },
      { profile: 'efficient', reduced: false, system: false },
      { profile: 'balanced', reduced: false, system: true }
    ]) {
      await check(`photobook-motion-policy-${preference.profile}-${preference.reduced}-${preference.system}`, async () => {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: preference.system ? 'reduce' : 'no-preference' }] });
        await cdp.evaluate(`for(const element of [document.querySelector('.app-shell'),document.body]) {
          element.dataset.displayProfile=${JSON.stringify(preference.profile)}; element.dataset.reducedMotion=${JSON.stringify(String(preference.reduced))};
        }`);
        for (const label of ['3D 翻页', '平移动画', '柔光渐隐', '层叠抽拉']) {
          await mode('collection', 'flip'); await clickText('.photobook-effect-switcher button', label);
          await goToBookPage(1);
          const before = await bookState();
          const result = await cdp.evaluate(`(async()=>{
            const started=performance.now(); document.querySelector('.photobook-double-spread > .page-recto').click();
            return new Promise(resolve => {
              const timeout=setTimeout(()=>resolve({settled:false}),350);
              const frame=()=>{
                if(Number(document.querySelector('.photobook-stage-deck').dataset.settledSpread)===${before.spread + 1}
                    && !document.querySelector('.photobook-double-spread.is-animating')) {
                  clearTimeout(timeout); resolve({settled:true,elapsed:performance.now()-started});
                } else requestAnimationFrame(frame);
              }; requestAnimationFrame(frame);
            });
          })()`);
          assert.equal(result.settled, true, `${label} relied on its 450–650 ms fallback timer under reduced motion`);
          assert.equal((await bookState()).spread, before.spread + 1);
        }
      });
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await cdp.evaluate("for(const element of [document.querySelector('.app-shell'),document.body]) { element.dataset.displayProfile='balanced'; element.dataset.reducedMotion='false'; }");
    await check("collection-lightbox-and-picker-remain-closed-on-return", async () => {
      await mode("collection", "grid");
      await click(".collection-detail-grid .art-preview-button");
      await waitFor("document.querySelector('.cinema-image-entity')?.naturalWidth > 0");
      await leaveAndReturn("inspiration", "collection", "grid");
      await assertOverlaysClosed();
      await clickText(".theater-action-pill", "添加画作");
      await waitFor("Boolean(document.querySelector('.paged-artwork-picker'))");
      await leaveAndReturn("settings", "collection", "grid");
      await assertOverlaysClosed();
    });
    await assertLayout("collection");
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(screenshots, `album-return-${width}.png`), Buffer.from(shot.data, "base64"));

    await directory("artist");
    await check("artist-directory-synchronous-scroll-capture", async () => {
      await directoryReturn("artist", fixture.authorName);
    });
    await check("artist-works-and-catalog-scroll", async () => {
      await mode("artist", "works");
      await scrollReturn(".app-shell > main", "artist", "works", "settings");
      await mode("artist", "catalog");
      await scrollReturn(".app-shell > main", "artist", "catalog", "explore");
    });
    await check("artist-book-and-TOC-position-with-closed-drawer", async () => {
      await mode("artist", "artbook");
      await goToBookPage(18);
      const settled = await bookState();
      await click(".photobook-toc-trigger-btn");
      const toc = await scrollAndCapture(".toc-drawer-items-scroll");
      await leaveAndReturn("inspiration", "artist", "artbook");
      await assertBook(settled);
      await assertOverlaysClosed();
      await click(".photobook-toc-trigger-btn");
      await assertScroll(".toc-drawer-items-scroll", toc);
      await click(".toc-drawer-close-btn");
    });
    await assertLayout("artist");
    const authorShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(screenshots, `artist-return-${width}.png`), Buffer.from(authorShot.data, "base64"));
  }

  await check("resize-away-restores-page-and-relative-grid-anchor", async () => {
    await directory("collection"); await openDetail("collection", fixture.albumName);
    await mode("collection", "grid");
    const before = await scrollAndCapture(".theater-grid-scroll-box");
    await leave("settings"); await resize(1280);
    await returnToDetail("collection", "grid");
    await assertScroll(".theater-grid-scroll-box", before, { resized: true });
    await mode("collection", "flip"); await goToBookPage(20);
    const settled = await bookState();
    await leave("explore"); await resize(900);
    await returnToDetail("collection", "flip"); await assertBook(settled);
  });
  await check("deleted-current-page-restores-surviving-neighbor", async () => {
    await mode("collection", "flip"); await goToBookPage(20);
    const previousPages = await scopePages({ kind: "collection", collectionId: fixture.albumId });
    const settled = await bookState();
    const index = previousPages.findIndex(page => page[settled.kind === "asset" ? "assetId" : "id"] === settled.pageId);
    assert.ok(index > 0, "deletion fixture must have a previous page");
    await leave("settings");
    // Simulate a page removed from the disposable library while detail is unmounted.
    // This mutates only the fixture DB; product IPC does not expose arbitrary SQL.
    removeFixturePages([previousPages[index].id]);
    const remaining = await scopePages({ kind: "collection", collectionId: fixture.albumId });
    const neighborIndex = remaining.findIndex(page => page.assetId === previousPages[index - 1].assetId);
    assert.ok(neighborIndex >= 0);
    const expectedSpread = spreadForPage(neighborIndex), firstIndex = firstPageForSpread(expectedSpread, remaining.length);
    await returnToDetail("collection", "flip");
    await assertBook({ spread: expectedSpread, pageId: remaining[firstIndex].assetId, kind: "asset", animating: false });
  });
  await check("deleted-anchor-and-neighbors-clamp-to-surviving-range", async () => {
    await directory("collection"); await openDetail("collection", fixture.smallAlbumName);
    await mode("collection", "flip"); await goToBookPage(5);
    const old = await scopePages({ kind: "collection", collectionId: fixture.smallAlbumId });
    const settled = await bookState();
    const index = old.findIndex(page => page.assetId === settled.pageId);
    assert.ok(index > 1);
    await leave("settings");
    removeFixturePages(old.slice(index - 1).map(page => page.id));
    const remaining = await scopePages({ kind: "collection", collectionId: fixture.smallAlbumId });
    assert.ok(remaining.length > 0 && remaining.length < index);
    const spread = spreadForPage(remaining.length - 1), first = firstPageForSpread(spread, remaining.length);
    await returnToDetail("collection", "flip");
    await assertBook({ spread, pageId: remaining[first].assetId, kind: "asset", animating: false });
  });
  await check("deleted-collection-returns-to-directory", async () => {
    await directory("collection"); await openDetail("collection", fixture.deleteAlbumName);
    await mode("collection", "grid");
    await leave("settings");
    await cdp.evaluate(`window.sanctuary.deleteCollection(${JSON.stringify(fixture.deleteAlbumId)})`);
    await click('[data-nav="gallery"]');
    await waitFor("!document.querySelector('.album-fullscreen-theater') && document.querySelectorAll('.album-card-book').length === 62");
    assert.equal(await cdp.evaluate(`Array.from(document.querySelectorAll('.collection-info h3')).some(node=>node.textContent===${JSON.stringify(fixture.deleteAlbumName)})`), false);
  });
  await check("same-ID-reappearing-after-deletion-starts-a-new-session", async () => {
    // Reintroduce only this fixture collection identity, so stale cache cannot hide
    // behind a different ID. Its earlier grid session must have been discarded.
    const database = new DatabaseSync(fixture.databasePath);
    try {
      database.prepare("INSERT INTO collections(id,name,created_at) VALUES(?,?,?)")
        .run(fixture.deleteAlbumId, fixture.deleteAlbumName, new Date().toISOString());
    } finally { database.close(); }
    await leave("settings"); await click('[data-nav="gallery"]');
    await waitFor("document.querySelectorAll('.album-card-book').length === 63");
    await openDetail("collection", fixture.deleteAlbumName);
    assert.equal(await cdp.evaluate("document.querySelector('.album-fullscreen-theater').dataset.detailMode"), "flip",
      "deleted collection kept its former detail session when the same ID reappeared");
  });
  await check("late-old-scope-response-cannot-restore-another-session", async () => {
    await directory("artist"); await openDetail("artist", fixture.secondAuthorName);
    await mode("artist", "catalog");
    await directory("collection"); await openDetail("collection", fixture.albumName);
    await mode("collection", "flip"); await leave("settings");
    await main.evaluate(`__galleryReturnSmoke.holdCollectionId=${JSON.stringify(fixture.albumId)}`);
    await click('[data-nav="gallery"]');
    await waitFor("Boolean(__galleryReturnSmoke.heldScope)", main);
    await directory("artist"); await openDetail("artist", fixture.secondAuthorName);
    await waitFor("document.querySelector('.author-detail-page')?.dataset.detailMode === 'catalog'");
    const title = await cdp.evaluate("document.querySelector('.author-atelier-name').textContent");
    await main.evaluate("__galleryReturnSmoke.releaseHeld()");
    await settledFrames();
    assert.equal(await cdp.evaluate("document.querySelector('.author-atelier-name')?.textContent"), title);
    assert.equal(await cdp.evaluate("document.querySelector('.author-detail-page')?.dataset.detailMode"), "catalog");
    const artistPages = await scopePages({ kind: "artist", artistId: fixture.secondAuthorId });
    assert.equal(await cdp.evaluate("document.querySelectorAll('.author-detail-page [data-gallery-page-id]').length"), artistPages.length);
    await leaveAndReturn("inspiration", "artist", "catalog");
    assert.equal(await cdp.evaluate("document.querySelector('.author-atelier-name')?.textContent"), title);
    await assertOverlaysClosed();
  });
  const stats = await main.evaluate("({listCalls:__galleryReturnSmoke.listCalls,scopeReads:__galleryReturnSmoke.scopes.length})");
  assert.equal(stats.listCalls, 0, "return navigation read the complete legacy library");
  assert.equal(await cdp.evaluate("(async()=> (await window.sanctuary.listAnalysisJobs()).length)()"), 0,
    "browsing trusted local pages started analysis");
  console.log(JSON.stringify({ status: "passed", realImagePages: 54, realWorks: 14,
    viewports: [{ width: 1280, height: 720 }, { width: 900, height: 620 }], checks, ...stats, screenshots }, null, 2));
} catch (error) {
  console.error(`Gallery return smoke failed: ${currentCheck} (content ${currentWidth}×${currentHeight})`);
  if (cdp) {
    try {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(join(screenshots, "failed.png"), Buffer.from(shot.data, "base64"));
    } catch {}
  }
  if (stderr.trim()) console.error(stderr.trim());
  throw error;
} finally {
  if (main) {
    try { await main.evaluate(`(() => {
      const state=globalThis.__galleryReturnSmoke; if (!state) return;
      state.releaseHeld?.();
      const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
      ipc.handle=state.originalHandle;
      for (const [channel, handler] of state.originals) { ipc.removeHandler(channel); ipc.handle(channel, handler); }
      delete globalThis.__galleryReturnSmoke;
    })()`); } catch {}
  }
  cdp?.close(); main?.close(); child?.kill();
  if (child && child.exitCode === null) await new Promise(done => {
    const timer=setTimeout(done, 2500); child.once("exit", () => { clearTimeout(timer); done(); });
  });
  const directory = resolve(userData);
  if (!directory.startsWith(`${temporaryRoot}${sep}sanctuary-gallery-return-`)) throw new Error("Unexpected smoke temporary directory");
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

async function check(name, action) {
  currentCheck = name;
  await action();
  checks.push({ name, width: currentWidth, height: currentHeight });
}
async function waitFor(expression, page = cdp) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (await page.evaluate(expression)) return;
    await pause(60);
  }
  throw new Error(`Timed out at ${currentCheck}: ${expression}`);
}
async function settledFrames() {
  await cdp.evaluate(`(async()=> {
    const stages=[...document.querySelectorAll('.app-shell,.app-shell > main,.album-fullscreen-theater,.author-detail-page,.photobook-toc-drawer')];
    await Promise.allSettled(stages.flatMap(stage=>stage.getAnimations()).filter(animation=>
      Number.isFinite(animation.effect.getComputedTiming().iterations)).map(animation=>animation.finished));
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  })()`);
}
async function resize(width) {
  currentWidth = width; currentHeight = width === 900 ? 620 : 720;
  await main.evaluate(`(() => {
    const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const window=electron.BrowserWindow.getAllWindows()[0]; window.setContentSize(${width}, ${currentHeight}); window.show(); window.focus();
  })()`);
  await waitFor(`innerWidth === ${width} && innerHeight === ${currentHeight}`);
  await settledFrames();
}
async function assertLayout(kind) {
  const layout = await cdp.evaluate(`(() => {
    const detail=document.querySelector(${JSON.stringify(detailSelector[kind])}),stage=document.querySelector('.photobook-stage-deck');
    const bounds=detail.getBoundingClientRect();
    const hud=document.querySelector('.theater-hud-header');
    const clippedControls=Array.from(detail.querySelectorAll('.theater-hud-header button,.author-back-btn,[aria-label="浏览视角"] button')).filter(node=>{
      const rect=node.getBoundingClientRect();return node.checkVisibility() && (rect.left<bounds.left-2 || rect.right>bounds.right+2);
    }).map(node=>node.textContent.trim());
    const wrappedLabels=Array.from(detail.querySelectorAll('.photobook-toc-trigger-btn .btn-text,.mount-pill-text,.theater-hud-center button')).filter(node=>{
      if(!node.checkVisibility()) return false;
      const range=document.createRange();range.selectNodeContents(node);
      const style=getComputedStyle(node),lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.6;
      return range.getBoundingClientRect().height>lineHeight*1.5;
    }).map(node=>node.textContent.trim());
    const smallTargets=innerWidth>900?[]:Array.from(detail.querySelectorAll('.photobook-toc-trigger-btn,.mount-style-pill,.theater-hud-header button')).filter(node=>{
      const rect=node.getBoundingClientRect();return node.checkVisibility() && (rect.height<35.5 || rect.width<35.5);
    }).map(node=>node.textContent.trim());
    return { width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      hudOverflow:hud?hud.scrollWidth-hud.clientWidth:0,clippedControls,wrappedLabels,smallTargets,stageOverflow:stage?stage.scrollWidth-stage.clientWidth:0 };
  })()`);
  // The blurred ambient backdrop deliberately extends beyond a clipped theater.
  // Measure the visible controls and stage rather than decorative paint overflow.
  assert.ok(layout.documentOverflow <= 2 && layout.hudOverflow <= 2 && layout.clippedControls.length === 0 && layout.wrappedLabels.length === 0 && layout.smallTargets.length === 0 && layout.stageOverflow <= 2,
    `detail overflow (${kind}): ${JSON.stringify(layout)}`);
}
async function click(selector) {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  assert.equal(await cdp.evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(node.disabled) return false; node.click(); return true; })()`), true, `Disabled control: ${selector}`);
}
async function clickText(selector, text) {
  const find = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.textContent.includes(${JSON.stringify(text)})&&!node.disabled)`;
  await waitFor(`Boolean(${find})`);
  await cdp.evaluate(`(() => { const node=${find}; const menu=node.closest(".browse-mode-menu,.photobook-display-options"); if(menu && !menu.open) menu.querySelector("summary").click(); })()`);
  await settledFrames();
  if(selector.includes('画册模式') || selector.includes('浏览视角')) await assertLayout(selector.includes('画册模式')?'collection':'artist');
  await cdp.evaluate(`(${find}).click()`);
}
async function directory(kind) {
  if (await cdp.evaluate("document.querySelector('[data-nav=gallery]')?.getAttribute('aria-current') !== 'page'")) await click('[data-nav="gallery"]');
  const back = kind === "collection" ? ".theater-game-back-btn" : ".author-back-btn";
  const anyBack = await cdp.evaluate("document.querySelector('.theater-game-back-btn,.author-back-btn')?.className");
  if (anyBack) await click(anyBack.includes("theater-game") ? ".theater-game-back-btn" : ".author-back-btn");
  await clickText('[aria-label="画廊布局"] button', kind === "collection" ? "相册" : "画师");
  await waitFor(`!document.querySelector(${JSON.stringify(back)}) && Boolean(document.querySelector(${JSON.stringify(kind === "collection" ? ".album-card-book" : ".author-browser-card")}))`);
  await settledFrames();
}
async function openDetail(kind, name) {
  await clickText(kind === "collection" ? ".album-card-book" : ".author-browser-card", name);
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(detailSelector[kind])}))`);
  await settledFrames();
}
async function mode(kind, value) {
  await clickText(kind === "collection" ? '[aria-label="画册模式"] button' : '[aria-label="浏览视角"] button', modes[kind][value]);
  await waitFor(`document.querySelector(${JSON.stringify(detailSelector[kind])})?.dataset.detailMode === ${JSON.stringify(value)}`);
  await settledFrames();
}
async function leave(destination) {
  await click(`[data-nav="${destination}"]`);
  await waitFor(`document.querySelector('[data-nav="${destination}"]')?.getAttribute('aria-current') === 'page' && !document.querySelector('.album-fullscreen-theater,.author-detail-page')`);
}
async function returnToDetail(kind, value) {
  await click('[data-nav="gallery"]');
  await waitFor(`document.querySelector(${JSON.stringify(detailSelector[kind])})?.dataset.detailMode === ${JSON.stringify(value)}`);
  await settledFrames();
}
async function leaveAndReturn(destination, kind, value) {
  await leave(destination); await returnToDetail(kind, value);
}
async function assertOverlaysClosed() {
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.cinema-lightbox-theater,.paged-artwork-picker,.photobook-toc-drawer'))"), false,
    "return automatically reopened a transient overlay");
}
async function bookState() {
  await waitFor("Boolean(document.querySelector('.photobook-stage-deck')?.dataset.settledPageId) && !document.querySelector('.photobook-double-spread.is-animating')");
  return cdp.evaluate(`(() => { const node=document.querySelector('.photobook-stage-deck'); return {
    spread:Number(node.dataset.settledSpread),pageId:node.dataset.settledPageId,kind:node.dataset.settledPageKind,
    animating:Boolean(document.querySelector('.photobook-double-spread.is-animating')) }; })()`);
}
async function assertBook(expected) {
  await waitFor(`(() => { const node=document.querySelector('.photobook-stage-deck'); return node?.dataset.settledPageId===${JSON.stringify(expected.pageId)} && Number(node.dataset.settledSpread)===${expected.spread} && !document.querySelector('.photobook-double-spread.is-animating'); })()`);
  assert.deepEqual(await bookState(), expected);
}
async function goToBookPage(index) {
  await click(".photobook-toc-trigger-btn");
  await waitFor(`document.querySelectorAll('.toc-drawer-card').length > ${index}`);
  await cdp.evaluate(`document.querySelectorAll('.toc-drawer-card')[${index}].click()`);
  await waitFor(`!document.querySelector('.photobook-toc-drawer') && Number(document.querySelector('.photobook-stage-deck')?.dataset.settledSpread) === ${spreadForPage(index)} && !document.querySelector('.photobook-double-spread.is-animating')`);
}
async function scopePages(scope) {
  return cdp.evaluate(`(async()=> (await window.sanctuary.listScopedArtworks(${JSON.stringify(scope)})).map(item=>({id:item.id,assetId:item.assetId})))()`);
}
async function scrollSnapshot(selector) {
  return cdp.evaluate(`(() => {
    const container=document.querySelector(${JSON.stringify(selector)}),top=container.getBoundingClientRect().top+container.clientTop;
    const rows=Array.from(container.querySelectorAll('[data-gallery-page-id]'));
    let index=0; while(index<rows.length && rows[index].getBoundingClientRect().top<top) index++;
    index=Math.max(0,index-1); const rowTop=rows[index]?.getBoundingClientRect().top;
    while(index>0 && rows[index-1].getBoundingClientRect().top===rowTop) index--;
    const row=rows[index]; return {scrollTop:container.scrollTop,max:container.scrollHeight-container.clientHeight,
      pageId:row?.dataset.galleryPageId??null,kind:row?.dataset.galleryPageKind??null,offset:row?row.getBoundingClientRect().top-top:0};
  })()`);
}
async function scrollAndCapture(selector) {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await settledFrames();
  // Swallow pending scroll notifications; synchronous navigation capture must read the DOM.
  await cdp.evaluate(`(() => {
    window.__returnScrollStop ??= event=>event.stopImmediatePropagation();
    document.addEventListener('scroll',window.__returnScrollStop,true);
    const node=document.querySelector(${JSON.stringify(selector)});
    node.scrollTo({top:Math.min(900,(node.scrollHeight-node.clientHeight)*0.45),behavior:'instant'});
  })()`);
  await settledFrames();
  const position = await scrollSnapshot(selector);
  assert.ok(position.scrollTop > 100, `fixture is not scrollable: ${selector} ${JSON.stringify(position)}`);
  return position;
}
async function assertScroll(selector, expected, { resized = false } = {}) {
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await settledFrames();
  const actual = await scrollSnapshot(selector);
  // Skipped cards can replace their estimated height as they enter the viewport.
  // Compare absolute scroll only when the document height stayed stable; the real
  // page and its viewport offset must be preserved in either case.
  if (!resized && Math.abs(actual.max - expected.max) <= 2) assert.ok(Math.abs(actual.scrollTop - expected.scrollTop) <= 2,
    `scroll position lost: ${selector} expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`);
  if (expected.pageId) {
    const offset = await cdp.evaluate(`(() => { const container=document.querySelector(${JSON.stringify(selector)});
      const row=Array.from(container.querySelectorAll('[data-gallery-page-id]')).find(node=>node.dataset.galleryPageId===${JSON.stringify(expected.pageId)});
      return row ? row.getBoundingClientRect().top-container.getBoundingClientRect().top-container.clientTop : null; })()`);
    assert.ok(offset !== null && Math.abs(offset - expected.offset) <= 2,
      `scroll anchor moved: ${selector} page ${expected.pageId}, expected offset ${expected.offset}, actual ${offset}`);
  }
  await cdp.evaluate("document.removeEventListener('scroll',window.__returnScrollStop,true);delete window.__returnScrollStop");
}
async function scrollReturn(selector, kind, value, destination) {
  const before = await scrollAndCapture(selector);
  await leaveAndReturn(destination, kind, value);
  await assertScroll(selector, before);
}
async function directoryReturn(kind, name) {
  const selector = kind === "collection" ? ".album-card-book" : ".author-browser-card";
  // Scroll to the chosen real card and enter in the same task, before a scroll event can fire.
  const before = await cdp.evaluate(`(() => {
    window.__returnScrollStop=event=>event.stopImmediatePropagation(); document.addEventListener('scroll',window.__returnScrollStop,true);
    const main=document.querySelector('.app-shell > main');
    const card=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node=>node.textContent.includes(${JSON.stringify(name)}));
    main.scrollTo({top:Math.max(0,main.scrollTop+card.getBoundingClientRect().top-main.getBoundingClientRect().top-150),behavior:'instant'});
    const top=main.scrollTop; card.click(); return top;
  })()`);
  assert.ok(before > 100, `directory fixture did not put ${name} below the first viewport`);
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(detailSelector[kind])}))`);
  await click(kind === "collection" ? ".theater-game-back-btn" : ".author-back-btn");
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector(${JSON.stringify(detailSelector[kind])})`);
  await settledFrames();
  const actual = await cdp.evaluate("document.querySelector('.app-shell > main').scrollTop");
  assert.ok(Math.abs(before - actual) <= 2, `directory scroll lost: expected ${before}, actual ${actual}`);
  await cdp.evaluate("document.removeEventListener('scroll',window.__returnScrollStop,true);delete window.__returnScrollStop");
  await openDetail(kind, name);
}
function spreadForPage(index) { return index <= 0 ? 0 : 1 + Math.floor((index - 1) / 2); }
function firstPageForSpread(spread, count) { return Math.min(count - 1, spread <= 0 ? 0 : (spread - 1) * 2 + 1); }

async function seedFixture() {
  const databasePath = join(userData, "library.db"), library = new LibraryDatabase(databasePath);
  const fixture = { databasePath, albumName: "返航画册", authorName: "返航测试画师", authorId: "40001",
    secondAlbumName: "范围乙画册", secondAuthorName: "范围乙画师", secondAuthorId: "40002",
    smallAlbumName: "范围乙画册", deleteAlbumName: "删除范围画册" };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  try {
    // Give both genuine scopes cards below the fold. These rows carry no fictitious artworks.
    for (let index = 0; index < 60; index++) library.createCollection(`空册 ${String(index).padStart(2, "0")}`);
    fixture.albumId = library.createCollection(fixture.albumName).id;
    fixture.smallAlbumId = library.createCollection(fixture.smallAlbumName).id;
    fixture.deleteAlbumId = library.createCollection(fixture.deleteAlbumName).id;
    for (const [authorId, authorName, workCount, pageCount, albumId, base] of [
      [fixture.authorId, fixture.authorName, 12, 4, fixture.albumId, 410000000],
      [fixture.secondAuthorId, fixture.secondAuthorName, 2, 3, fixture.smallAlbumId, 420000000]]) {
      const ids = [];
      for (let work = 0; work < workCount; work++) for (let page = 0; page < pageCount; page++) {
        const workId = String(base + work), path = join(userData, `${workId}_p${page}.png`);
        await writeFile(path, png);
        const artwork = library.importArtwork(path);
        library.saveArtworkSource(artwork.id, { platform: "pixiv", workId, pageIndex: page,
          authorId, authorName, title: `返航真实作品 ${String(work).padStart(2, "0")} 第 ${page + 1} 页` });
        library.trustArtwork(artwork.id); ids.push(artwork.id);
      }
      library.addArtworksToCollection(ids, albumId);
      if (authorId === fixture.authorId) library.addArtworksToCollection(ids.slice(0, 4), fixture.deleteAlbumId);
    }
  } finally { library.close(); }
  const database = new DatabaseSync(databasePath);
  try {
    const insert = database.prepare("INSERT INTO artists(id,name,updated_at) VALUES(?,?,?)");
    for (let index = 0; index < 80; index++) insert.run(`empty-artist-${index}`, `空作者 ${String(index).padStart(2, "0")}`, "2100-01-01T00:00:00.000Z");
    database.prepare("INSERT INTO user_preferences(key,value_json,updated_at) VALUES('library.preferences',?,?)").run(
      JSON.stringify({ defaultView: "collections", defaultSortBy: "savedAt", defaultSortDirection: "desc", gridDensity: "comfortable", downloadDirectory: join(userData, "Storage", "Pixiv") }), new Date().toISOString());
  } finally { database.close(); }
  return fixture;
}
function removeFixturePages(ids) {
  assert.ok(ids.length > 0 && ids.length <= 54);
  const database = new DatabaseSync(join(userData, "library.db"));
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const works = new Set(ids.map(id => database.prepare("SELECT work_id FROM assets WHERE legacy_artwork_id=?").get(id)?.work_id).filter(Boolean));
    for (const id of ids) {
      database.prepare("DELETE FROM assets WHERE legacy_artwork_id=?").run(id);
      database.prepare("DELETE FROM artworks WHERE id=?").run(id);
    }
    for (const work of works) database.prepare(`UPDATE works SET
      page_count=(SELECT COUNT(*) FROM assets WHERE work_id=works.id),
      cover_asset_id=(SELECT id FROM assets WHERE work_id=works.id ORDER BY page_index LIMIT 1) WHERE id=?`).run(work);
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; }
  finally { database.close(); }
}
async function availablePort() {
  const server = createServer();
  return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => {
    const port=server.address().port; server.close(error => error ? reject(error) : done(port));
  }); });
}
async function waitForTarget(port) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const target = (await response.json()).find(entry => entry.webSocketDebuggerUrl && entry.type === "page"
        && entry.url?.replaceAll("\\", "/").includes("/renderer/index.html"));
      if (target) {
        const url = new URL(target.webSocketDebuggerUrl);
        assert.ok(url.hostname === "127.0.0.1" && Number(url.port) === port, "renderer endpoint left the isolated loopback port");
        return target;
      }
    } catch {}
    await pause(80);
  }
  throw new Error("Isolated Electron renderer did not start");
}
async function connectCdp(url) {
  const socket = new WebSocket(url), pending = new Map(); let nextId = 1;
  const rejectPending = () => { for (const request of pending.values()) {
    clearTimeout(request.timer); request.reject(new Error("Renderer debug connection closed"));
  } pending.clear(); };
  socket.addEventListener("close", rejectPending);
  socket.addEventListener("message", event => {
    const message=JSON.parse(event.data), request=pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id=nextId++, timer=setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve: done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close() { rejectPending(); socket.close(); }, async evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  } };
}
