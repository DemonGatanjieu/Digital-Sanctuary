import { spawn } from "node:child_process";
import { resolve } from "node:path";

const port = 9255;
const electron = resolve("node_modules/electron/dist/electron.exe");
const entry = resolve("apps/desktop/out/main/index.js");

console.log("[probe] Launching Electron to test Local Font Access & Context APIs...");

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
  throw new Error(`Probe could not connect to Electron debugger on port ${port}`);
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

  const probeResult = await cdp.evaluate(`(async () => {
    const isSecureContext = window.isSecureContext;
    const protocol = window.location.protocol;
    const origin = window.location.origin;
    const hasQueryLocalFonts = typeof window.queryLocalFonts === 'function';
    let permissionState = 'unknown';
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'local-fonts' });
        permissionState = status.state;
      }
    } catch (err) {
      permissionState = 'error: ' + err.message;
    }

    const fontFaceAvailable = typeof window.FontFace === 'function';
    const documentFontsAvailable = Boolean(document.fonts);

    return {
      isSecureContext,
      protocol,
      origin,
      hasQueryLocalFonts,
      permissionState,
      fontFaceAvailable,
      documentFontsAvailable
    };
  })()`);

  console.log("[probe-result] Local Font Access Capability Report:", JSON.stringify(probeResult, null, 2));

  cdp.close();
} finally {
  child.kill();
}
