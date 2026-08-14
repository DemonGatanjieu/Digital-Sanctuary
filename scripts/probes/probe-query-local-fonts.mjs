import { spawn } from "node:child_process";
import { resolve } from "node:path";

const port = 9256;
const electron = resolve("node_modules/electron/dist/electron.exe");
const entry = resolve("apps/desktop/out/main/index.js");

console.log("[probe] Testing queryLocalFonts sample data structure in Electron...");

const child = spawn(
  electron,
  [entry, `--remote-debugging-port=${port}`, "--headless=new", "--window-size=800,600"],
  { stdio: ["ignore", "pipe", "pipe"] }
);

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
  throw new Error(`Probe could not connect on port ${port}`);
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
    close: () => socket.close()
  };
}

try {
  const target = await waitForRenderer();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);

  const sampleResult = await cdp.evaluate(`(async () => {
    try {
      const fonts = await window.queryLocalFonts();
      const samples = fonts.slice(0, 5).map(f => ({
        family: f.family,
        fullName: f.fullName,
        postscriptName: f.postscriptName,
        style: f.style
      }));
      // Check if popular Chinese fonts exist
      const known = ['Microsoft YaHei', 'Microsoft YaHei UI', 'SimSun', 'KaiTi', 'SimHei', 'Segoe UI Variable Text', 'Cascadia Mono', 'Consolas'];
      const foundKnown = known.filter(name => fonts.some(f => f.family.toLowerCase() === name.toLowerCase()));

      return {
        totalCount: fonts.length,
        samples,
        foundKnown
      };
    } catch (err) {
      return { error: err.message };
    }
  })()`);

  console.log("[probe-result] queryLocalFonts Sampling:", JSON.stringify(sampleResult, null, 2));

  cdp.close();
} finally {
  child.kill();
}
