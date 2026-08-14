import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const port = 9237;
const fixtureSize = 10_000;
const userData = await mkdtemp(join(tmpdir(), "sanctuary-library-benchmark-"));
const electron = resolve("node_modules/electron/dist/electron.exe");
const entry = resolve("apps/desktop/out/main/index.js");
const child = spawn(electron, [entry, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  env: {
    ...process.env,
    SANCTUARY_BENCHMARK_LIBRARY: "1",
    SANCTUARY_BENCHMARK_WORKS: String(fixtureSize)
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  const target = await waitForRenderer(port, 15_000);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  try {
    const result = await cdp.evaluate(`(async () => {
      const waitUntil = async (predicate, timeout = 10000) => {
        const started = performance.now();
        while (!predicate()) {
          if (performance.now() - started > timeout) throw new Error("renderer readiness timeout");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      await waitUntil(() => document.querySelectorAll(".work-library-card").length >= 60);
      const firstPageMs = performance.now();
      const frameDeltas = [];
      const scroller = document.querySelector("main");
      if (!scroller) throw new Error("main scroll container missing");
      for (let step = 0; step < 36; step += 1) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
        await new Promise((resolve) => setTimeout(resolve, 45));
        const frameStarted = performance.now();
        await new Promise((resolve) => requestAnimationFrame((now) => {
          frameDeltas.push(now - frameStarted);
          resolve();
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      frameDeltas.sort((a, b) => a - b);
      const memory = performance.memory ?? {};
      const metrics = {
        fixtureWorks: ${fixtureSize},
        firstPageMs: Math.round(firstPageMs),
        loadedCardsAfterScroll: document.querySelectorAll(".work-library-card").length,
        renderedImages: document.querySelectorAll(".work-library-card img").length,
        p95FrameMs: Math.round((frameDeltas[Math.floor(frameDeltas.length * .95)] ?? 0) * 10) / 10,
        maxFrameMs: Math.round(Math.max(...frameDeltas) * 10) / 10,
        jsHeapMb: memory.usedJSHeapSize ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null
      };
      const organizeButton = document.querySelector("nav [data-nav='organize']");
      organizeButton?.click();
      await waitUntil(() => Boolean(document.querySelector(".analysis-scope-card")), 3000);
      return { ...metrics, analysisViewReady: Boolean(document.querySelector(".analysis-scope-card")) };
    })()`);
    const failures = [];
    if (result.firstPageMs > 5_000) failures.push("first page exceeded 5s");
    if (result.loadedCardsAfterScroll < 120) failures.push("scroll paging did not load a second page");
    if (result.renderedImages !== 0) failures.push("metadata fixture unexpectedly decoded images");
    if (result.p95FrameMs > 80) failures.push("scroll P95 exceeded 80ms");
    if (result.jsHeapMb !== null && result.jsHeapMb > 512) failures.push("renderer heap exceeded 512MB");
    if (!result.analysisViewReady) failures.push("explicit analysis center did not render");
    console.log(JSON.stringify({ ...result, status: failures.length ? "failed" : "passed", failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    cdp.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise((resolveTask) => {
    if (child.exitCode !== null) resolveTask();
    else {
      child.once("exit", resolveTask);
      setTimeout(resolveTask, 2_000);
    }
  });
  await rm(userData, { recursive: true, force: true });
}

async function waitForRenderer(debugPort, timeout) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/list`;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
        if (target) return target;
      }
    } catch {}
    await new Promise((resolveTask) => setTimeout(resolveTask, 100));
  }
  throw new Error("Electron renderer did not expose a CDP target");
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
  await new Promise((resolveTask, reject) => {
    socket.addEventListener("open", resolveTask, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    async evaluate(expression) {
      const response = await new Promise((resolveTask, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveTask, reject });
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error("CDP evaluation timed out"));
        }, 30_000);
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    },
    close() { socket.close(); }
  };
}
