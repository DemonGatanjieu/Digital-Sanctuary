import { spawn } from "node:child_process";
import { stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const executable = resolve(process.argv[2] ?? "release/win-unpacked/DigitalSanctuary.exe");
const resources = join(executable, "..", "resources");
const visionExecutable = join(resources, "vision-runtime", "sanctuary-vision.exe");
const model = join(resources, "models", "wd-swinv2-tagger-v3", "model.onnx");
const userData = await mkdtemp(join(tmpdir(), "sanctuary-packaged-smoke-"));
const port = 9238;
const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: "ignore", windowsHide: true });

try {
  const [visionStat, modelStat, target] = await Promise.all([
    stat(visionExecutable),
    stat(model),
    waitForRenderer(port, 20_000)
  ]);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    const state = await cdp.evaluate(`(async () => {
      const bridgeStarted = Date.now();
      while (!window.sanctuary && Date.now() - bridgeStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));

      let appStatus = await window.sanctuary.status();
      const visionStarted = Date.now();
      while (appStatus.visionState === "starting" && Date.now() - visionStarted < 60000) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        appStatus = await window.sanctuary.status();
      }

      const navigationStarted = Date.now();
      while (!document.querySelector("nav") && Date.now() - navigationStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));
      const organize = Array.from(document.querySelectorAll("nav button")).find((button) =>
        button.dataset.nav === "organize" || ["智能工坊", "模型整理"].includes(button.textContent.trim())
      );
      organize?.click();
      const analysisStarted = Date.now();
      while (!document.querySelector(".analysis-scope-card") && Date.now() - analysisStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        title: document.title,
        appStatus,
        analysisReady: Boolean(document.querySelector(".analysis-scope-card")),
        activeNavigation: document.querySelector(".workspace-navigation [aria-current='page']")?.textContent.trim()
          ?? document.querySelector("nav [aria-current='page']")?.textContent.trim() ?? ""
      };
    })()`);
    const failures = [];
    if (!visionStat.isFile() || visionStat.size < 100_000) failures.push("vision runtime missing");
    if (!modelStat.isFile() || modelStat.size < 100_000_000) failures.push("WD Tagger model missing");
    if (state.appStatus.visionEngine !== "wd-swinv2-tagger-v3") failures.push("packaged app did not select WD Tagger");
    if (!state.appStatus.visionReady || state.appStatus.visionState !== "ready") failures.push("packaged WD Tagger did not become ready");
    if (!state.analysisReady) failures.push("analysis center did not render");
    if (!["整理与分类", "智能工坊", "模型整理"].includes(state.activeNavigation)) failures.push("navigation accessibility state is missing");
    console.log(JSON.stringify({ executable, visionRuntimeMb: Math.round(visionStat.size / 1024 / 1024 * 10) / 10, modelMb: Math.round(modelStat.size / 1024 / 1024), ...state, status: failures.length ? "failed" : "passed", failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    cdp.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise((resolveTask) => {
    if (child.exitCode !== null) resolveTask();
    else { child.once("exit", resolveTask); setTimeout(resolveTask, 2_000); }
  });
  await rm(userData, { recursive: true, force: true });
}

async function waitForRenderer(debugPort, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {}
    await new Promise((resolveTask) => setTimeout(resolveTask, 100));
  }
  throw new Error("Packaged renderer did not expose a CDP target");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
  });
  await new Promise((resolveTask, reject) => {
    socket.addEventListener("open", resolveTask, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    async evaluate(expression) {
      const response = await new Promise((resolveTask, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve: resolveTask, reject });
        socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    },
    close() { socket.close(); }
  };
}
