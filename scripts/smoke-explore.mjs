const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("Usage: node scripts/smoke-explore.mjs <remote-debugging-port>");
}

const endpoint = `http://127.0.0.1:${port}/json/list`;
const initialTargets = await readTargets(endpoint);
const mainTarget = initialTargets.find((target) =>
  target.url.includes("apps/desktop/out/renderer/index.html")
);
if (!mainTarget?.webSocketDebuggerUrl) throw new Error("Main renderer target not found");

const socket = new WebSocket(mainTarget.webSocketDebuggerUrl);
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

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
  setTimeout(() => reject(new Error("CDP connection timed out")), 5_000);
});

const clicked = await evaluate(`(() => {
  if (document.querySelector(".explore-page")) return true;
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent.trim() === "探索");
  if (!button) return false;
  button.click();
  return true;
})()`);
if (!clicked) throw new Error("Explore navigation button was not found");

await new Promise((resolve) => setTimeout(resolve, 10_000));

if (process.argv.includes("--click-login")) {
  const clickedLogin = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent.trim() === "邮箱登录");
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clickedLogin) throw new Error("Email login button was not found");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const rendererState = await evaluate(`({
  hasExplore: document.body.innerText.includes("安全探索"),
  hasShield: document.body.innerText.includes("已拦截"),
  hasEmailLogin: document.body.innerText.includes("邮箱登录"),
  hasPasswordSetup: document.body.innerText.includes("浏览器设置密码"),
  hasEmailHint: document.body.innerText.includes("使用邮箱登录"),
  layout: (() => {
    const surface = document.querySelector(".explore-surface")?.getBoundingClientRect();
    return {
      sidebarDisplay: getComputedStyle(document.querySelector(".sidebar")).display,
      mainPadding: getComputedStyle(document.querySelector("main")).padding,
      viewport: { width: innerWidth, height: innerHeight },
      surface: surface ? { width: surface.width, height: surface.height } : null
    };
  })(),
  bodyText: document.body.innerText
})`);
let finalTargets = await readTargets(endpoint);
let pixivTarget = finalTargets.find((target) =>
  target.type === "page" && /https:\/\/([a-z0-9-]+\.)*pixiv\.net\//i.test(target.url)
);
const navigationArgument = process.argv.find((argument) => argument.startsWith("--navigate="));
if (navigationArgument && pixivTarget?.webSocketDebuggerUrl) {
  await navigateOnce(
    pixivTarget.webSocketDebuggerUrl,
    navigationArgument.slice("--navigate=".length)
  );
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  finalTargets = await readTargets(endpoint);
  pixivTarget = finalTargets.find((target) =>
    target.type === "page" && /https:\/\/([a-z0-9-]+\.)*pixiv\.net\//i.test(target.url)
  );
}
const loginControls = pixivTarget?.webSocketDebuggerUrl
  ? await evaluateOnce(
      pixivTarget.webSocketDebuggerUrl,
      `Array.from(document.querySelectorAll("a, button"))
        .map((element) => ({
          text: element.textContent.trim(),
          href: element instanceof HTMLAnchorElement ? element.href : ""
        }))
        .filter((item) => /login|log in|sign in|登录|登入|ログイン/i.test(item.text + " " + item.href))
        .slice(0, 30)`
    )
  : [];
const artworkImages = pixivTarget?.webSocketDebuggerUrl
  ? await evaluateOnce(
      pixivTarget.webSocketDebuggerUrl,
      `(() => {
        const images = Array.from(document.images)
          .map((image) => ({
            url: image.currentSrc || image.src,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight
          }))
          .filter((image) => /https:\\/\\/i\\.pximg\\.net\\/.*\\/(img-master|img-original|custom-thumb)\\//i.test(image.url));
        return {
          total: images.length,
          loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
          samples: images.slice(0, 8)
        };
      })()`
    )
  : null;
let loginPage = null;
if (process.argv.includes("--inspect-login") && pixivTarget?.webSocketDebuggerUrl) {
  await navigateOnce(
    pixivTarget.webSocketDebuggerUrl,
    "https://www.pixiv.net/login.php?ref=wwwtop_accounts_index"
  );
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const loginTargets = await readTargets(endpoint);
  const loginTarget = loginTargets.find((target) =>
    target.type === "page" && !target.url.startsWith("file:")
  );
  if (loginTarget?.webSocketDebuggerUrl) {
    loginPage = {
      url: loginTarget.url,
      title: loginTarget.title,
      content: await evaluateOnce(
        loginTarget.webSocketDebuggerUrl,
        `({
          bodyText: document.body.innerText,
          controls: Array.from(document.querySelectorAll("a, button, input"))
            .map((element) => ({
              tag: element.tagName,
              text: element.textContent?.trim() || element.getAttribute("value") || "",
              type: element.getAttribute("type") || "",
              href: element instanceof HTMLAnchorElement ? element.href : ""
            }))
            .filter((item) => item.text || item.href)
            .slice(0, 80)
        })`
      )
    };
  }
}
socket.close();

console.log(JSON.stringify({ rendererState, finalTargets, loginControls, artworkImages, loginPage }, null, 2));

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Renderer evaluation failed");
  }
  return response.result.value;
}

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`${method} timed out`));
    }, 5_000);
  });
}

async function readTargets(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CDP target request failed: ${response.status}`);
  return response.json();
}

async function evaluateOnce(webSocketUrl, expression) {
  const targetSocket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    targetSocket.addEventListener("open", resolve, { once: true });
    targetSocket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    targetSocket.addEventListener(
      "message",
      (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message));
        else if (message.result.exceptionDetails) {
          reject(new Error(message.result.exceptionDetails.text));
        } else resolve(message.result.result.value);
      }
    );
    targetSocket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true }
    }));
  });
  targetSocket.close();
  return result;
}

async function navigateOnce(webSocketUrl, url) {
  const targetSocket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    targetSocket.addEventListener("open", resolve, { once: true });
    targetSocket.addEventListener("error", reject, { once: true });
  });
  await new Promise((resolve, reject) => {
    targetSocket.addEventListener(
      "message",
      (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      },
      { once: true }
    );
    targetSocket.send(JSON.stringify({
      id: 1,
      method: "Page.navigate",
      params: { url }
    }));
  });
  targetSocket.close();
}
