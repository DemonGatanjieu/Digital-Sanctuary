import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";

const port = 9255;
const outputDir = resolve("docs/reviews/element-inspector-polish/2026-08-24/evidence");
await mkdir(outputDir, { recursive: true });

const userData = await mkdtemp(join(tmpdir(), "sanctuary-inspector-audit-"));
console.log(`[audit] Isolated userData: ${userData}`);
console.log(`[audit] Output screenshot dir: ${outputDir}`);

// Pure JS Valid PNG Generator (CRC32 + PNG Chunks)
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function generatePngBuffer(width, height, r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  const rowLen = 1 + width * 3;
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(rowLen);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      const grad = Math.floor((x / width) * 40);
      row[offset] = Math.min(255, r + grad);
      row[offset + 1] = Math.min(255, g + grad);
      row[offset + 2] = Math.min(255, b + grad);
    }
    rawRows.push(row);
  }

  const idatData = deflateSync(Buffer.concat(rawRows));
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idatData),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

// 1. Create Fixture Images
const imageDir = join(userData, "fixtures");
await mkdir(imageDir, { recursive: true });

const img1Path = join(imageDir, "art1.png");
await writeFile(img1Path, generatePngBuffer(600, 800, 30, 100, 200));

const img2Path = join(imageDir, "art2.png");
await writeFile(img2Path, generatePngBuffer(600, 800, 200, 50, 120));

// 2. Setup SQLite Database with WD Tagger Labels
const dbPath = join(userData, "library.db");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  INSERT OR REPLACE INTO schema_migrations VALUES (1, datetime('now')), (2, datetime('now')), (3, datetime('now')), (4, datetime('now')), (5, datetime('now'));

  CREATE TABLE IF NOT EXISTS artworks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    file_name TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    assessment_json TEXT,
    decision_json TEXT,
    source_platform TEXT,
    source_work_id TEXT,
    source_page_index INTEGER,
    author_id TEXT,
    author_name TEXT,
    work_title TEXT
  );

  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_url TEXT,
    avatar_local_path TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    source_platform TEXT,
    source_work_id TEXT,
    artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    work_type TEXT NOT NULL CHECK (work_type IN ('illustration', 'manga', 'ugoira', 'local', 'unknown')),
    published_at TEXT,
    bookmarked_at TEXT,
    saved_at TEXT NOT NULL,
    last_viewed_at TEXT,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    cover_asset_id TEXT,
    ownership TEXT NOT NULL CHECK (ownership IN ('managed', 'external')),
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    legacy_artwork_id TEXT UNIQUE REFERENCES artworks(id) ON DELETE SET NULL,
    page_index INTEGER NOT NULL CHECK (page_index >= 0),
    path TEXT NOT NULL COLLATE NOCASE UNIQUE,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'ugoira', 'unknown')),
    extension TEXT,
    width INTEGER,
    height INTEGER,
    byte_length INTEGER,
    content_hash TEXT,
    thumbnail_path TEXT,
    file_state TEXT NOT NULL CHECK (file_state IN ('available', 'missing', 'trashed', 'error')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (work_id, page_index)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_artwork_id TEXT REFERENCES artworks(id) ON DELETE SET NULL,
    cover_work_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collection_works (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (collection_id, work_id)
  );

  CREATE TABLE IF NOT EXISTS saved_collection_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    query_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS element_filter_settings (
    group_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    minimum_confidence REAL NOT NULL CHECK (minimum_confidence BETWEEN 0.05 AND 0.95),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS remote_image_reviews (
    normalized_url TEXT NOT NULL,
    content_hash TEXT,
    engine TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    rules_fingerprint TEXT NOT NULL,
    assessment_json TEXT NOT NULL,
    decision_json TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL,
    PRIMARY KEY (normalized_url, engine, engine_version, rules_fingerprint)
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_element_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('hide', 'blur')),
    threshold REAL NOT NULL CHECK (threshold BETWEEN 0.05 AND 0.95),
    tags_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comfyui_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    source_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    positive_prompt TEXT NOT NULL,
    negative_prompt TEXT NOT NULL,
    remote_prompt_id TEXT,
    output_work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    workflow_summary_json TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS generation_provenance (
    output_work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
    source_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('comfyui')),
    template_name TEXT NOT NULL,
    positive_prompt TEXT NOT NULL,
    negative_prompt TEXT NOT NULL,
    workflow_summary_json TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();

// Seed Rich Labels for WD Tagger assessment
const assessmentData = {
  status: "complete",
  engine: "wd-swinv2-tagger-v3",
  engineVersion: "3.0.0",
  labels: {
    solo: 0.98,
    "1girl": 0.96,
    cat_ears: 0.89,
    blue_hair: 0.84,
    long_hair: 0.81,
    smile: 0.76,
    looking_at_viewer: 0.72,
    swimsuit: 0.65,
    bikini: 0.61,
    barefoot: 0.54,
    beach: 0.48,
    ocean: 0.44,
    cloudy_sky: 0.38,
    sunlight: 0.32,
    watermark: 0.28,
    artist_name: 0.22,
    simple_background: 0.14,
    blurry: 0.08
  },
  elapsedMs: 68
};

const assessmentJson = JSON.stringify(assessmentData);

db.prepare(`INSERT OR REPLACE INTO artists (id, name, avatar_url, updated_at) VALUES (?, ?, ?, ?)`).run(
  "artist-1", "Hoshino Luna 🌸", null, now
);

db.prepare(`INSERT OR REPLACE INTO works (id, source_platform, source_work_id, artist_id, title, work_type, published_at, bookmarked_at, saved_at, page_count, ownership, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "work-demo-1", "pixiv", "118239401", "artist-1", "碧海晴空下的猫耳少女 (Multi-Tag Demo)", "illustration", now, now, now, 2, "managed", now, now
);

db.prepare(`INSERT OR REPLACE INTO assets (id, work_id, page_index, path, media_type, extension, width, height, byte_length, file_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "asset-demo-1", "work-demo-1", 0, img1Path, "image", ".png", 600, 800, 50000, "available", now, now
);

db.prepare(`INSERT OR REPLACE INTO assets (id, work_id, page_index, path, media_type, extension, width, height, byte_length, file_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "asset-demo-2", "work-demo-1", 1, img2Path, "image", ".png", 600, 800, 50000, "available", now, now
);

db.prepare(`INSERT OR REPLACE INTO remote_image_reviews (normalized_url, engine, engine_version, rules_fingerprint, assessment_json, decision_json, byte_length, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "pixiv:118239401:0", "wd-swinv2-tagger-v3", "3.0.0", "fp-default", assessmentJson, JSON.stringify({ action: "allow", reasons: [] }), 50000, now
);

db.prepare(`INSERT OR REPLACE INTO remote_image_reviews (normalized_url, engine, engine_version, rules_fingerprint, assessment_json, decision_json, byte_length, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "pixiv:118239401:1", "wd-swinv2-tagger-v3", "3.0.0", "fp-default", assessmentJson, JSON.stringify({ action: "allow", reasons: [] }), 50000, now
);

db.close();
console.log(`[audit] Seeded mock work-demo-1 with 18 WD Tagger labels.`);

// 3. Launch Electron with CDP
const electron = resolve("node_modules/electron/dist/electron.exe");
const entry = resolve("apps/desktop/out/main/index.js");

const child = spawn(
  electron,
  [entry, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--window-size=1440,900"],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: false }
);

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

async function waitForRenderer(timeoutMs = 15000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const target = list.find((t) => t.type === "page" && t.url.includes("index.html"));
        if (target) return target;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Renderer did not start on port ${port} within ${timeoutMs}ms. Stderr: ${stderr}`);
}

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });

  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", rej, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return {
    send,
    evaluate: async (expression) => {
      const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      }
      return res.result?.value;
    },
    captureScreenshot: async (filename) => {
      const res = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const buffer = Buffer.from(res.data, "base64");
      const path = join(outputDir, filename);
      await writeFile(path, buffer);
      console.log(`[audit-shot] Saved ${filename} (${buffer.length} bytes)`);
      return { path, filename, bytes: buffer.length };
    },
    setViewport: async (width, height) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await send("Emulation.setVisibleSize", { width, height });
    },
    close: () => socket.close()
  };
}

try {
  const target = await waitForRenderer();
  console.log(`[audit] Attached to Renderer: ${target.title}`);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  // Wait for initial render
  await new Promise((r) => setTimeout(r, 2500));

  // Click work cover button to open CinemaStage
  const openedWork = await cdp.evaluate(`
    (function() {
      const coverBtn = document.querySelector(".work-cover-button");
      if (coverBtn) {
        coverBtn.click();
        return true;
      }
      return false;
    })();
  `);
  console.log(`[audit] Clicked work cover button: ${openedWork}`);

  await new Promise((r) => setTimeout(r, 1200));

  // Click '元素透视' button in cinema stage toolbar
  const openedInspector = await cdp.evaluate(`
    (function() {
      const buttons = Array.from(document.querySelectorAll(".cinema-controls-group button, header button"));
      const inspectBtn = buttons.find(b => b.textContent?.includes("元素透视") || b.title?.includes("透视"));
      if (inspectBtn) {
        inspectBtn.click();
        return true;
      }
      return false;
    })();
  `);
  console.log(`[audit] Clicked '元素透视' button: ${openedInspector}`);

  await new Promise((r) => setTimeout(r, 1500));

  // 1. Tab 1: 看懂画面 (Features) - Desktop 1440x900
  await cdp.setViewport(1440, 900);
  await new Promise((r) => setTimeout(r, 600));

  // Switch to features tab
  await cdp.evaluate(`
    (function() {
      const tabs = Array.from(document.querySelectorAll(".inspector-section-tabs button"));
      if (tabs[0]) tabs[0].click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 500));
  await cdp.captureScreenshot("01_features_desktop_1440.png");

  // Check horizontal overflow
  const hOverflowFeatures = await cdp.evaluate(`
    (function() {
      const drawer = document.querySelector(".element-inspector-drawer");
      return drawer ? drawer.scrollWidth > drawer.clientWidth : false;
    })();
  `);
  console.log(`[audit] Tab 1 Desktop Horizontal Overflow: ${hOverflowFeatures}`);

  // 2. Tab 1: 看懂画面 (Features) - Narrow 720x850
  await cdp.setViewport(720, 850);
  await new Promise((r) => setTimeout(r, 600));
  await cdp.captureScreenshot("02_features_narrow_720.png");

  const hOverflowNarrow = await cdp.evaluate(`
    (function() {
      const drawer = document.querySelector(".element-inspector-drawer");
      return drawer ? drawer.scrollWidth > drawer.clientWidth : false;
    })();
  `);
  console.log(`[audit] Tab 1 Narrow Horizontal Overflow: ${hOverflowNarrow}`);

  // 3. Tab 2: 整理提示词 (Prompt Workbench) - Desktop 1440x900
  await cdp.setViewport(1440, 900);
  await cdp.evaluate(`
    (function() {
      const tabs = Array.from(document.querySelectorAll(".inspector-section-tabs button"));
      if (tabs[1]) tabs[1].click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 800));
  await cdp.captureScreenshot("03_prompt_workbench_desktop_1440.png");

  // 4. Tab 2: 整理提示词 (Prompt Workbench) - Narrow 720x850
  await cdp.setViewport(720, 850);
  await new Promise((r) => setTimeout(r, 600));
  await cdp.captureScreenshot("04_prompt_workbench_narrow_720.png");

  // 5. Tab 3: 设置探索拦截 (Filter / Blacklist) - Desktop 1440x900
  await cdp.setViewport(1440, 900);
  await cdp.evaluate(`
    (function() {
      const tabs = Array.from(document.querySelectorAll(".inspector-section-tabs button"));
      if (tabs[2]) tabs[2].click();
      // Select 2 tags
      const pills = Array.from(document.querySelectorAll(".inspector-tag-pill"));
      if (pills[0]) pills[0].click();
      if (pills[2]) pills[2].click();
    })();
  `);
  await new Promise((r) => setTimeout(r, 600));
  await cdp.captureScreenshot("05_filter_blacklist_desktop_1440.png");

  // 6. Tab 3: 设置探索拦截 (Filter / Blacklist) - Narrow 720x850
  await cdp.setViewport(720, 850);
  await new Promise((r) => setTimeout(r, 600));
  await cdp.captureScreenshot("06_filter_blacklist_narrow_720.png");

  // 7. Search filter test on Tab 1 using native value setter for React
  await cdp.setViewport(1440, 900);
  await cdp.evaluate(`
    (function() {
      const tabs = Array.from(document.querySelectorAll(".inspector-section-tabs button"));
      if (tabs[0]) tabs[0].click();
      const input = document.querySelector(".inspector-search-input");
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, 'background');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })();
  `);
  await new Promise((r) => setTimeout(r, 600));
  await cdp.captureScreenshot("07_search_filtered_state.png");

  // 8. Advanced Settings Open on Tab 2
  await cdp.evaluate(`
    (function() {
      const tabs = Array.from(document.querySelectorAll(".inspector-section-tabs button"));
      if (tabs[1]) tabs[1].click();
      const details = document.querySelector(".prompt-advanced-settings");
      if (details && !details.open) {
        details.open = true;
      }
    })();
  `);
  await new Promise((r) => setTimeout(r, 600));
  await cdp.captureScreenshot("08_prompt_advanced_settings.png");

  console.log(`[audit] All screenshot scenarios captured successfully!`);
  await cdp.close();
} catch (err) {
  console.error(`[audit-error]`, err);
} finally {
  child.kill();
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
}
