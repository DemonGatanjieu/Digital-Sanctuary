// Test-only access to an isolated Electron main process launched with
// --inspect=127.0.0.1:<port>. This sends Electron host input, not application IPC.
// Chromium's Input.dispatchKeyEvent can skip Electron before-input-event hooks.
export async function connectElectronMainInspector(port, timeoutMs = 20_000) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid loopback inspector port");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.webSocketDebuggerUrl && entry.type === "node");
        if (target) {
          const endpoint = new URL(target.webSocketDebuggerUrl);
          if (endpoint.hostname !== "127.0.0.1" || Number(endpoint.port) !== port) throw new Error("Inspector endpoint must remain on the requested loopback port");
          return connectMain(endpoint.href);
        }
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Isolated Electron main process did not expose its Node inspector");
}

/** Interactive smoke input and visibility need a real shown window, even after a hidden process launch. */
export async function showElectronTestWindow(inspector, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const shown = await inspector.evaluate(`(() => {
      const electron=process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
      // The Node inspector can answer before Electron has initialized its exports.
      if (!electron.BrowserWindow) return false;
      const window=electron.BrowserWindow.getAllWindows()[0];
      if (!window || window.isDestroyed()) return false;
      window.show(); window.focus();
      return window.isVisible();
    })()`);
    if (shown) return;
    await new Promise((done) => setTimeout(done, 80));
  }
  throw new Error("Isolated Electron test window did not become visible");
}

async function connectMain(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const rejectPending = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Electron main inspector connection closed"));
    }
    pending.clear();
  };
  socket.addEventListener("close", rejectPending);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Electron main inspector timeout: ${method}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };
  // Node's built-in createRequire also works for bundled ESM main entry points.
  const electron = "process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')";
  return {
    evaluate,
    close() { rejectPending(); socket.close(); },
    listWebContents() {
      return evaluate(`(${electron}).webContents.getAllWebContents().map(contents => ({ id: contents.id, url: contents.getURL(), focused: contents.isFocused(), type: contents.getType() }))`);
    },
    async sendHostKey(contentsId, keyCode, modifiers = []) {
      if (!Number.isInteger(contentsId) || contentsId < 1) throw new Error("Invalid Electron webContents id");
      if (typeof keyCode !== "string" || !keyCode.trim()) throw new Error("Host keyCode is required");
      if (!Array.isArray(modifiers) || modifiers.some((modifier) => !["control", "meta", "alt", "shift"].includes(modifier))) throw new Error("Unsupported host key modifier");
      const event = { keyCode, modifiers };
      return evaluate(`(() => {
        const contents = (${electron}).webContents.fromId(${contentsId});
        if (!contents || contents.isDestroyed()) throw new Error('Target Electron webContents is unavailable');
        if (!contents.isFocused()) throw new Error('Target Electron webContents must be focused before host input');
        contents.sendInputEvent({ ...${JSON.stringify(event)}, type: 'keyDown' });
        contents.sendInputEvent({ ...${JSON.stringify(event)}, type: 'keyUp' });
        return { id: contents.id, url: contents.getURL() };
      })()`);
    }
  };
}
