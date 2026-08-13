import { spawn } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";

const workspace = resolve(".");
const temporaryRoot = resolve(".tmp");
const installDirectory = resolve(temporaryRoot, `installed-smoke-${Date.now()}`);
const installer = resolve("release/Digital-Sanctuary-Setup-0.1.0.exe");
if (relative(temporaryRoot, installDirectory).startsWith("..")) throw new Error("Unsafe installer smoke path");

try {
  await run(installer, ["/S", `/D=${installDirectory}`]);
  const executable = join(installDirectory, "DigitalSanctuary.exe");
  if (!(await stat(executable)).isFile()) throw new Error("Installed executable is missing");
  await run(process.execPath, [resolve("scripts/smoke-packaged.mjs"), executable], { cwd: workspace, stdio: "inherit" });
  await run(process.execPath, [resolve("scripts/smoke-vision-bundle.mjs"), join(installDirectory, "resources")], { cwd: workspace, stdio: "inherit" });
  console.log(JSON.stringify({ installer, installDirectory, status: "passed" }, null, 2));
} finally {
  try {
    const files = await readdir(installDirectory);
    const uninstaller = files.find((name) => /^Uninstall .*\.exe$/i.test(name));
    if (uninstaller) {
      await run(join(installDirectory, uninstaller), ["/S"]);
      await new Promise((resolveTask) => setTimeout(resolveTask, 2_000));
    }
  } catch {}
  if (!relative(temporaryRoot, installDirectory).startsWith("..")) {
    await removeWithRetry(installDirectory);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveTask, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveTask() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function removeWithRetry(directory) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
      return;
    } catch (error) {
      if (attempt === 11) throw error;
      await new Promise((resolveTask) => setTimeout(resolveTask, 500));
    }
  }
}
