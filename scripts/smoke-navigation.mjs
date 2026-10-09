import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

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
  await showElectronTestWindow(mainInspector);
  const target = await waitForRenderer();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    async function waitFor(expression, page = cdp) {
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        if (await page.evaluate(expression)) return;
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
    // ---- image-first gallery helpers ----
    async function menu(trigger, label) {
      await click(trigger);
      await waitFor("Boolean(document.querySelector('.ui-popover'))");
      await cdp.evaluate(`[...document.querySelectorAll('.ui-popover [role^=menuitem]')].find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
    }
    async function setPreset(label) { await menu('[data-gallery-filter]', label); }
    async function sortLabel() { return cdp.evaluate("document.querySelector('[aria-label^=\"排序：\"]').getAttribute('aria-label')"); }
    async function sortDisabled() { return cdp.evaluate("document.querySelector('[aria-label^=\"排序：\"]').disabled"); }
    async function sortAscending() {
      await click('[aria-label^="排序："]'); await waitFor("Boolean(document.querySelector('.ui-popover'))");
      const ascending = await cdp.evaluate("[...document.querySelectorAll('.ui-popover [role^=menuitem]')].find(e=>e.textContent.includes('从旧到新')).getAttribute('aria-checked')==='true'");
      await key('Escape', 'Escape'); await waitFor("!document.querySelector('.ui-popover')");
      return ascending;
    }
    async function checkButtonContrast(selector) {
      const ratio = await cdp.evaluate(`(() => {
        const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
        const luminance = color => color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
          const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const foreground = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      })()`);
      assert.ok(ratio >= 4.5, `${selector}: insufficient button text contrast (${ratio})`);
    }
    async function checkLayout(name, screenshot = false) {
      if (screenshot) await new Promise((done) => setTimeout(done, 280));
      // Inspect the scroll container as well as the document: inner overflow is otherwise missed.
      const metrics = await cdp.evaluate(`(() => {
        const main = document.querySelector('main');
        const sidebar = document.querySelector('.app-rail');
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
          activeView: document.querySelector('.app-rail [aria-current="page"]')?.dataset.nav };
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

    await click('[data-nav="home"]');
    await waitFor("document.querySelectorAll('.home-task-card').length === 3");
    // Production delegated feedback must work with nested labels and keyboard-style clicks,
    // cancel repeats, preserve layout and respect preferences even for body portals.
    for (const preference of [
      { profile: 'balanced', reduced: false, system: false, duration: 150 },
      { profile: 'quality', reduced: false, system: false, duration: 190 },
      { profile: 'efficient', reduced: false, system: false, duration: 0 },
      { profile: 'balanced', reduced: true, system: false, duration: 0 },
      { profile: 'balanced', reduced: false, system: true, duration: 0 }
    ]) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: preference.system ? 'reduce' : 'no-preference' }] });
      const result = await cdp.evaluate(`(() => {
        const preference=${JSON.stringify(preference)}, shell=document.querySelector('.app-shell');
        for(const element of [shell,document.body]) {
          element.dataset.displayProfile=preference.profile; element.dataset.reducedMotion=String(preference.reduced);
        }
        const button=document.querySelector('.app-rail [data-nav="home"]'), other=document.querySelector('[data-home-task="gallery"]');
        const before={width:button.offsetWidth,top:other.offsetTop};
        (button.querySelector('span')??button).click(); button.click();
        const animations=button.getAnimations().filter(animation=>animation.effect.getKeyframes().some(frame=>'scale' in frame));
        return { count:animations.length,durations:animations.map(animation=>animation.effect.getTiming().duration),
          unchanged:button.offsetWidth===before.width&&other.offsetTop===before.top,
          current:button.getAttribute('aria-current') };
      })()`);
      assert.equal(result.count, preference.duration ? 1 : 0, JSON.stringify(preference));
      assert.deepEqual(result.durations, preference.duration ? [preference.duration] : []);
      assert.equal(result.unchanged, true); assert.equal(result.current, 'page');
      if (!preference.duration) {
        await click('.app-rail [aria-label="快捷"], .app-rail [title^="快捷操作"]');
        await waitFor("Boolean(document.querySelector('.quick-actions-dialog'))");
        assert.equal(await cdp.evaluate("document.querySelector('.dialog-overlay').getAnimations().length"), 0, 'portal overlay ignored motion preference');
        assert.equal(await cdp.evaluate("parseFloat(getComputedStyle(document.querySelector('.quick-actions-dialog')).transitionDuration)"), 0);
        await key('Escape','Escape'); await waitFor("!document.querySelector('.quick-actions-dialog')");
      }
    }
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await cdp.evaluate("for (const element of [document.querySelector('.app-shell'),document.body]) { element.dataset.displayProfile='balanced'; element.dataset.reducedMotion='false'; }");
    checks.push({name:'finite-button-feedback-repeat-layout-and-portal-motion-preferences'});
    assert.deepEqual(await cdp.evaluate("Array.from(document.querySelectorAll('.app-rail [data-nav]')).map(el => el.dataset.nav)"),
      ["home", "gallery", "explore", "inspiration", "settings"]);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await checkLayout("home-1280", true);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
    await checkLayout("home-900", true);
    await click('[data-nav="gallery"]');
    const storedRules=await cdp.evaluate("window.sanctuary.listFilterSettings()");
    await click('[data-gallery-filter]');
    await cdp.evaluate("Array.from(document.querySelectorAll('.ui-popover [role^=menuitem]')).find(e=>e.textContent.includes('选择元素')).click()");
    await waitFor("Boolean(document.querySelector('.element-filter-dialog'))");
    await checkLayout("element-filter-900",true);
    assert.ok(await cdp.evaluate("document.querySelector('.element-filter-dialog footer button[type=submit]').getBoundingClientRect().bottom<=innerHeight"));
    await click('.element-filter-grid button');
    await cdp.evaluate("Array.from(document.querySelectorAll('.element-filter-dialog footer button')).find(b=>b.textContent.includes('取消')).click()");
    assert.deepEqual(await cdp.evaluate("window.sanctuary.listFilterSettings()"),storedRules);
    assert.equal(await cdp.evaluate("(async()=>(await window.sanctuary.listAnalysisJobs()).length)()"),0);
    checks.push({name:'element-filter-dialog-fits-the-small-window-and-leaves-explore-rules-alone'});
    await click('[data-nav="explore"]');
    await waitFor("Boolean(document.querySelector('.explore-workspace'))");
    await click('[data-nav="inspiration"]');
    await waitFor("Boolean(document.querySelector('.inspiration-chat'))");
    await key("0", "Digit0", 2);
    await waitFor("Boolean(document.querySelector('.home-task-grid'))");
    await click('[data-home-task="gallery"]');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1");
    checks.push({ name: "home-task-routing-Ctrl0-and-safe-default-organizing" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await checkLayout("gallery-1280", true);

    await key("k", "KeyK", 2);
    await waitFor("document.activeElement?.className === 'quick-actions-search'");
    await fill(".quick-actions-search", "本地模型");
    await cdp.evaluate("document.querySelector('.quick-actions-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.quick-actions-dialog'))"), true);
    await key("Enter", "Enter");
    await waitFor("Boolean(document.querySelector('.settings-panel:not([hidden]) .model-center-page'))");
    await click('[data-nav="gallery"]');
    await waitFor("Boolean(document.querySelector('.gallery-search-field input'))");
    await key("k", "KeyK", 2);
    await fill(".quick-actions-search", "搜索图库");
    await key("Enter", "Enter");
    await waitFor("document.activeElement === document.querySelector('.gallery-search-field input')");
    await key("k", "KeyK", 2);
    await key("Escape", "Escape");
    await waitFor("!document.querySelector('.quick-actions-dialog')");
    // Returning must work even if the browser has not delivered the last scroll event.
    await cdp.evaluate(`(() => {
      window.__suppressScroll = event => event.stopImmediatePropagation();
      document.querySelector('main').addEventListener('scroll', window.__suppressScroll, true);
    })()`);
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
    await waitFor("Boolean(document.querySelector('.gallery-search-field input'))");
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 2");
    const restoredGalleryTop = await cdp.evaluate("document.querySelector('main').scrollTop");
    assert.ok(Math.abs(restoredGalleryTop - galleryTop) <= 2, `gallery scroll position was not restored: ${galleryTop} -> ${restoredGalleryTop}`);
    await cdp.evaluate("document.querySelector('main').removeEventListener('scroll', window.__suppressScroll, true); delete window.__suppressScroll");
    checks.push({ name: "quick-actions-IME-focus-routing-and-gallery-revalidation", galleryTop, worksOnReturn: 2 });

    // Preset queries must render real counts, keep the previous sort and avoid first-run onboarding.
    await click(".work-tile-favorite");
    await waitFor("document.querySelector('.work-tile-favorite')?.hasAttribute('data-active') && !document.querySelector('.work-tile-favorite')?.disabled");
    await menu('[aria-label^="排序："]', '标题');
    await menu('[aria-label^="排序："]', '从旧到新');
    assert.equal(await sortAscending(), true);
    await key("k", "KeyK", 2);
    await fill(".quick-actions-search", "喜欢的作品");
    await key("Enter", "Enter");
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1 && !document.querySelector('.work-querying')");
    assert.equal(await cdp.evaluate("document.querySelector('.work-result-meta')?.textContent.includes('1 件')"), true);
    await setPreset('最近浏览');
    await waitFor("document.querySelector('.work-result-meta')?.textContent.includes('0 件') && !document.querySelector('.work-querying')");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.gallery-empty--first'))"), false, "empty recent filter claimed that the whole library was empty");
    assert.equal(await sortDisabled(), true);
    await click('[data-nav="settings"]');
    await key("k", "KeyK", 2);
    await fill(".quick-actions-search", "喜欢的作品");
    await key("Enter", "Enter");
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1 && !document.querySelector('.work-querying')");
    assert.match(await sortLabel(), /标题/);
    assert.equal(await sortAscending(), true);
    await cdp.evaluate("window.sanctuary.recordWorkView('fixture-work', 'fixture-asset')");
    await setPreset('最近浏览');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1 && !document.querySelector('.work-querying')");
    await cdp.evaluate("window.sanctuary.addWorkToCollection('fixture-work', 'fixture-collection')");
    await setPreset('未分相册');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 1 && !document.querySelector('.work-querying')");
    assert.equal(await cdp.evaluate("document.querySelector('.work-tile-caption strong').textContent"), "原生保存的新作品");
    await setPreset('全部作品');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 2 && !document.querySelector('.work-querying')");
    checks.push({ name: "favorite-recent-uncollected-query-counts-empty-state-and-sort-restoration" });

    await click('[aria-label="选择作品"]');
    await click(".work-tile-check");
    await cdp.evaluate("[...document.querySelectorAll('.work-selection-bar button')].find(b=>b.textContent.includes('拿去创作')).click()");
    // Without a creation model the page shows its setup state; the two-picture launch is covered by smoke-discovery-workflow.
    await waitFor("Boolean(document.querySelector('.inspiration-view'))");
    assert.equal(await cdp.evaluate("document.querySelector('.app-rail [aria-current=\"page\"]').dataset.nav"), "inspiration");
    assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.listAnalysisJobs()).length)()"), 0);
    checks.push({ name: "selection-takes-pictures-to-creation-without-running-analysis" });

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
    await checkLayout("creation-from-selection-900", true);
    await click('[data-nav="settings"]');
    const categories = [
      ["library", ".storage-preference-card"], ["appearance", ".appearance-settings-card"],
      ["models", ".model-center-page"], ["connections", '[data-disclosure="external-vision"]']
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
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('#vision-model-input'))"), false);
    await click('[data-disclosure="external-vision"] > button');
    await click('[data-disclosure="comfyui"] > button');
    await waitFor("document.querySelector('#vision-model-input').value.length > 0");
    await fill("#vision-model-input", "navigation-draft-model");
    await fill("#vision-key-input", "navigation-test-placeholder");
    await fill(".comfy-config-row input", "http://127.0.0.1:8288");
    await click('[data-settings="library"]');
    await click('[data-settings="connections"]');
    assert.deepEqual(await cdp.evaluate("[document.querySelector('#vision-model-input').value, document.querySelector('#vision-key-input').value, document.querySelector('.comfy-config-row input').value]"),
      ["navigation-draft-model", "navigation-test-placeholder", "http://127.0.0.1:8288"]);
    await click('[data-settings="appearance"]');
    await click('[aria-label="界面字体"] button:nth-child(2)');
    await waitFor("document.documentElement.dataset.font === 'dengxian' && getComputedStyle(document.body).fontFamily.includes('DengXian')");
    await click('[data-settings="library"]');
    await click('[data-settings="appearance"]');
    assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.getAppearancePreferences()).interfaceFont)()"), "dengxian");
    await click('[aria-label="界面字体"] button:nth-child(1)');
    await waitFor("document.documentElement.dataset.font === 'default'");
    checks.push({ name: "unsaved-connection-drafts-survive-category-switches-and-the-interface-font-applies-at-once" });
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

    // Cover the display profiles and both color schemes.
    await click('[data-settings="appearance"]');
    for (const profile of ["quality", "balanced", "efficient"]) {
      const index = ["quality", "balanced", "efficient"].indexOf(profile);
      await click(`[aria-label="显示档位"] button:nth-child(${index + 1})`);
      await waitFor(`document.querySelector('.app-shell').dataset.displayProfile === ${JSON.stringify(profile)}`);
      await checkLayout(`appearance-${profile}-900`);
    }
    for (const theme of ["dark", "light"]) {
      await click(`[aria-label="配色"] button:nth-child(${theme === "dark" ? 3 : 2})`);
      await waitFor(`matchMedia('(prefers-color-scheme: dark)').matches === ${theme === "dark"}`);
      await new Promise((done) => setTimeout(done, 200));
      await checkLayout(`appearance-${theme}-900`);
      await click('[data-nav="home"]');
      await checkLayout(`home-${theme}-900`, true);
      await click('[aria-label="任务与进度"]');
      await waitFor("Boolean(document.querySelector('.task-center-dialog'))");
      await checkLayout(`task-center-${theme}-900`, true);
      await checkButtonContrast('.task-center-dialog .ui-button--secondary');
      await key('Escape', 'Escape');
      await click('[data-nav="inspiration"]');
      await waitFor("Boolean(document.querySelector('.inspiration-view'))");
      await checkLayout(`creation-${theme}-900`, true);
      await click('[data-nav="settings"]');
      await waitFor("Boolean(document.querySelector('.settings-panel:not([hidden]) .appearance-settings-card'))");
    }
    await click('[data-nav="gallery"]');
    await waitFor("document.querySelectorAll('[data-work-tile]').length === 2");
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

    // Hold only the first production show response, after its visibility update has run.
    // A quick-actions open/cancel creates a newer show before this old response arrives.
    await mainInspector.evaluate(`(() => {
      const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain;
      const original = ipc._invokeHandlers.get('explore:show');
      if (typeof original !== 'function') throw new Error('Production exploration show handler is missing');
      const state = globalThis.__navigationShowDelay = { original, calls: 0, holding: false, released: false, release: null };
      ipc.removeHandler('explore:show');
      ipc.handle('explore:show', (...args) => {
        const result = original(...args);
        if (++state.calls !== 1) return result;
        state.holding = true;
        return new Promise(resolve => {
          state.release = () => {
            state.holding = false;
            state.released = true;
            state.release = null;
            resolve(result);
          };
        });
      });
      return true;
    })()`);
    // Keep the remote site offline while checking the real native view lifecycle.
    await click('[data-nav="explore"]');
    await waitFor("Boolean(document.querySelector('.explore-page'))");
    await waitFor("globalThis.__navigationShowDelay?.holding === true", mainInspector);
    await cdp.evaluate("window.sanctuary.exploreCommand('browse-unprotected')");
    await waitFor("document.querySelector('.rail-protection')?.getAttribute('aria-label').startsWith('本次无保护浏览')");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('.rail-protection .online'))"), false);
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
      let bounds;
      let viewport;
      let boundsMatch = false;
      const boundsStarted = Date.now();
      // Target creation can precede ResizeObserver's bounds IPC and the native resize.
      while (Date.now() - boundsStarted < 10_000) {
        [bounds, viewport] = await Promise.all([
          cdp.evaluate("(() => { const rect = document.querySelector('.explore-surface').getBoundingClientRect(); return { width: Math.round(rect.width), height: Math.round(rect.height) }; })()"),
          native.evaluate("({ width: innerWidth, height: innerHeight, visibility: document.visibilityState })")
        ]);
        boundsMatch = Math.abs(bounds.width - viewport.width) <= 2 && Math.abs(bounds.height - viewport.height) <= 2;
        if (boundsMatch) break;
        await new Promise((done) => setTimeout(done, 80));
      }
      assert.ok(boundsMatch, `native view bounds do not match the exploration surface: ${JSON.stringify({ bounds, viewport })}`);
      // Native shortcuts go through Electron host input; CDP skips before-input-event.
      // A hidden launch can keep document.visibilityState hidden even when the native view is shown.
      await showElectronTestWindow(mainInspector);
      await cdp.evaluate("window.sanctuary.focusExplore()");
      let nativeContents;
      const focusStarted = Date.now();
      while (Date.now() - focusStarted < 10_000) {
        nativeContents = (await mainInspector.listWebContents()).find((entry) => entry.url.includes("pixiv.net") && entry.focused);
        if (nativeContents) break;
        await new Promise((done) => setTimeout(done, 80));
      }
      assert.ok(nativeContents, "native exploration did not receive keyboard focus");
      // Chromium can report an offline error document hidden while its native View is visible.
      // Check the actual Electron View; keyboard ownership is checked independently below.
      const visibleNativeView = `(() => {
        const window=process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows()[0];
        return window.isVisible() && window.contentView.children.some(view=>view.webContents?.id===${nativeContents.id} && view.getVisible());
      })()`;
      await mainInspector.sendHostKey(nativeContents.id, "K", ["control"]);
      await waitFor("document.activeElement?.className === 'quick-actions-search'");
      await waitFor(`!${visibleNativeView}`, mainInspector);
      await key("Escape", "Escape");
      await waitFor("!document.querySelector('.quick-actions-dialog')");
      await waitFor("globalThis.__navigationShowDelay?.calls >= 2", mainInspector);
      await waitFor(visibleNativeView, mainInspector);
      assert.equal(await native.evaluate("document.hasFocus()"), true, "native exploration focus was not restored");
      checks.push({ name: "native-quick-actions-hide-cancel-and-restore-focus" });
      assert.equal(await mainInspector.evaluate(`(() => {
        const state = globalThis.__navigationShowDelay;
        if (!state?.holding || typeof state.release !== 'function') return false;
        state.release();
        return true;
      })()`), true, "the earlier show response was not held until the newer show");
      // Let the late response reach the renderer, including any incorrect follow-up hide IPC.
      await cdp.evaluate("(async () => { await window.sanctuary.getExploreState(); await new Promise(done => setTimeout(done, 250)); })()");
      assert.equal(await mainInspector.evaluate(visibleNativeView), true, "an expired show response hid the current exploration view");
      assert.equal(await native.evaluate("document.hasFocus()"), true, "an expired show response interrupted restored native focus");
      checks.push({ name: "native-expired-show-response-preserves-newer-show" });
      const timeOrigin = await native.evaluate("globalThis.__continuityMarker='same-explore-document';performance.timeOrigin");
      await mainInspector.evaluate(`(() => {
        const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
        const state=globalThis.__exploreTransitions={show:0,hide:0,bounds:0};
        for(const [channel,key] of [['explore:show','show'],['explore:hide','hide'],['explore:set-bounds','bounds']]) {
          const original=ipc._invokeHandlers.get(channel);ipc.removeHandler(channel);
          ipc.handle(channel,(...args)=>{state[key]++;return original(...args)});
        } return true;
      })()`);
      for (const destination of ['home','gallery','inspiration','settings']) {
        await click('[data-nav="'+destination+'"]'); await waitFor(`!${visibleNativeView}`,mainInspector);
        const before=await cdp.evaluate("document.querySelector('.app-rail').getBoundingClientRect().right");
        await mainInspector.evaluate("Object.assign(__exploreTransitions,{show:0,hide:0,bounds:0});true");
        const frames=await cdp.evaluate(`(async()=>{
          document.querySelector('[data-nav="explore"]').click();
          const frames=[];
          for(let i=0;i<8;i++) {await new Promise(requestAnimationFrame);
            const surface=document.querySelector('.explore-surface'),r=surface.getBoundingClientRect();
            frames.push({x:r.x,y:r.y,transform:getComputedStyle(document.querySelector('.explore-page')).transform});
          } return frames;
        })()`);
        assert.ok(frames.every(frame=>Math.abs(frame.x-before)<.1&&frame.transform==='none'),'exploration changed sidebar width or animated native geometry');
        assert.ok(frames.every(frame=>Math.abs(frame.y-frames[0].y)<.1),'exploration surface drifted after its first frame');
        await waitFor(visibleNativeView,mainInspector);
        const calls=await mainInspector.evaluate('({...__exploreTransitions})');
        assert.equal(calls.show,1);assert.equal(calls.hide,0);assert.ok(calls.bounds<=2,JSON.stringify(calls));
        assert.equal(await native.evaluate("globalThis.__continuityMarker==='same-explore-document'&&performance.timeOrigin==="+timeOrigin),true,'returning recreated or reloaded exploration');
      }
      // The rail never shows a scrollbar track beside the native page.
      const scrollbar=await cdp.evaluate("(()=>{const s=getComputedStyle(document.querySelector('.app-rail'));return {width:s.scrollbarWidth}})()");
      assert.equal(scrollbar.width,'none');
      checks.push({name:'four-route-explore-return-keeps-sidebar-and-first-frame-geometry-document-and-bounded-ipc',scrollbar});
      await cdp.evaluate("window.sanctuary.focusExplore()");
      await waitFor("document.hasFocus()",native);
      await mainInspector.sendHostKey(nativeContents.id, "K", ["control"]);
      await fill('.quick-actions-search', '任务与进度');
      await key('Enter', 'Enter');
      await waitFor("Boolean(document.querySelector('.task-center-dialog'))");
      await waitFor(`!${visibleNativeView}`, mainInspector);
      await checkLayout('task-center-native-900', true);
      await key('Escape', 'Escape');
      await waitFor(visibleNativeView, mainInspector);
      await waitFor("document.hasFocus()", native);
      checks.push({name:'task-center-from-native-quick-actions-hides-view-and-restores-focus'});

      // Use production rule persistence; only hold/fail a reply and provide two disposable
      // model identities to exercise the contextual picker without downloading weights.
      await mainInspector.evaluate(`(async () => {
        const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
        const channels=['filters:update','models:snapshot','models:activate'];
        const originals=new Map(channels.map(channel=>[channel,ipc._invokeHandlers.get(channel)]));
        // Direct handler call: pass an event from the app window so the IPC sender guard accepts it.
        const app=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows()[0].webContents;
        const snapshot=await originals.get('models:snapshot')({sender:app,senderFrame:app.mainFrame});
        const template=snapshot.models.find(model=>model.capability==='element_tagging');
        if(!template) throw new Error('No production element model descriptor');
        const state=globalThis.__contextualProtectionSmoke={originals,saveMode:'hold',saveCalls:0,release:null,active:'smoke-engine-a',failModel:false,holdModel:false,releaseModel:null,modelCalls:[]};
        for(const channel of channels) ipc.removeHandler(channel);
        ipc.handle('models:snapshot',()=>({...snapshot,models:['a','b'].map(suffix=>({...template,
          id:'smoke-engine-'+suffix,name:suffix==='a'?'隔离识别模型 A':'隔离识别模型 B · 测试长名称',
          installed:true,bundled:true,active:state.active==='smoke-engine-'+suffix})),activeByCapability:{element_tagging:state.active}}));
        ipc.handle('models:activate',(_event,id)=>{
          state.modelCalls.push(id);
          if(state.failModel) {state.failModel=false;throw new Error('隔离模型切换失败');}
          if(!['smoke-engine-a','smoke-engine-b'].includes(id)) throw new Error('Unexpected model test identity');
          const commit=()=>{state.active=id;return {modelId:id,runtimeRestarted:true};};
          if(state.holdModel){state.holdModel=false;return new Promise(resolve=>{state.releaseModel=()=>{state.releaseModel=null;resolve(commit());};});}
          return commit();
        });
        ipc.handle('filters:update',(...args)=>{
          state.saveCalls++;
          if(state.saveMode==='fail') {state.saveMode='normal';throw new Error('隔离规则保存失败');}
          if(state.saveMode!=='hold') return originals.get('filters:update')(...args);
          state.saveMode='normal';
          return new Promise((resolve,reject)=>{state.release=()=>{
            state.release=null;try{resolve(originals.get('filters:update')(...args));}catch(error){reject(error);}
          };});
        });
        return true;
      })()`);
      await click('.explore-protection-trigger');
      await waitFor("Boolean(document.querySelector('.protection-rule-row input:not(:disabled)'))");
      await waitFor(`!${visibleNativeView}`, mainInspector);
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.explore-protection-panel input[type=range]'))"), false);
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.explore-protection-panel .tag-list'))"), false);
      assert.equal(await cdp.evaluate("document.activeElement?.className"), 'protection-panel-close');
      await checkLayout('protection-900', true);
      checks.push({name:'contextual-protection-narrow-hides-native-and-defaults-to-simple-controls'});

      const originalRule=await cdp.evaluate("(() => {const row=document.querySelector('.protection-rule-row');return {id:row.dataset.ruleId,checked:row.querySelector('input').checked};})()");
      await click('.protection-rule-row input');
      await waitFor("typeof globalThis.__contextualProtectionSmoke.release==='function'",mainInspector);
      assert.equal(await cdp.evaluate("document.querySelector('.protection-rule-row input').checked"),originalRule.checked);
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.protection-rule-row input')).every(input=>input.disabled)"),true);
      // Closing and reopening cannot unlock a still-pending mutation.
      await click('.protection-panel-close');
      await click('.explore-protection-trigger');
      await waitFor("Boolean(document.querySelector('.protection-current-model')?.textContent.includes('隔离'))");
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.protection-rule-row input')).every(input=>input.disabled)"),true);
      await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.release();true");
      await waitFor(`document.querySelector('.protection-rule-row input')?.checked===${!originalRule.checked} && !document.querySelector('.protection-rule-row input').disabled`);
      assert.equal(await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.saveCalls"),1);
      assert.equal(await cdp.evaluate(`(async()=> (await window.sanctuary.listFilterSettings()).find(rule=>rule.groupId===${JSON.stringify(originalRule.id)}).enabled)()`),!originalRule.checked);
      checks.push({name:'pending-rule-save-survives-panel-remount-without-false-success-or-second-write'});

      await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.saveMode='fail';true");
      await click('.protection-rule-row input');
      await waitFor("document.querySelector('.explore-protection-panel .app-notice')?.textContent.includes('隔离规则保存失败')");
      assert.equal(await cdp.evaluate("document.querySelector('.protection-rule-row input').checked"),!originalRule.checked);
      await click('.protection-rule-row input');
      await waitFor(`document.querySelector('.protection-rule-row input')?.checked===${originalRule.checked} && !document.querySelector('.protection-rule-row input').disabled`);
      checks.push({name:'failed-rule-save-keeps-persisted-state-and-retry-succeeds'});

      await click('[data-disclosure="explore-models"] > button');
      await fill('[aria-label="探索识别模型"] select','smoke-engine-b');
      await waitFor("document.querySelector('.protection-current-model')?.textContent.includes('模型 B')");
      await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.failModel=true;true");
      await fill('[aria-label="探索识别模型"] select','smoke-engine-a');
      await waitFor("document.querySelector('.explore-protection-panel .app-notice')?.textContent.includes('隔离模型切换失败')");
      assert.equal(await cdp.evaluate("document.querySelector('[aria-label=\"探索识别模型\"] select').value"),'smoke-engine-b');
      await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.holdModel=true;true");
      await fill('[aria-label="探索识别模型"] select','smoke-engine-a');
      await waitFor("typeof globalThis.__contextualProtectionSmoke.releaseModel==='function'",mainInspector);
      await click('.protection-panel-close');
      await click('.explore-protection-trigger');
      await waitFor("document.querySelector('.protection-current-model')?.textContent.includes('模型 B')");
      assert.equal(await cdp.evaluate("Array.from(document.querySelectorAll('.protection-rule-row input')).every(input=>input.disabled)"),true);
      await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.releaseModel();true");
      await waitFor("document.querySelector('.protection-current-model')?.textContent.includes('模型 A') && !document.querySelector('.protection-rule-row input').disabled");
      assert.deepEqual(await mainInspector.evaluate("globalThis.__contextualProtectionSmoke.modelCalls"),['smoke-engine-b','smoke-engine-a','smoke-engine-a']);
      checks.push({name:'explore-model-picker-is-contextual-and-failed-switch-retains-current-model'});

      await click('[data-disclosure="explore-advanced"] > button');
      await click('.protection-advanced-rule summary');
      const threshold=await cdp.evaluate("document.querySelector('.protection-advanced-rule input[type=range]').value");
      const nextThreshold=Number(threshold)>.5?.25:.75;
      await fill('.protection-advanced-rule input[type=range]',String(nextThreshold));
      assert.equal(await cdp.evaluate(`(async()=> (await window.sanctuary.listFilterSettings()).find(rule=>rule.groupId===${JSON.stringify(originalRule.id)}).minimumConfidence)()`),Number(threshold));
      await click('.protection-advanced-rule .ui-button');
      await waitFor(`!document.querySelector('.protection-rule-row input').disabled && document.querySelector('.protection-advanced-rule input[type=range]').value==='${nextThreshold}'`);
      assert.equal(await cdp.evaluate(`(async()=> (await window.sanctuary.listFilterSettings()).find(rule=>rule.groupId===${JSON.stringify(originalRule.id)}).minimumConfidence)()`),nextThreshold);
      checks.push({name:'advanced-threshold-is-explicit-and-persists-only-after-apply'});
      await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:229,bubbles:true}))");
      assert.equal(await cdp.evaluate("Boolean(document.querySelector('.explore-protection-panel'))"),true);
      await key('Escape','Escape');
      await waitFor("!document.querySelector('.explore-protection-panel')");
      await waitFor(visibleNativeView,mainInspector);
      await waitFor("document.hasFocus()",native);
      checks.push({name:'protection-ime-escape-and-close-restore-native-focus'});

      await cdp.send('Emulation.clearDeviceMetricsOverride');
      for(const [width,height,zoom] of [[1280,720,1],[900,620,1],[1280,720,1.25],[1280,720,1.5]]) {
        await mainInspector.evaluate(`(() => {
          const window=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows()[0];
          window.setContentSize(${width},${height});window.webContents.setZoomFactor(${zoom});return true;
        })()`);
        await waitFor(`Math.abs(innerWidth-${width/zoom})<3`);
        await cdp.evaluate("(async()=> {await Promise.allSettled(document.querySelector('.app-shell').getAnimations().map(animation=>animation.finished));await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));})()");
        await mainInspector.evaluate("Object.assign(__exploreTransitions,{show:0,hide:0,bounds:0});true");
        await click('.explore-protection-trigger');
        await waitFor("Boolean(document.querySelector('.protection-rule-row input:not(:disabled)'))");
        const narrow=await cdp.evaluate("innerWidth<=1100");
        await waitFor(narrow?`!${visibleNativeView}`:visibleNativeView,mainInspector);
        if(!narrow) {
          const rect=await cdp.evaluate("(() => {const r=document.querySelector('.explore-surface').getBoundingClientRect(),p=document.querySelector('.explore-protection-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,panelLeft:p.left,panelRight:p.right};})()");
          const nativeBounds=await mainInspector.evaluate(`(() => {const w=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows()[0];return w.contentView.children.find(view=>view.webContents?.id===${nativeContents.id}).getBounds();})()`);
          for(const field of ['x','y','width','height']) assert.ok(Math.abs(nativeBounds[field]-rect[field]*zoom)<=2,`native ${field} mismatch ${JSON.stringify({rect,nativeBounds,zoom})}`);
          assert.ok(nativeBounds.x+nativeBounds.width<=rect.panelLeft*zoom+2,'native view overlapped protection controls');
        }
        await checkLayout(`protection-real-${width}-zoom-${zoom}`,true);
        await click('.protection-panel-close');
        await waitFor(visibleNativeView,mainInspector);
        const rect=await cdp.evaluate("(() => {const r=document.querySelector('.explore-surface').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
        await waitFor(`(() => {const w=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows()[0];const r=w.contentView.children.find(view=>view.webContents?.id===${nativeContents.id}).getBounds();return ['x','y','width','height'].every(field=>Math.abs(r[field]-${JSON.stringify(rect)}[field]*${zoom})<=2);})()`,mainInspector);
        if(!narrow) {
          const calls=await mainInspector.evaluate('({...__exploreTransitions})');
          assert.equal(calls.show,0,'wide protection panel recreated the native show lifecycle');assert.equal(calls.hide,0,'wide protection panel flickered the native view');
        }
      }
      checks.push({name:'real-window-and-100-125-150-percent-ui-zoom-keep-native-view-outside-controls'});
      await mainInspector.evaluate(`(() => {
        const w=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows()[0];
        w.webContents.setZoomFactor(1);w.setContentSize(900,620);return true;
      })()`);
      await click('[data-nav="settings"]');
      await waitFor("Boolean(document.querySelector('.settings-navigation'))");
      await waitFor(`!${visibleNativeView}`, mainInspector);
      await click(".rail-protection");
      await waitFor("Boolean(document.querySelector('.shield-status.protection-bypassed button'))");
      await click(".shield-status.protection-bypassed button");
      await waitFor("!document.querySelector('.rail-protection')?.getAttribute('aria-label').startsWith('本次无保护浏览')");
      assert.notEqual(await cdp.evaluate("(async () => (await window.sanctuary.getExploreState()).protectionStatus)()"), "bypassed");
      checks.push({ name: "offline-native-exploration-bounds-hide-and-resume", viewport, bounds });
      await click('[data-nav="gallery"]');
    } finally { native.close(); }
    const homeImportPath = join(userData, "首页导入.png");
    const duplicateImportPath = join(userData, "重复图片.png");
    const failedImportPath = join(userData, "待修复.png");
    await writeFile(homeImportPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    await writeFile(duplicateImportPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    await writeFile(failedImportPath, "not an image");
    await mainInspector.evaluate(`(() => {
      const dialog=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog;
      const state=globalThis.__homeImportSmoke={original:dialog.showOpenDialog,calls:0};
      const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
      state.thumbOriginal=ipc._invokeHandlers.get('library:generate-thumbnails');state.failNextThumb=true;
      ipc.removeHandler('library:generate-thumbnails');ipc.handle('library:generate-thumbnails',(...args)=>{
        if(state.failNextThumb){state.failNextThumb=false;return {attempted:6,generated:0,reused:0,failedAssetIds:['fixture-broken-thumbnail']};}
        return state.thumbOriginal(...args);
      });
      dialog.showOpenDialog=async()=>++state.calls===1?{canceled:false,filePaths:${JSON.stringify([homeImportPath, duplicateImportPath, failedImportPath])}}:{canceled:true,filePaths:[]};
    })()`);
    try {
      const beforeImport = await cdp.evaluate("(async () => (await window.sanctuary.queryWorks({})).total)()");
      await click('[data-nav="home"]');
      await click('.home-library-entry button');
      await waitFor("Boolean(document.querySelector('.import-images-dialog'))");
      await cdp.evaluate("(async()=>{const a=await window.sanctuary.getAppearancePreferences();await window.sanctuary.updateAppearancePreferences({...a,colorScheme:'dark'});})()");
      await waitFor("matchMedia('(prefers-color-scheme: dark)').matches");
      const importTheme = await cdp.evaluate("(()=>{const n=document.querySelector('.import-images-dialog');return {color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor};})()");
      assert.notEqual(importTheme.color, importTheme.background, 'dark import dialog lost text contrast');
      await checkLayout('import-confirmation-dark-900', true);
      await checkButtonContrast('.import-images-dialog .ui-button--secondary');
      await cdp.evaluate("(async()=>{const a=await window.sanctuary.getAppearancePreferences();await window.sanctuary.updateAppearancePreferences({...a,colorScheme:'light'});})()");
      assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.queryWorks({})).total)()"), beforeImport);
      await fill('.import-images-dialog select', 'fixture-collection');
      await click('[data-import-action="start"]');
      await waitFor("document.querySelector('[data-nav=gallery]')?.getAttribute('aria-current')==='page'");
      await waitFor(`(async () => (await window.sanctuary.queryWorks({})).total === ${beforeImport + 1})()`);
      await waitFor("document.querySelector('.import-images-dialog h2')?.textContent==='导入结果'");
      assert.equal(await cdp.evaluate("document.querySelector('.import-images-dialog').textContent.includes('新增 1')"), true);
      assert.equal(await cdp.evaluate("document.querySelector('.import-images-dialog').textContent.includes('已存在 1 · 失败 1')"), true);
      assert.equal(await cdp.evaluate(`(async()=> (await window.sanctuary.queryWorks({collectionId:'fixture-collection'})).items.some(w=>w.title==='首页导入.png'))()`), true);
      await checkLayout('import-result-narrow-window', true);
      await key('Escape', 'Escape');
      await click('[aria-label="任务与进度"]');
      await waitFor("document.querySelector('[data-task-kind=import]')?.textContent.includes('失败 1')");
      await waitFor("document.querySelector('[data-task-kind=thumbnails]')?.textContent.includes('失败 1')");
      await click('[data-task-kind="thumbnails"] button');
      await waitFor("!document.querySelector('[data-task-kind=thumbnails]')?.textContent.includes('失败 1')");
      await checkLayout('task-center-import-and-thumbnail-retry-900', true);
      await click('[data-task-kind="import"] button');
      await waitFor("Boolean(document.querySelector('[data-import-action=retry]'))");
      assert.equal(await mainInspector.evaluate('__homeImportSmoke.calls'), 1, 'returning to import opened another picker');
      await writeFile(failedImportPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
      await click('[data-import-action="retry"]');
      await waitFor("document.querySelector('.import-images-dialog').textContent.includes('已存在 2 · 失败 0')");
      assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.queryWorks({})).total)()"), beforeImport+1);
      checks.push({name:'import-preview-album-content-deduplication-and-failed-only-retry'});
      await key('Escape', 'Escape');
      await click('[data-nav="home"]');
      await click('.home-library-entry button');
      await waitFor("__homeImportSmoke.calls===2", mainInspector);
      await waitFor("Boolean(document.querySelector('.home-library-entry button')) && !document.querySelector('.home-library-entry button').disabled");
      assert.equal(await cdp.evaluate("(async () => (await window.sanctuary.queryWorks({})).total)()"), beforeImport+1);
      checks.push({name:"home-import-success-navigation-and-cancellation"});
    } finally {
      await mainInspector.evaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');e.dialog.showOpenDialog=__homeImportSmoke.original;e.ipcMain.removeHandler('library:generate-thumbnails');e.ipcMain.handle('library:generate-thumbnails',__homeImportSmoke.thumbOriginal);delete globalThis.__homeImportSmoke;return true;})()");
    }
    const taskJob = await cdp.evaluate("window.sanctuary.createAnalysisJob({type:'selected',workIds:['fixture-work']},'fixture')");
    const taskState = await cdp.evaluate("window.sanctuary.getExploreState()");
    taskState.download = {...taskState.download,phase:'partial',scope:'current',totalArtworks:2,completedArtworks:1,failedArtworks:1,message:'夹具：部分完成',lastFailure:'夹具：网络读取失败'};
    await mainInspector.evaluate(`process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows()[0].webContents.send('explore:state-changed',${JSON.stringify(taskState)})`);
    await click('[aria-label="任务与进度"]');
    await waitFor(`Boolean(document.querySelector('[data-task-id="${taskJob.id}"]'))`);
    await waitFor("document.querySelector('[data-task-kind=download]')?.textContent.includes('成功 1 · 失败 1')");
    assert.equal(await cdp.evaluate("document.querySelector('[data-task-kind=download]').textContent.includes('停止任务')"), false);
    await cdp.evaluate(`Array.from(document.querySelectorAll('[data-task-id="${taskJob.id}"] button')).find(b=>b.textContent.includes('停止任务')).click()`);
    await waitFor(`document.querySelector('[data-task-id="${taskJob.id}"]')?.textContent.includes('已停止')`);
    assert.equal(await cdp.evaluate(`(async()=> (await window.sanctuary.listAnalysisJobs()).find(j=>j.id==='${taskJob.id}').status)()`), 'cancelled');
    await checkLayout('task-center-download-and-cancelled-analysis-900', true);
    await cdp.evaluate(`Array.from(document.querySelectorAll('[data-task-id="${taskJob.id}"] button')).find(b=>b.textContent.includes('回到图库')).click()`);
    await waitFor("document.querySelector('.app-rail [aria-current=\"page\"]')?.dataset.nav === 'gallery' && !document.querySelector('.task-center-dialog')");
    checks.push({name:'task-center-global-download-progress-queued-cancellation-and-gallery-return'});
    console.log(JSON.stringify({ status: "passed", checkCount:checks.length, checks, screenshots: outputDir }, null, 2));
  } finally { cdp.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  if (mainInspector) {
    try {
      await mainInspector.evaluate(`(() => {
        const state=globalThis.__contextualProtectionSmoke;if(!state)return true;
        const ipc=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain;
        state.release?.();state.releaseModel?.();for(const [channel,handler] of state.originals){ipc.removeHandler(channel);ipc.handle(channel,handler);}
        delete globalThis.__contextualProtectionSmoke;return true;
      })()`);
      await mainInspector.evaluate(`(() => {
        const state = globalThis.__navigationShowDelay;
        if (!state) return true;
        const ipc = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').ipcMain;
        ipc.removeHandler('explore:show');
        ipc.handle('explore:show', state.original);
        state.release?.();
        delete globalThis.__navigationShowDelay;
        return true;
      })()`);
    } catch {}
  }
  mainInspector?.close();
  child.kill();
  await new Promise((done) => {
    if (child.exitCode !== null) done();
    else { child.once("exit", done); setTimeout(done, 2000); }
  });
  const resolvedUserData = resolve(userData);
  if (!resolvedUserData.startsWith(`${temporaryRoot}${sep}sanctuary-navigation-`)) throw new Error("Unexpected temporary directory");
  await rm(resolvedUserData, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
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
