import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";

// Viewport sizes
const VIEWPORTS = {
  W1: { width: 900, height: 620, name: "900x620_min" },
  W2: { width: 1280, height: 720, name: "1280x720_laptop" },
  W3: { width: 1440, height: 900, name: "1440x900_baseline" },
  W4: { width: 1920, height: 1080, name: "1920x1080_fullhd" }
};

const port = 9244;
const outputDir = resolve(".tmp/visual-audit/2026-08-15");
await mkdir(outputDir, { recursive: true });

const userData = await mkdtemp(join(tmpdir(), "sanctuary-visual-audit-"));
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
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  const rowLen = 1 + width * 3;
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(rowLen);
    row[0] = 0; // Filter none
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

// Write Fixture Images
const images = [];
const imageConfigs = [
  { id: "img-land-1", w: 400, h: 225, r: 59, g: 130, b: 246, label: "星河之下 · 横版", badge: "LANDSCAPE" },
  { id: "img-port-1", w: 250, h: 400, r: 236, g: 72, b: 153, label: "夜色魔法使 🌸 · 竖版", badge: "PORTRAIT" },
  { id: "img-sq-1", w: 300, h: 300, r: 139, g: 92, b: 246, label: "赛博霓虹猫猫", badge: "SQUARE" },
  { id: "img-tall-1", w: 200, h: 600, r: 16, g: 185, b: 129, label: "超长漫条篇目 №01", badge: "ULTRA-TALL" },
  { id: "img-multi-p0", w: 300, h: 300, r: 245, g: 158, b: 11, label: "画集特装版 (P1/3)", badge: "PAGE 1" },
  { id: "img-multi-p1", w: 300, h: 300, r: 234, g: 179, b: 8, label: "画集特装版 (P2/3)", badge: "PAGE 2" },
  { id: "img-multi-p2", w: 300, h: 300, r: 202, g: 138, b: 4, label: "画集特装版 (P3/3)", badge: "PAGE 3" },
  { id: "img-longtitle", w: 300, h: 300, r: 99, g: 102, b: 241, label: "这是一个极其漫长极其漫长用来测试截断换行与卡片边框溢出的标题示例", badge: "LONG-TEXT" },
  { id: "avatar-1", w: 100, h: 100, r: 168, g: 85, b: 247, label: "Luna", badge: "AVATAR" }
];

for (let i = 0; i < 55; i++) {
  const palette = [
    [59, 130, 246], [236, 72, 153], [139, 92, 246],
    [16, 185, 129], [245, 158, 11], [6, 182, 212], [99, 102, 241]
  ];
  const [r, g, b] = palette[i % palette.length];
  imageConfigs.push({
    id: `img-batch-${i}`,
    w: 300,
    h: 300 + (i % 4) * 40,
    r, g, b,
    label: `画廊收录作品 #${i + 1}`,
    badge: `#${i + 1}`
  });
}

for (const cfg of imageConfigs) {
  const pngPath = resolve(userData, `${cfg.id}.png`);
  const buf = generatePngBuffer(cfg.w, cfg.h, cfg.r, cfg.g, cfg.b);
  await writeFile(pngPath, buf);
  images.push({ ...cfg, path: pngPath });
}

// 2. Setup SQLite Database with Complete Seed Data
const dbPath = join(userData, "library.db");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  INSERT OR REPLACE INTO schema_migrations VALUES (1, datetime('now')), (2, datetime('now')), (3, datetime('now')), (4, datetime('now'));

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

  CREATE TABLE IF NOT EXISTS collection_artworks (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, artwork_id)
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

  CREATE TABLE IF NOT EXISTS analysis_jobs (
    id TEXT PRIMARY KEY,
    scope_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
    engine TEXT NOT NULL,
    work_count INTEGER NOT NULL,
    total_items INTEGER NOT NULL,
    processed_items INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS analysis_asset_results (
    job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped', 'cache_hit')),
    summary_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (job_id, asset_id)
  );

  CREATE TABLE IF NOT EXISTS analysis_job_items (
    job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('cover_asset', 'all_assets')),
    position INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    PRIMARY KEY (job_id, asset_id)
  );

  CREATE TABLE IF NOT EXISTS migration_conflicts (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL,
    source_platform TEXT NOT NULL,
    source_work_id TEXT NOT NULL,
    legacy_artwork_ids TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vision_evaluation_results (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('cover_asset', 'all_assets')),
    kind TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    suite_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('success', 'content_blocked', 'rate_limited', 'auth_error', 'invalid_response', 'network_error', 'unsupported_format')),
    reason_code TEXT,
    summary TEXT,
    provider_id TEXT,
    model_id TEXT,
    evaluator_version TEXT NOT NULL,
    prompt_version TEXT,
    preprocessing_fingerprint TEXT NOT NULL,
    asset_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vision_dimension_scores (
    result_id TEXT NOT NULL REFERENCES vision_evaluation_results(id) ON DELETE CASCADE,
    dimension_key TEXT NOT NULL,
    label TEXT NOT NULL,
    score REAL NOT NULL,
    explanation TEXT,
    PRIMARY KEY (result_id, dimension_key)
  );

  CREATE TABLE IF NOT EXISTS external_vision_requests (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL,
    status_code INTEGER,
    duration_ms INTEGER NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();

// Seed Artist
const insertArtist = db.prepare(`INSERT OR REPLACE INTO artists (id, name, avatar_url, avatar_local_path, updated_at) VALUES (?, ?, ?, ?, ?)`);
insertArtist.run("artist-luna", "Luna 老师", null, resolve(userData, "avatar-1.png"), now);
insertArtist.run("artist-anon", "无头像画师", null, null, now);

// Seed Legacy Artworks Table (for AuthorGalleryGroups & Collections fallback)
const insertArtwork = db.prepare(`INSERT OR REPLACE INTO artworks (id, path, file_name, imported_at, source_platform, source_work_id, source_page_index, author_id, author_name, work_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
insertArtwork.run("asset-land-1", resolve(userData, "img-land-1.png"), "img-land-1.png", now, "pixiv", "90001", 0, "artist-luna", "Luna 老师", "星河之下的梦境");
insertArtwork.run("asset-port-1", resolve(userData, "img-port-1.png"), "img-port-1.png", now, "pixiv", "90002", 0, "artist-luna", "Luna 老师", "夜色魔法使 🌸");
insertArtwork.run("asset-m-0", resolve(userData, "img-multi-p0.png"), "90003_p0.png", now, "pixiv", "90003", 0, "artist-luna", "Luna 老师", "画集特装版全三页");
insertArtwork.run("asset-tall", resolve(userData, "img-tall-1.png"), "90004_p0.png", now, "pixiv", "90004", 0, "artist-anon", "无头像画师", "超长漫条篇目 №01");

// Seed Works & Assets
const insertWork = db.prepare(`INSERT OR REPLACE INTO works (id, source_platform, source_work_id, artist_id, title, work_type, published_at, bookmarked_at, saved_at, last_viewed_at, favorite, page_count, cover_asset_id, ownership, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertAsset = db.prepare(`INSERT OR REPLACE INTO assets (id, work_id, legacy_artwork_id, page_index, path, media_type, extension, width, height, byte_length, content_hash, thumbnail_path, file_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

// Work 1: Landscape
insertWork.run("work-land-1", "pixiv", "90001", "artist-luna", "星河之下的梦境", "illustration", now, null, now, now, 1, 1, "asset-land-1", "managed", null, now, now);
insertAsset.run("asset-land-1", "work-land-1", "asset-land-1", 0, resolve(userData, "img-land-1.png"), "image", ".png", 400, 225, 5000, "h-land", resolve(userData, "img-land-1.png"), "available", now, now);

// Work 2: Portrait
insertWork.run("work-port-1", "pixiv", "90002", "artist-luna", "夜色魔法使 🌸", "illustration", now, null, now, now, 0, 1, "asset-port-1", "managed", null, now, now);
insertAsset.run("asset-port-1", "work-port-1", "asset-port-1", 0, resolve(userData, "img-port-1.png"), "image", ".png", 250, 400, 5000, "h-port", resolve(userData, "img-port-1.png"), "available", now, now);

// Work 3: Multi-page
insertWork.run("work-multi", "pixiv", "90003", "artist-luna", "画集特装版全三页", "manga", now, null, now, now, 1, 3, "asset-m-0", "managed", null, now, now);
insertAsset.run("asset-m-0", "work-multi", "asset-m-0", 0, resolve(userData, "img-multi-p0.png"), "image", ".png", 300, 300, 5000, "h-m0", resolve(userData, "img-multi-p0.png"), "available", now, now);
insertAsset.run("asset-m-1", "work-multi", null, 1, resolve(userData, "img-multi-p1.png"), "image", ".png", 300, 300, 5000, "h-m1", resolve(userData, "img-multi-p1.png"), "available", now, now);
insertAsset.run("asset-m-2", "work-multi", null, 2, resolve(userData, "img-multi-p2.png"), "image", ".png", 300, 300, 5000, "h-m2", resolve(userData, "img-multi-p2.png"), "available", now, now);

// Work 4: Ultra tall
insertWork.run("work-tall", "pixiv", "90004", "artist-anon", "超长漫条篇目 №01", "manga", now, null, now, now, 0, 1, "asset-tall", "managed", null, now, now);
insertAsset.run("asset-tall", "work-tall", "asset-tall", 0, resolve(userData, "img-tall-1.png"), "image", ".png", 200, 600, 5000, "h-tall", resolve(userData, "img-tall-1.png"), "available", now, now);

// Work 5: Long title
insertWork.run("work-long", "pixiv", "90005", "artist-anon", "这是一个极其漫长极其漫长用来测试截断换行与卡片边框溢出的标题示例", "illustration", now, null, now, now, 0, 1, "asset-long", "managed", null, now, now);
insertAsset.run("asset-long", "work-long", null, 0, resolve(userData, "img-longtitle.png"), "image", ".png", 300, 300, 5000, "h-long", resolve(userData, "img-longtitle.png"), "available", now, now);

// 55 batch works
for (let i = 0; i < 55; i++) {
  const wid = `work-batch-${i}`;
  const aid = `asset-batch-${i}`;
  const p = resolve(userData, `img-batch-${i}.png`);
  insertWork.run(wid, "pixiv", `9100${i}`, i % 2 === 0 ? "artist-luna" : "artist-anon", `画廊收录作品 #${i + 1}`, "illustration", now, null, now, now, i % 3 === 0 ? 1 : 0, 1, aid, "managed", null, now, now);
  insertAsset.run(aid, wid, null, 0, p, "image", ".png", 300, 300, 5000, `h-${i}`, p, "available", now, now);
  insertArtwork.run(aid, p, `img-batch-${i}.png`, now, "pixiv", `9100${i}`, 0, i % 2 === 0 ? "artist-luna" : "artist-anon", i % 2 === 0 ? "Luna 老师" : "无头像画师", `画廊收录作品 #${i + 1}`);
}

// Collections
db.prepare(`INSERT OR REPLACE INTO collections (id, name, description, cover_artwork_id, cover_work_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  "col-1", "精选东方系列画集", "涵盖博丽神社与红魔馆经典场景人文画集。", "asset-land-1", "work-land-1", now
);
db.prepare(`INSERT OR REPLACE INTO collections (id, name, description, cover_artwork_id, cover_work_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
  "col-2", "赛博朋克与霓虹特刊", "未来都市高对比度光影美学精选。", "asset-port-1", "work-port-1", now
);

const insertColWork = db.prepare(`INSERT OR REPLACE INTO collection_works (collection_id, work_id, added_at) VALUES (?, ?, ?)`);
insertColWork.run("col-1", "work-land-1", now);
insertColWork.run("col-1", "work-multi", now);
insertColWork.run("col-2", "work-port-1", now);

const insertColArt = db.prepare(`INSERT OR REPLACE INTO collection_artworks (collection_id, artwork_id) VALUES (?, ?)`);
insertColArt.run("col-1", "asset-land-1");
insertColArt.run("col-1", "asset-m-0");
insertColArt.run("col-2", "asset-port-1");

// Saved Collection Views
db.prepare(`INSERT OR REPLACE INTO saved_collection_views (id, name, query_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
  "view-1", "东方与赛博联合精选", JSON.stringify({ matchMode: "any", includedCollectionIds: ["col-1", "col-2"], excludedCollectionIds: [] }), now, now
);

// Vision Evaluation Result (Radar)
db.prepare(`INSERT OR REPLACE INTO vision_evaluation_results (id, work_id, asset_id, scope, kind, suite_id, suite_version, status, reason_code, summary, provider_id, model_id, evaluator_version, prompt_version, preprocessing_fingerprint, asset_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "eval-land-1", "work-land-1", "asset-land-1", "cover_asset", "local_technical_profile", "technical_visual_v1", 1, "success", null, "色彩丰富度极高，明暗跨度与锐度控制平衡优异。", "local", "pillow-numpy", "0.1.0", null, "none", now, now, now
);

const insertScore = db.prepare(`INSERT OR REPLACE INTO vision_dimension_scores (result_id, dimension_key, label, score, explanation) VALUES (?, ?, ?, ?, ?)`);
insertScore.run("eval-land-1", "colorfulness", "色彩丰富度", 88.5, "多色相高饱和分布");
insertScore.run("eval-land-1", "tonal_range", "明暗跨度", 82.0, "直方图动态范围跨度广");
insertScore.run("eval-land-1", "luminance_balance", "亮度均衡", 65.0, "中高调分布合理");
insertScore.run("eval-land-1", "edge_density", "线条密度", 45.0, "背景渐变柔和，边缘分布适度");
insertScore.run("eval-land-1", "sharpness_proxy", "清晰锐度", 90.0, "拉普拉斯方差高，细节清晰");
insertScore.run("eval-land-1", "spatial_balance", "空间分布", 72.0, "主体重心平衡");

db.close();
console.log(`[audit] Seeded 60 works, 2 collections, 1 saved view, 2 artists, 1 radar evaluation.`);

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
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  await new Promise((resolveTask, reject) => {
    socket.addEventListener("open", resolveTask, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolveTask, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolveTask, reject });
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

const auditFindings = [];
const capturedScreenshots = [];

try {
  const target = await waitForRenderer();
  console.log(`[audit] Attached to Renderer: ${target.title}`);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  // Wait for initial render and images
  await new Promise((r) => setTimeout(r, 1800));

  // Audit Helper
  async function auditScenario(scenarioName, setupFn, vpKey = "W3", theme = "default") {
    const vp = VIEWPORTS[vpKey];
    await cdp.setViewport(vp.width, vp.height);

    // Apply theme if not default
    if (theme !== "default") {
      await cdp.evaluate(`window.sanctuary?.setActiveTheme?.('${theme}')`);
      await new Promise((r) => setTimeout(r, 400));
    }

    if (setupFn) {
      await setupFn(cdp);
      await new Promise((r) => setTimeout(r, 600));
    }

    // Inspect Runtime Data
    const runtimeMetrics = await cdp.evaluate(`(() => {
      const html = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(html.scrollWidth, body.scrollWidth);
      const clientWidth = Math.min(html.clientWidth, body.clientWidth);
      const hasHOverflow = scrollWidth > clientWidth + 2;

      const brokenImages = Array.from(document.querySelectorAll('img')).filter(img => img.naturalWidth === 0 && !img.src.startsWith('data:')).map(img => img.src);
      const activeElement = document.activeElement ? { tag: document.activeElement.tagName, className: document.activeElement.className } : null;

      return {
        scrollWidth,
        clientWidth,
        hasHOverflow,
        overflowDelta: scrollWidth - clientWidth,
        brokenImageCount: brokenImages.length,
        brokenImages,
        activeElement
      };
    })()`);

    const filename = `${scenarioName}_${theme}_${vpKey}.png`;
    const shot = await cdp.captureScreenshot(filename);
    capturedScreenshots.push({ ...shot, scenarioName, vpKey, theme, runtimeMetrics });

    if (runtimeMetrics.hasHOverflow) {
      auditFindings.push({
        id: `H-OVERFLOW-${scenarioName}`,
        scenario: scenarioName,
        viewport: vpKey,
        theme,
        detail: `Horizontal overflow detected: scrollWidth (${runtimeMetrics.scrollWidth}px) > clientWidth (${runtimeMetrics.clientWidth}px), delta = ${runtimeMetrics.overflowDelta}px`
      });
    }

    if (runtimeMetrics.brokenImageCount > 0) {
      auditFindings.push({
        id: `BROKEN-IMG-${scenarioName}`,
        scenario: scenarioName,
        viewport: vpKey,
        theme,
        detail: `Broken images detected (${runtimeMetrics.brokenImageCount}): ${runtimeMetrics.brokenImages.slice(0, 3).join(', ')}`
      });
    }

    // Restore default theme
    if (theme !== "default") {
      await cdp.evaluate(`window.sanctuary?.setActiveTheme?.('default')`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // --- SCENARIOS ---

  // 1. Gallery View Baseline (W1, W2, W3, W4)
  console.log("[audit] 1. Gallery View Across Viewports...");
  await auditScenario("01_gallery_main", null, "W3", "default");
  await auditScenario("01_gallery_min_w1", null, "W1", "default");
  await auditScenario("01_gallery_laptop_w2", null, "W2", "default");
  await auditScenario("01_gallery_fullhd_w4", null, "W4", "default");

  // 2. Gallery Across 4 Themes
  console.log("[audit] 2. Gallery Across Themes...");
  await auditScenario("02_gallery_theme_sakura", null, "W3", "builtin.sakura-dream");
  await auditScenario("02_gallery_theme_cyber", null, "W3", "builtin.cyber-deck");
  await auditScenario("02_gallery_theme_hollow", null, "W3", "builtin.hollow-zero");

  // 3. Compass Dial Interaction
  console.log("[audit] 3. Compass Dial Hero...");
  await auditScenario("03_compass_dial_hero", async () => {
    await cdp.evaluate(`(() => {
      window.scrollTo(0, 0);
      const dial = document.querySelector('.interactive-compass-dial-card');
      dial?.scrollIntoView();
    })()`);
  }, "W3", "default");

  // 4. Collections / Albums View
  console.log("[audit] 4. Collections & Saved Views...");
  await auditScenario("04_albums_grid", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button, a, .segmented-control-option')).find(el => el.textContent.includes('相册画集') || el.textContent.includes('画集'));
      btn?.click();
    })()`);
  }, "W3", "default");
  await auditScenario("04_albums_grid_w1", null, "W1", "default");

  // 5. Album Detail View & TOC
  console.log("[audit] 5. Album Detail & TOC...");
  await auditScenario("05_album_detail", async () => {
    await cdp.evaluate(`(() => {
      const card = document.querySelector('.collection-card.album-card-book');
      card?.click();
    })()`);
  }, "W3", "default");

  // Switch to Washi Tape style
  await auditScenario("05_album_mount_washi", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.mount-style-pill')).find(el => el.textContent.includes('和纸'));
      btn?.click();
    })()`);
  }, "W3", "default");

  // Switch to Polaroid style
  await auditScenario("05_album_mount_polaroid", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.mount-style-pill')).find(el => el.textContent.includes('拍立得'));
      btn?.click();
    })()`);
  }, "W3", "default");

  // Switch to Gallery Float style
  await auditScenario("05_album_mount_float", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.mount-style-pill')).find(el => el.textContent.includes('浮雕'));
      btn?.click();
    })()`);
  }, "W3", "default");

  // 6. Authors Gallery View
  console.log("[audit] 6. Authors Gallery View...");
  await auditScenario("06_authors_view", async () => {
    // Back to library first
    await cdp.evaluate(`(() => {
      const backBtn = document.querySelector('.album-action-pill, button');
      backBtn?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button, a, .segmented-control-option')).find(el => el.textContent.includes('画师馆藏') || el.textContent.includes('画师'));
      btn?.click();
    })()`);
  }, "W3", "default");

  // 7. Lightbox / Cinema Stage & Multi-Page Filmstrip
  console.log("[audit] 7. Lightbox Cinema Stage...");
  await auditScenario("07_lightbox_open", async () => {
    // Switch to flat gallery view
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button, a, .segmented-control-option')).find(el => el.textContent.includes('画廊全景'));
      btn?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    await cdp.evaluate(`(() => {
      const cardCover = document.querySelector('.work-cover-button');
      cardCover?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 800));
  }, "W3", "default");

  await auditScenario("07_lightbox_zoomed", async () => {
    await cdp.evaluate(`(() => {
      const zoomBtn = Array.from(document.querySelectorAll('.zoom-capsule button')).find(el => el.textContent === '+');
      zoomBtn?.click();
      zoomBtn?.click();
    })()`);
  }, "W3", "default");

  await auditScenario("07_lightbox_radar_open", async () => {
    await cdp.evaluate(`(() => {
      const radarBtn = Array.from(document.querySelectorAll('.cinema-btn-fit, button')).find(el => el.textContent.includes('雷达'));
      radarBtn?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 600));
  }, "W3", "default");

  // Close lightbox
  await cdp.evaluate(`(() => {
    const closeBtn = document.querySelector('.cinema-btn-close');
    closeBtn?.click();
  })()`);
  await new Promise((r) => setTimeout(r, 500));

  // 8. Settings View & External Vision Configuration Section
  console.log("[audit] 8. Settings View & Vision Providers...");
  await auditScenario("08_settings_view", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.nav-item, button')).find(el => el.textContent.includes('设置') || el.textContent.includes('首选项'));
      btn?.click();
    })()`);
  }, "W3", "default");
  await auditScenario("08_settings_view_w1", null, "W1", "default");
  await auditScenario("08_settings_theme_cyber", null, "W3", "builtin.cyber-deck");

  // Settings scroll to Typography & Fonts Section
  await auditScenario("08_settings_typography_section", async () => {
    await cdp.evaluate(`(() => {
      const typoSection = document.querySelector('.typography-settings-section');
      typoSection?.scrollIntoView();
    })()`);
  }, "W3", "default");

  // Settings scroll to External AI Vision Providers Section
  await auditScenario("08_settings_vision_section", async () => {
    await cdp.evaluate(`(() => {
      const visionSection = document.querySelector('.vision-settings-section');
      visionSection?.scrollIntoView();
    })()`);
  }, "W3", "default");

  // 9. Model Analysis View
  console.log("[audit] 9. Model Analysis View...");
  await auditScenario("09_analysis_view", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.nav-item, button')).find(el => el.textContent.includes('模型整理') || el.textContent.includes('整理'));
      btn?.click();
    })()`);
  }, "W3", "default");

  // 10. Explore View & Safety HUD
  console.log("[audit] 10. Explore View & Safety HUD...");
  await auditScenario("10_explore_view", async () => {
    await cdp.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('.nav-item, button')).find(el => el.textContent.includes('探索'));
      btn?.click();
    })()`);
  }, "W3", "default");

  // 11. New Collection Dialog Modal
  console.log("[audit] 11. New Collection Dialog Modal...");
  await auditScenario("11_new_collection_dialog", async () => {
    await cdp.evaluate(`(() => {
      const navGallery = Array.from(document.querySelectorAll('.nav-item, button')).find(el => el.textContent.includes('画廊'));
      navGallery?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await cdp.evaluate(`(() => {
      const newColBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('新建相册') && !el.textContent.includes('组合'));
      newColBtn?.click();
    })()`);
  }, "W3", "default");

  // Close dialog
  await cdp.evaluate(`(() => {
    const cancelBtn = Array.from(document.querySelectorAll('button, .dialog-btn')).find(el => el.textContent.includes('取消'));
    cancelBtn?.click();
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  // 12. Saved View Editor Modal
  console.log("[audit] 12. Saved View Editor Modal...");
  await auditScenario("12_saved_view_editor_dialog", async () => {
    await cdp.evaluate(`(() => {
      const colTab = Array.from(document.querySelectorAll('button, a, .segmented-control-option')).find(el => el.textContent.includes('相册画集'));
      colTab?.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await cdp.evaluate(`(() => {
      const newViewBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('新建相册组合') || el.textContent.includes('新建组合'));
      newViewBtn?.click();
    })()`);
  }, "W3", "default");

  // Write Result Summary Manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    auditCommit: "d6086f1",
    totalScreenshots: capturedScreenshots.length,
    screenshots: capturedScreenshots,
    findings: auditFindings
  };
  await writeFile(join(outputDir, "audit-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log("\n=======================================================");
  console.log(`[audit-complete] Captured ${capturedScreenshots.length} screenshots.`);
  console.log(`[audit-complete] Detected ${auditFindings.length} runtime anomalies.`);
  for (const f of auditFindings) {
    console.log(` - [${f.id}] in ${f.scenario} (${f.viewport}): ${f.detail}`);
  }
  console.log("=======================================================\n");

  cdp.close();
} finally {
  child.kill();
}
