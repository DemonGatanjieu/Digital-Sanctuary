import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connectElectronMainInspector, showElectronTestWindow } from "./electron-smoke-support.mjs";

// Real application renderer/preload/output handlers, disposable SQLite and files.
// Clipboard writeText/readText are fixture proxies; the OS clipboard is never modified.
// Model responses are controlled test fixtures; no models are installed or downloaded.
const port = await availablePort();
const mainPort = await availablePort();
const temporaryRoot = resolve(tmpdir());
const userData = await mkdtemp(join(temporaryRoot, "sanctuary-inspiration-smoke-"));
const screenshots = resolve(".tmp/inspiration-smoke");
const markdownPath = join(userData, "创作导出.md");
await mkdir(screenshots, { recursive: true });
const storeKey = "local_inspiration_conversations_v1";
const timestamp = "2026-10-03T00:00:00.000Z";
const modelId = "smoke-fixture-model";
const provenance = {
  modelId, modelVersion: "fixture-v1", evaluatorVersion: "fixture-runtime",
  settings: { creativity: "precise", responseLength: "brief" },
  parameters: { temperature: 0.35, topP: 0.82, topK: 32, maxTokens: 600 },
  source: { workId: "fixture-source-work", title: "历史参考页", artistName: "测试画师", pageIndex: 2 }, durationMs: 1250
};
const fixtureConversations = [
  { id: "conversation-a", title: "对话 A · 角色动机", presetId: "character_profile", source: null, modelId,
    settings: { creativity: "balanced", responseLength: "standard" },
    messages: [
      { id: "a-user", role: "user", content: "请梳理人物动机。", createdAt: timestamp },
      { id: "a-reply", role: "assistant", content: "## 人物动机\n\nA 的稳定回答。", createdAt: timestamp, provenance }
    ], createdAt: timestamp, updatedAt: "2026-10-03T00:00:02.000Z" },
  { id: "conversation-b", title: "对话 B · 世界观", presetId: "world_building", source: null, modelId,
    settings: { creativity: "balanced", responseLength: "standard" },
    messages: [
      { id: "b-user", role: "user", content: "世界如何运转？", createdAt: timestamp },
      { id: "b-reply", role: "assistant", content: "B 的历史稳定回答。", createdAt: timestamp }
    ], createdAt: timestamp, updatedAt: "2026-10-03T00:00:01.000Z" }
];
const databasePath = join(userData, "library.db");
const database = new DatabaseSync(databasePath);
database.exec("CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)");
database.prepare("INSERT INTO user_preferences(key,value_json,updated_at) VALUES (?,?,?)")
  .run(storeKey, JSON.stringify(fixtureConversations), timestamp);
database.prepare("INSERT INTO user_preferences(key,value_json,updated_at) VALUES ('library.preferences',?,?)")
  .run(JSON.stringify({ defaultView: "flat", defaultSortBy: "savedAt", defaultSortDirection: "desc", gridDensity: "comfortable", downloadDirectory: join(userData, "Storage", "Pixiv") }), timestamp);
database.close();

const child = spawn(resolve("node_modules/electron/dist/electron.exe"),
  [resolve("apps/desktop/out/main/index.js"), `--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`,
    "--host-resolver-rules=MAP pixiv.net ~NOTFOUND, MAP *.pixiv.net ~NOTFOUND"],
  { env: { ...process.env, LOCALAPPDATA: join(userData, "LocalAppData") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const checks = [];
let main;
let cdp;

try {
  main = await connectElectronMainInspector(mainPort);
  await showElectronTestWindow(main);
  const target = await waitForRenderer(port);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  // Only this disposable process has fixture inference/model listings. Output IPC is production code.
  await main.evaluate(`(() => {
    const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    const state = globalThis.__inspirationSmoke = { pending: [], requests: [], saveChoices: [], cancelNextSave: false,
      copiedText: '', originalClipboardWriteText: electron.clipboard.writeText, originalClipboardReadText: electron.clipboard.readText };
    electron.clipboard.writeText = text => { state.copiedText = text; };
    electron.clipboard.readText = () => state.copiedText;
    electron.ipcMain.removeHandler('models:snapshot');
    electron.ipcMain.handle('models:snapshot', () => ({ models: [{ id: ${JSON.stringify(modelId)}, name: '隔离测试模型', capability: 'art_critic', installed: true,
      availability: 'ready', tier: 'light', recommendedVramGb: 0 }], activeByCapability: { art_critic: ${JSON.stringify(modelId)} } }));
    electron.ipcMain.removeHandler('inspiration:send');
    electron.ipcMain.handle('inspiration:send', (_event, request) => {
      state.requests.push(request);
      return new Promise((resolve, reject) => state.pending.push({ request, resolve, reject }));
    });
    electron.dialog.showSaveDialog = async (...args) => {
      state.saveChoices.push(args.at(-1));
      if (state.cancelNextSave) { state.cancelNextSave = false; return { canceled: true }; }
      return { canceled: false, filePath: ${JSON.stringify(markdownPath)} };
    };
    return true;
  })()`);

  async function waitFor(expression) {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      if (await cdp.evaluate(expression)) return;
      await new Promise((done) => setTimeout(done, 60));
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function click(selector) {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    assert.equal(await cdp.evaluate(`(() => { const button=document.querySelector(${JSON.stringify(selector)}); if(button.disabled)return false;button.click();return true; })()`), true, `disabled control: ${selector}`);
  }
  async function clickText(selector, text) {
    await waitFor(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(el=>el.textContent.includes(${JSON.stringify(text)}))`);
    assert.equal(await cdp.evaluate(`(() => { const button=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>el.textContent.includes(${JSON.stringify(text)})); if(button.disabled)return false;button.click();return true; })()`), true, `disabled control: ${text}`);
  }
  async function fill(value) {
    await cdp.evaluate(`(() => {const input=document.querySelector('.inspiration-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`);
  }
  async function key(key, code = key) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  }
  async function waitForRequests(count) {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      if (await main.evaluate(`__inspirationSmoke.requests.length === ${count}`)) return;
      await new Promise((done) => setTimeout(done, 60));
    }
    throw new Error(`Expected ${count} controlled inference requests`);
  }
  const clipboardText = () => main.evaluate("process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').clipboard.readText()");
  const selectedTitle = () => cdp.evaluate("document.querySelector('.inspiration-conversation-actions>strong')?.textContent");
  const mainScrollTop = () => cdp.evaluate("document.querySelector('.app-shell > main').scrollTop");
  async function creationBounds() {
    return cdp.evaluate(`(() => {
      const bounds = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom }; };
      const messages = document.querySelector('.inspiration-messages');
      return { header:bounds('.inspiration-header'),chat:bounds('.inspiration-chat'),textarea:bounds('.inspiration-composer textarea'),send:bounds('.inspiration-send, .inspiration-stop'),
        sessions:bounds('.inspiration-sessions'),settings:bounds('.inspiration-presets'),messages:{...bounds('.inspiration-messages'),scrollHeight:messages.scrollHeight,clientHeight:messages.clientHeight,scrollTop:messages.scrollTop,overflowY:getComputedStyle(messages).overflowY},
        mainScrollTop:document.querySelector('.app-shell > main').scrollTop };
    })()`);
  }
  function assertComposerVisible(bounds, name) {
    for (const control of ['textarea', 'send']) {
      const box = bounds[control];
      assert.ok(box.x >= 0 && box.y >= 0 && box.right <= 901 && box.bottom <= 621 && box.height >= 36,
        `${name} ${control} was outside the 900x620 viewport: ${JSON.stringify(bounds)}`);
    }
    assert.ok(bounds.header.y >= 0, `${name} header was scrolled out of the viewport: ${JSON.stringify(bounds)}`);
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
  await click('[data-nav="inspiration"]');
  await waitFor("document.querySelector('.inspiration-session.active strong')?.textContent.includes('对话 A')");
  await waitFor("document.querySelector('.inspiration-model-controls select')?.value === 'smoke-fixture-model'");
  assert.equal(await selectedTitle(), fixtureConversations[0].title);
  const firstLayout = await creationBounds();
  assertComposerVisible(firstLayout, 'initial conversation');
  assert.ok(firstLayout.sessions.width >= 150 && firstLayout.settings.height > 0 && firstLayout.settings.bottom <= 621, 'history and model/preset controls were not accessible');
  checks.push({ name: "initial-900x620-composer-and-send-visible-with-history-models-and-presets", bounds: firstLayout });
  assert.ok(await cdp.evaluate("document.querySelector('.inspiration-reply-actions').innerText.includes('参考第 3 页')"));
  await clickText(".inspiration-reply-actions button", "复制回答");
  await waitFor("document.querySelector('.inspiration-chat').innerText.includes('回答已复制')");
  assert.equal(await clipboardText(), fixtureConversations[0].messages[1].content);
  await clickText(".inspiration-conversation-actions button", "复制对话");
  await waitFor("document.querySelector('.inspiration-chat').innerText.includes('对话已复制为 Markdown')");
  const copied = await clipboardText();
  assert.ok(copied.includes("请梳理人物动机。") && copied.includes("A 的稳定回答。"));
  assert.ok(copied.includes("实际模型：smoke-fixture-model") && copied.includes("pageIndex=2"));
  assert.ok(!copied.includes("sanctuary-image") && !copied.includes(userData));
  checks.push({ name: "stored-reply-copy-and-whole-conversation-Markdown-copy" });

  await clickText(".inspiration-reply-actions button", "保存 Markdown");
  await waitFor("document.querySelector('.inspiration-chat').innerText.includes('已保存 创作导出.md')");
  let exported = await readFile(markdownPath, "utf8");
  assert.ok(exported.includes("A 的稳定回答。") && !exported.includes("请梳理人物动机。"));
  await clickText(".inspiration-conversation-actions button", "导出 Markdown");
  await waitFor("document.querySelector('.inspiration-chat').innerText.includes('已保存 创作导出.md')");
  exported = await readFile(markdownPath, "utf8");
  assert.ok(exported.includes("请梳理人物动机。") && exported.includes("A 的稳定回答。"));
  await main.evaluate("__inspirationSmoke.cancelNextSave=true");
  await clickText(".inspiration-conversation-actions button", "导出 Markdown");
  await waitFor("!document.querySelector('.inspiration-conversation-actions button:disabled')");
  assert.equal(await readFile(markdownPath, "utf8"), exported);
  const saveOptions = await main.evaluate("__inspirationSmoke.saveChoices");
  assert.equal(saveOptions.length, 3);
  assert.ok(saveOptions.every((options) => options.properties.includes("showOverwriteConfirmation")));
  checks.push({ name: "single-answer-and-whole-conversation-export-cancel-preserves-file" });

  await fill("发给 A 的慢回复问题");
  await cdp.evaluate("document.querySelector('.inspiration-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))");
  assert.equal(await main.evaluate("__inspirationSmoke.requests.length"), 0);
  assert.equal(await cdp.evaluate("document.querySelector('.inspiration-composer textarea').value"), "发给 A 的慢回复问题");
  await key("Enter");
  await waitForRequests(1);
  await waitFor("document.querySelector('.inspiration-message.queued')?.innerText.includes('发给 A 的慢回复问题')");
  assert.equal(await cdp.evaluate("document.querySelectorAll('.inspiration-reply-actions').length"), 1, "pending reply gained stable output actions");
  await clickText(".inspiration-sessions button", "对话 B");
  await fill("B 工作区未发送草稿");
  await waitFor("document.querySelector('.inspiration-chat').innerText.includes('另一段对话正在生成')");
  const updatedA = structuredClone(fixtureConversations[0]);
  const longAnswer = "A 的慢回复完成。\n\n" + Array.from({ length: 80 }, (_, index) => `长回答第 ${index + 1} 段：角色需要面对自己的选择，和伙伴讨论过去的经历，再决定下一步行动。`).join('\n\n');
  updatedA.messages.push({ id: "a-slow-user", role: "user", content: "发给 A 的慢回复问题", createdAt: timestamp },
    { id: "a-slow-reply", role: "assistant", content: longAnswer, createdAt: timestamp, provenance });
  updatedA.updatedAt = "2026-10-03T00:00:03.000Z";
  // Save the controlled completed fixture so subsequent real list/export IPC remains authoritative.
  const completedDatabase = new DatabaseSync(databasePath);
  completedDatabase.prepare("UPDATE user_preferences SET value_json=?,updated_at=? WHERE key=?")
    .run(JSON.stringify([updatedA, fixtureConversations[1]]), updatedA.updatedAt, storeKey);
  completedDatabase.close();
  const scrollBeforeSlowReply = await mainScrollTop();
  await main.evaluate(`__inspirationSmoke.pending[0].resolve(${JSON.stringify(updatedA)})`);
  await waitFor("!document.querySelector('.inspiration-stop')");
  assert.equal(await selectedTitle(), fixtureConversations[1].title);
  assert.equal(await cdp.evaluate("document.querySelector('.inspiration-composer textarea').value"), "B 工作区未发送草稿");
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.inspiration-message.queued'))"), false);
  assert.equal(await mainScrollTop(), scrollBeforeSlowReply, 'slow message completion moved the main page scroll');
  checks.push({ name: "IME-does-not-send-and-slow-success-stays-in-original-conversation" });

  const scrollBeforeLongConversation = await mainScrollTop();
  await clickText(".inspiration-sessions button", "对话 A");
  await waitFor("document.querySelector('.inspiration-messages').innerText.includes('A 的慢回复完成。')");
  await waitFor("document.querySelector('.inspiration-messages').scrollTop > 0");
  const longLayout = await creationBounds();
  assertComposerVisible(longLayout, 'long conversation');
  assert.ok(longLayout.messages.scrollHeight > longLayout.messages.clientHeight * 2, 'long answer did not overflow its bounded messages container');
  assert.equal(longLayout.messages.overflowY, 'auto');
  assert.ok(longLayout.messages.scrollTop > 0, 'new conversation did not scroll its own messages to the latest reply');
  assert.ok(Math.abs(longLayout.chat.height - firstLayout.chat.height) <= 2, 'long conversation expanded the chat panel');
  assert.equal(await mainScrollTop(), scrollBeforeLongConversation, 'switching to long messages scrolled the main ancestor');
  await cdp.send('Input.dispatchMouseEvent', { type:'mouseWheel', x:Math.round(longLayout.messages.x + longLayout.messages.width / 2), y:Math.round(longLayout.messages.y + longLayout.messages.height / 2), deltaX:0, deltaY:240 });
  await cdp.evaluate('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
  assert.equal(await mainScrollTop(), scrollBeforeLongConversation, 'messages wheel scroll chained to the main ancestor');
  checks.push({ name: "long-answer-scrolls-only-messages-keeps-chat-composer-and-main-position", bounds:longLayout });
  await fill("A 将失败的问题");
  await key("Enter");
  await waitForRequests(2);
  await clickText(".inspiration-sessions button", "对话 B");
  assert.equal(await cdp.evaluate("document.querySelector('.inspiration-composer textarea').value"), "B 工作区未发送草稿");
  await main.evaluate("__inspirationSmoke.pending[1].reject(new Error('隔离夹具失败 A'))");
  await waitFor("!document.querySelector('.inspiration-stop')");
  assert.equal(await selectedTitle(), fixtureConversations[1].title);
  assert.equal(await cdp.evaluate("document.querySelector('.inspiration-composer textarea').value"), "B 工作区未发送草稿");
  assert.equal(await cdp.evaluate("document.querySelector('.inspiration-chat').innerText.includes('隔离夹具失败 A')"), false);
  await key("Enter");
  await waitForRequests(3);
  await fill("B 请求期间新写的草稿");
  await main.evaluate("__inspirationSmoke.pending[2].reject(new Error('隔离夹具失败 B'))");
  await waitFor("document.querySelector('.inspiration-chat').innerText.includes('隔离夹具失败 B')");
  assert.equal(await cdp.evaluate("document.querySelector('.inspiration-composer textarea').value"), "B 请求期间新写的草稿");
  checks.push({ name: "slow-failure-does-not-pollute-another-workspace-or-overwrite-new-draft" });

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
  await clickText(".inspiration-sessions button", "对话 A");
  await waitFor("document.querySelector('.inspiration-messages').innerText.includes('A 的慢回复完成。')");
  const layout = await cdp.evaluate(`(() => {
    const main=document.querySelector('main');
    return {documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,
      horizontalScrollers:Array.from(main.querySelectorAll('*')).filter(el=>el.getBoundingClientRect().width>0&&['auto','scroll'].includes(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2).map(el=>el.className)};
  })()`);
  assert.ok(layout.documentOverflow <= 2 && layout.mainOverflow <= 2, `creation overflowed at 900px: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.horizontalScrollers, []);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(screenshots, "creation-output-900.png"), Buffer.from(screenshot.data, "base64"));
  checks.push({ name: "creation-output-900-layout", ...layout });
  await click('.inspiration-new');
  await waitFor("Boolean(document.querySelector('.inspiration-welcome')) && !document.querySelector('.inspiration-conversation-actions')");
  const newLayout = await creationBounds();
  assertComposerVisible(newLayout, 'new conversation');
  const newScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(screenshots, "creation-new-900.png"), Buffer.from(newScreenshot.data, "base64"));
  checks.push({ name: "new-conversation-welcome-does-not-push-composer-below-viewport", bounds:newLayout });
  console.log(JSON.stringify({ status: "passed", inference: "controlled fixtures; no model installation", clipboard: "in-memory fixture; OS clipboard unchanged", checks, screenshots }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  if (main) {
    try {
      await main.evaluate(`(() => {
        const state=globalThis.__inspirationSmoke;
        if (!state) return true;
        const clipboard=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').clipboard;
        clipboard.writeText=state.originalClipboardWriteText;
        clipboard.readText=state.originalClipboardReadText;
        state.copiedText='';
        return true;
      })()`);
    } catch {
      console.error("Unable to restore isolated clipboard fixture methods before process exit");
      process.exitCode = 1;
    }
  }
  cdp?.close();
  main?.close();
  child.kill();
  await new Promise((done) => { if (child.exitCode !== null) done(); else { child.once("exit", done); setTimeout(done, 2000); } });
  if (!resolve(userData).startsWith(`${temporaryRoot}${sep}sanctuary-inspiration-smoke-`)) throw new Error("Unexpected inspiration smoke directory");
  await rm(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

async function availablePort() {
  const server = createServer();
  return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close((error) => error ? reject(error) : done(port)); }); });
}
async function waitForRenderer(port) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const target = targets.find((entry) => entry.type === "page" && entry.url?.replaceAll("\\", "/").includes("/renderer/index.html")); if (target?.webSocketDebuggerUrl) return target; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Isolated inspiration renderer did not start");
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = nextId++; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000); pending.set(id, { resolve: (result) => { clearTimeout(timer); done(result); }, reject: (error) => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => socket.close(), evaluate: async (expression) => { const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; } };
}
