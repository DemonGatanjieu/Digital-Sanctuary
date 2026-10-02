import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { connectElectronMainInspector } from "./electron-smoke-support.mjs";

// Run against a disposable library. No user files, downloads or model installations are changed.
const port = await availablePort();
const mainPort = await availablePort();
const temporaryRoot = resolve(tmpdir());
const userData = await mkdtemp(join(temporaryRoot, "sanctuary-navigation-"));
const outputDir = resolve(".tmp/navigation-smoke");
await mkdir(outputDir, { recursive: true });
const imagePath = join(userData, "参考作品.png");
await writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
const database = new DatabaseSync(join(userData, "library.db"));
database.exec(`
  CREATE TABLE works (
    id TEXT PRIMARY KEY, source_platform TEXT, source_work_id TEXT, artist_id TEXT,
    title TEXT NOT NULL, work_type TEXT NOT NULL, published_at TEXT, bookmarked_at TEXT,
    saved_at TEXT NOT NULL, last_viewed_at TEXT, favorite INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0, cover_asset_id TEXT, ownership TEXT NOT NULL,
    deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL, legacy_artwork_id TEXT UNIQUE,
    page_index INTEGER NOT NULL, path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    media_type TEXT NOT NULL, extension TEXT, width INTEGER, height INTEGER,
    byte_length INTEGER, content_hash TEXT, thumbnail_path TEXT, file_state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (work_id, page_index)
  );
  CREATE TABLE collections (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    cover_artwork_id TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE collection_works (
    collection_id TEXT NOT NULL, work_id TEXT NOT NULL, added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, work_id)
  );
  CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
`);
const timestamp = new Date().toISOString();
database.prepare("INSERT INTO user_preferences (key, value_json, updated_at) VALUES ('library.preferences', ?, ?)")
  .run(JSON.stringify({ defaultView: "flat", defaultSortBy: "savedAt", defaultSortDirection: "desc",
    gridDensity: "comfortable", downloadDirectory: join(userData, "Storage", "Pixiv") }), timestamp);
database.prepare(`INSERT INTO works (id, title, work_type, saved_at, page_count, cover_asset_id,
  ownership, created_at, updated_at) VALUES ('fixture-work', '参考作品', 'local', ?, 1, 'fixture-asset', 'referenced', ?, ?)`)
  .run(timestamp, timestamp, timestamp);
database.prepare(`INSERT INTO assets (id, work_id, page_index, path, media_type, extension,
  width, height, file_state, created_at, updated_at) VALUES ('fixture-asset', 'fixture-work', 0, ?, 'image', '.png', 1, 1, 'available', ?, ?)`)
  .run(imagePath, timestamp, timestamp);
database.prepare("INSERT INTO collections (id, name, created_at) VALUES ('fixture-collection', '练习相册', ?)")
  .run(timestamp);
database.close();

const child = spawn(resolve("node_modules/electron/dist/electron.exe"),
  [`--inspect=127.0.0.1:${mainPort}`, resolve("apps/desktop/out/main/index.js"), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`,
    "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
  { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const checks = [];
let mainInspector;

try {
  mainInspector = await connectElectronMainInspector(mainPort);
  const target = await waitForRenderer();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    async function waitFor(expression) {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        if (await cdp.evaluate(expression)) return;
        await new Promise((done) => setTimeout(done, 80));
      }
      throw new Error(`Timed out: ${expression}`);
    }
    async function click(selector) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      assert.equal(await cdp.evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (button.disabled) return false;
        button.click(); return true;
      })()`), true, `disabled control: ${selector}`);
    }
    async function fill(selector, value) {
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      await cdp.evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      })()`);
    }
    async function key(key, code, modifiers = 0, target = cdp) {
      await target.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
      await target.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
    }
    async function checkLayout(name, screenshot = false) {
      // Inspect the scroll container as well as the document: inner overflow is otherwise missed.
      const metrics = await cdp.evaluate(`(() => {
        const main = document.querySelector('main');
        const sidebar = document.querySelector('.sidebar');
        const bounds = main.getBoundingClientRect();
        const boundary = bounds.right - parseFloat(getComputedStyle(main).paddingRight) - (main.offsetWidth - main.clientWidth);
        return { documentOverflow: document.documentElement.scrollWidth - innerWidth,
          mainOverflow: main.scrollWidth - main.clientWidth,
          sidebarOverflow: sidebar.scrollWidth - sidebar.clientWidth,
          sidebarOverflowingElements: Array.from(sidebar.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > sidebar.getBoundingClientRect().right + 2)
            .slice(0, 8).map(el => ({ className: el.className, width: el.getBoundingClientRect().width })),
          horizontalScrollers: Array.from(main.querySelectorAll('*')).filter(el => el.getBoundingClientRect().width > 0
            && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 2)
            .map(el => el.className),
          overflowingElements: Array.from(main.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > boundary + 2)
            .slice(0, 8).map(el => ({ tag: el.tagName, className: el.className, width: el.getBoundingClientRect().width })),
          activeView: document.querySelector('.sidebar [aria-current="page"]')?.dataset.nav };
      })()`);
      if (screenshot) {
        const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
        await writeFile(join(outputDir, `${name}.png`), Buffer.from(result.data, "base64"));
      }
      assert.ok(metrics.documentOverflow <= 2 && metrics.mainOverflow <= 2, `${name}: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.sidebarOverflow <= 2, `${name}: sidebar overflow ${JSON.stringify(metrics)}`);
      assert.deepEqual(metrics.horizontalScrollers, [], `${name}: unexpected inner horizontal scrolling`);
      checks.push({ name, ...metrics });
    }

    await waitFor("document.querySelectorAll('.work-library-card').length === 1");
    assert.deepEqual(await cdp.evaluate("Array.from(document.querySelectorAll('.sidebar nav button')).map(el => el.dataset.nav)"),
      ["gallery", "explore", "inspiration", "settings"]);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await checkLayout("gallery-1280", true);

    await key("k", "KeyK", 2);
    await waitFor("document.activeElement?.className === 'quick-actions-search'");
    await fill(".quick-actions-search", "模型");
    await cdp.evaluate("document.querySelector('.quick-actions-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.quick-actions-dialog'))"), true);
    await key("Enter", "Enter");
    await waitFor("Boolean(document.querySelector('.settings-panel:not([hidden]) .model-center-page'))");
    await click('[data-nav="gallery"]');
    await waitFor("Boolean(document.querySelector('.work-search input'))");
    await key("k", "KeyK", 2);
    await fill(".quick-actions-search", "搜索图库");
    await key("Enter", "Enter");
    await waitFor("document.activeElement === document.querySelector('.work-search input')");
    await key("k", "KeyK", 2);
    await key("Escape", "Escape");
    await waitFor("!document.querySelector('.quick-actions-dialog')");
    await cdp.evaluate("document.querySelector('main').scrollTo({top:250,behavior:'instant'})");
    await new Promise((done) => setTimeout(done, 100));
    const galleryTop = await cdp.evaluate("document.querySelector('main').scrollTop");
    await click('[data-nav="settings"]');
    await waitFor("Boolean(document.querySelector('.settings-navigation'))");
    // Simulate a work saved by native Pixiv controls, without a renderer download callback.
    const changedLibrary = new DatabaseSync(join(userData, "library.db"));
    try {
      changedLibrary.prepare(`INSERT INTO works (id, title, work_type, saved_at, page_count,
        ownership, created_at, updated_at) VALUES ('native-saved-fixture', '原生保存的新作品', 'local', ?, 0, 'referenced', ?, ?)`)
        .run(timestamp, timestamp, timestamp);
    } finally { changedLibrary.close(); }
    await click('[data-nav="gallery"]');
    await waitFor("Boolean(document.querySelector('.work-search input'))");
    await waitFor("document.querySelectorAll('.work-library-card').length === 2");
    assert.ok(Math.abs(await cdp.evaluate("document.querySelector('main').scrollTop") - galleryTop) <= 2, "gallery scroll position was not restored");
    checks.push({ name: "quick-actions-IME-focus-routing-and-gallery-revalidation", galleryTop, worksOnReturn: 2 });

    await click(".work-select-toggle");
    await click(".work-card-check");
    await click(".work-analyze-selected");
    await waitFor("document.querySelector('.studio-root')?.innerText.includes('选择要整理的范围')");
    assert.equal(await cdp.evaluate("document.querySelector('.studio-root').innerText.includes('1 项已选')"), true);
    assert.equal(await cdp.evaluate("document.querySelector('.sidebar [aria-current=\"page\"]').dataset.nav"), "gallery");
    assert.equal(await cdp.evaluate("document.querySelector('.workspace-navigation [aria-current=\"page\"]').dataset.nav"), "organize");
    assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.listAnalysisJobs()).length)()"), 0);
    checks.push({ name: "selection-opens-suggestions-without-running-analysis" });

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
    await checkLayout("organize-900", true);
    await click('[data-nav="settings"]');
    const categories = [
      ["library", ".storage-preference-card"], ["appearance", ".typography-settings-section"],
      ["protection", ".rules-grid"], ["models", ".model-center-page"], ["connections", ".comfy-settings-section"]
    ];
    for (const [section, selector] of categories) {
      await click(`[data-settings="${section}"]`);
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(`.settings-panel:not([hidden]) ${selector}`)}))`);
      for (const [other, otherSelector] of categories.filter(([id]) => id !== section)) {
        assert.equal(await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(`.settings-panel:not([hidden]) ${otherSelector}`)}))`), false, `unexpected category: ${other}`);
      }
      assert.equal(await cdp.evaluate("document.querySelectorAll('h1').length"), 1);
      assert.equal(await cdp.evaluate("document.querySelector('main').scrollTop"), 0);
      await checkLayout(`settings-${section}-900`, true);
    }
    await waitFor("document.querySelector('#vision-model-input').value.length > 0");
    await fill("#vision-model-input", "navigation-draft-model");
    await fill("#vision-key-input", "navigation-test-placeholder");
    await fill(".comfy-config-row input", "http://127.0.0.1:8288");
    await click('[data-settings="library"]');
    await click('[data-settings="connections"]');
    assert.deepEqual(await cdp.evaluate("[document.querySelector('#vision-model-input').value, document.querySelector('#vision-key-input').value, document.querySelector('.comfy-config-row input').value]"),
      ["navigation-draft-model", "navigation-test-placeholder", "http://127.0.0.1:8288"]);
    await click('[data-settings="appearance"]');
    await waitFor("document.querySelector('.slot-select')?.options.length > 1");
    await fill('.slot-select', "preset::preset.classical-editorial");
    await waitFor("Boolean(document.querySelector('.typography-save-bar'))");
    await click('[data-settings="library"]');
    await click('[data-settings="appearance"]');
    assert.equal(await cdp.evaluate("document.querySelector('.slot-select').value"), "preset::preset.classical-editorial");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.typography-save-bar'))"), true);
    checks.push({ name: "unsaved-connection-and-font-drafts-survive-category-switches" });
    await click('[data-nav="inspiration"]');
    await waitFor("Boolean(document.querySelector('.inspiration-no-model button'))");
    assert.equal(await cdp.evaluate("document.querySelector('.inspiration-no-model button').getBoundingClientRect().bottom <= innerHeight"), true);
    await fill(".inspiration-composer textarea", "没有模型时不应发起推理");
    assert.equal(await cdp.evaluate("document.querySelector('.inspiration-send').disabled"), true);
    await checkLayout("creation-900", true);
    await click(".inspiration-no-model button");
    await waitFor("Boolean(document.querySelector('.model-center-page'))");
    assert.equal(await cdp.evaluate("document.querySelector('[data-settings][aria-current=\"page\"]').dataset.settings"), "models");
    checks.push({ name: "creation-model-setup-link" });

    // Cover the common rendering policies and contrasting built-in themes.
    await click('[data-settings="appearance"]');
    for (const profile of ["quality", "balanced", "efficient"]) {
      const index = ["quality", "balanced", "efficient"].indexOf(profile);
      await click(`.appearance-profile-options button:nth-child(${index + 1})`);
      await waitFor(`document.querySelector('.app-shell').dataset.displayProfile === ${JSON.stringify(profile)}`);
      await checkLayout(`appearance-${profile}-900`);
    }
    for (const theme of ["builtin.cyber-deck", "builtin.sakura-dream"]) {
      await cdp.evaluate(`window.sanctuary.setActiveTheme(${JSON.stringify(theme)})`);
      await new Promise((done) => setTimeout(done, 200));
      await checkLayout(`appearance-${theme}-900`);
    }
    await click('[data-nav="gallery"]');
    await waitFor("document.querySelectorAll('.work-library-card').length === 2");
    await checkLayout("gallery-900", true);
    await key("k", "KeyK", 2);
    await waitFor("Boolean(document.querySelector('.quick-actions-dialog'))");
    await new Promise((done) => setTimeout(done, 300));
    const palette = await cdp.evaluate("(() => { const el=document.querySelector('.quick-actions-dialog'); const r=el.getBoundingClientRect(); return {width:r.width,right:r.right,bottom:r.bottom,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}; })()");
    const paletteShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(join(outputDir, "quick-actions-900.png"), Buffer.from(paletteShot.data, "base64"));
    assert.ok(palette.right <= 900 && palette.bottom <= 620 && palette.scrollWidth <= palette.clientWidth + 2, `quick actions overflowed the narrow window: ${JSON.stringify(palette)}`);
    await key("Escape", "Escape");
    checks.push({ name: "quick-actions-900", ...palette });

    // Keep the remote site offline while checking the real native view lifecycle.
    await click('[data-nav="explore"]');
    await waitFor("Boolean(document.querySelector('.explore-page'))");
    await cdp.evaluate("window.sanctuary.exploreCommand('browse-unprotected')");
    await waitFor("document.querySelector('.engine-card strong')?.textContent === '本次无保护浏览'");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.engine-card .online'))"), false);
    await checkLayout("explore-900", true);
    let nativeTarget;
    const nativeStarted = Date.now();
    while (!nativeTarget && Date.now() - nativeStarted < 10_000) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      nativeTarget = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl && entry.url.includes("pixiv.net"));
      if (!nativeTarget) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(nativeTarget, "native exploration target did not appear");
    const native = await connectCdp(nativeTarget.webSocketDebuggerUrl);
    try {
      const bounds = await cdp.evaluate("(() => { const rect = document.querySelector('.explore-surface').getBoundingClientRect(); return { width: Math.round(rect.width), height: Math.round(rect.height) }; })()");
      const viewport = await native.evaluate("({ width: innerWidth, height: innerHeight, visibility: document.visibilityState })");
      assert.ok(Math.abs(bounds.width - viewport.width) <= 2 && Math.abs(bounds.height - viewport.height) <= 2, "native view bounds do not match the exploration surface");
      // Native shortcuts go through Electron host input; CDP skips before-input-event.
      await mainInspector.evaluate("process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows()[0].focus()");
      await cdp.evaluate("window.sanctuary.focusExplore()");
      let nativeContents;
      const focusStarted = Date.now();
      while (Date.now() - focusStarted < 10_000) {
        nativeContents = (await mainInspector.listWebContents()).find((entry) => entry.url.includes("pixiv.net") && entry.focused);
        if (nativeContents) break;
        await new Promise((done) => setTimeout(done, 80));
      }
      assert.ok(nativeContents, "native exploration did not receive keyboard focus");
      await mainInspector.sendHostKey(nativeContents.id, "K", ["control"]);
      await waitFor("document.activeElement?.className === 'quick-actions-search'");
      assert.equal(await native.evaluate("document.visibilityState"), "hidden");
      await key("Escape", "Escape");
      await waitFor("!document.querySelector('.quick-actions-dialog')");
      await new Promise((done) => setTimeout(done, 100));
      assert.equal(await native.evaluate("document.visibilityState"), "visible");
      assert.equal(await native.evaluate("document.hasFocus()"), true, "native exploration focus was not restored");
      checks.push({ name: "native-quick-actions-hide-cancel-and-restore-focus" });
      await click('[data-nav="settings"]');
      await waitFor("Boolean(document.querySelector('.settings-navigation'))");
      assert.equal(await native.evaluate("document.visibilityState"), "hidden");
      await click(".engine-card");
      await waitFor("Boolean(document.querySelector('.shield-status.protection-bypassed button'))");
      await click(".shield-status.protection-bypassed button");
      await waitFor("document.querySelector('.engine-card strong')?.textContent !== '本次无保护浏览'");
      assert.notEqual(await cdp.evaluate("(async () => (await window.sanctuary.getExploreState()).protectionStatus)()"), "bypassed");
      checks.push({ name: "offline-native-exploration-bounds-hide-and-resume", viewport, bounds });
      await click('[data-nav="gallery"]');
    } finally { native.close(); }
    console.log(JSON.stringify({ status: "passed", checks, screenshots: outputDir }, null, 2));
  } finally { cdp.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  mainInspector?.close();
  child.kill();
  await new Promise((done) => {
    if (child.exitCode !== null) done();
    else { child.once("exit", done); setTimeout(done, 2000); }
  });
  const resolvedUserData = resolve(userData);
  if (!resolvedUserData.startsWith(`${temporaryRoot}${sep}sanctuary-navigation-`)) throw new Error("Unexpected temporary directory");
  await rm(resolvedUserData, { recursive: true, force: true });
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
