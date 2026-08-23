const ADAPTER_STATE_KEY = "__sanctuaryPixivDomAdapter";
const PLACEHOLDER_CLASS = "sanctuary-pixiv-review-placeholder";

/**
 * Builds page-local JavaScript. The injected code has no Electron or IPC
 * access; it only decorates guarded artwork images and supports one-shot reveal.
 */
export function buildPixivDomAdapterScript(revealToken = ""): string {
  return `(() => {
    const stateKey = ${JSON.stringify(ADAPTER_STATE_KEY)};
    const placeholderClass = ${JSON.stringify(PLACEHOLDER_CLASS)};
    const revealToken = ${JSON.stringify(revealToken)};
    if (window[stateKey]?.installed) {
      window[stateKey].syncDownloadButton?.();
      return true;
    }

    const state = {
      installed: true,
      observer: null,
      scheduled: false,
      pendingNodes: [],
      blockedReviews: new Map(),
      revealedUrls: new Set(),
      downloadButton: null,
      syncDownloadButton: null
    };
    window[stateKey] = state;

    const styleId = "sanctuary-pixiv-review-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = [
        "." + placeholderClass + " { display: grid; box-sizing: border-box; min-height: 140px; width: 100%; place-items: center; align-content: center; gap: 8px; padding: 14px; border: 1px solid rgba(225,229,233,0.8); border-radius: 12px; color: #69727d; background: #f3f5f7; font: 12px/1.4 sans-serif; text-align: center; }",
        "." + placeholderClass + ".compact { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100% !important; height: 100% !important; width: 100% !important; padding: 4px 2px !important; gap: 3px !important; border-radius: 6px !important; }",
        "." + placeholderClass + " strong { color: #4e5863; font-size: 13px; }",
        "." + placeholderClass + ".compact strong { font-size: 10px !important; font-weight: 700; white-space: nowrap; line-height: 1.1; }",
        "." + placeholderClass + " small { max-width: 28em; color: #818b96; }",
        "." + placeholderClass + ".compact small { display: none !important; }",
        "." + placeholderClass + " .sanctuary-actions-row { display: flex; gap: 8px; justify-content: center; margin-top: 4px; }",
        "." + placeholderClass + ".compact .sanctuary-actions-row { gap: 3px !important; margin-top: 2px !important; }",
        "." + placeholderClass + " button { padding: 6px 12px; border: 1px solid #b9ddf5; border-radius: 8px; color: #087fc0; background: #eef8fe; cursor: pointer; font: inherit; transition: all .15s ease; }",
        "." + placeholderClass + ".compact button { padding: 2px 5px !important; font-size: 9px !important; border-radius: 4px !important; }",
        "." + placeholderClass + " button:hover { background: #dff0fc; transform: translateY(-1px); }",
        "." + placeholderClass + " button.inspect-btn { border-color: #d1c4e9; color: #5e35b1; background: #f3e5f5; }",
        "." + placeholderClass + " button.inspect-btn:hover { background: #ede7f6; }",
        "#sanctuary-pixiv-floating-island { position: fixed; right: 22px; bottom: 22px; z-index: 2147483646; display: flex; align-items: center; gap: 8px; padding: 6px; border: 1px solid rgba(255,255,255,0.4); border-radius: 999px; background: rgba(20, 24, 32, 0.75); backdrop-filter: blur(16px); box-shadow: 0 10px 30px rgba(0,0,0,0.35); font: 600 12px/1.2 sans-serif; }",
        "#sanctuary-pixiv-download { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border: none; border-radius: 999px; color: #fff; background: #0096fa; cursor: pointer; font: inherit; transition: all .15s ease; }",
        "#sanctuary-pixiv-download:hover { background: #0088e6; transform: translateY(-1px); }",
        "#sanctuary-pixiv-download::before { content: '↓'; display: grid; width: 16px; height: 16px; place-items: center; border-radius: 50%; color: #0088e6; background: #fff; font-size: 11px; }",
        "#sanctuary-pixiv-inspect { display: flex; align-items: center; gap: 5px; padding: 8px 14px; border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; color: #e2e8f0; background: rgba(255,255,255,0.08); cursor: pointer; font: inherit; transition: all .15s ease; }",
        "#sanctuary-pixiv-inspect:hover { background: rgba(255,255,255,0.18); color: #fff; transform: translateY(-1px); }"
      ].join("\\n");
      (document.head || document.documentElement).appendChild(style);
    }

    const normalizeArtworkUrl = (value) => {
      try {
        const url = new URL(value, document.baseURI);
        if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "i.pximg.net") return null;
        if (!["/img-master/", "/img-original/", "/custom-thumb/"].some((part) => url.pathname.includes(part))) return null;
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return null;
      }
    };

    const currentArtworkId = () => {
      const match = location.pathname.match(/^\\/artworks\\/(\\d+)(?:\\/|$)/);
      return match?.[1] || "";
    };

    state.syncDownloadButton = () => {
      const artworkId = currentArtworkId();
      if (!artworkId || !revealToken) {
        state.downloadButton?.remove();
        state.downloadButton = null;
        return;
      }
      let island = document.getElementById("sanctuary-pixiv-floating-island");
      if (!island) {
        island = document.createElement("div");
        island.id = "sanctuary-pixiv-floating-island";
        (document.body || document.documentElement).appendChild(island);
      }

      let button = document.getElementById("sanctuary-pixiv-download");
      if (!(button instanceof HTMLButtonElement)) {
        button = document.createElement("button");
        button.id = "sanctuary-pixiv-download";
        button.type = "button";
        button.title = "由纯净领域保存全部页面；Pixiv 网页不会获得本地文件权限";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const selectedArtworkId = currentArtworkId();
          if (!selectedArtworkId) return;
          button.textContent = "已加入下载任务";
          console.info("sanctuary-download:" + revealToken + ":" + selectedArtworkId);
          window.setTimeout(() => {
            if (button?.isConnected) button.textContent = "保存到本地画廊";
          }, 1600);
        });
        island.appendChild(button);
      }
      button.dataset.artworkId = artworkId;
      if (!button.textContent) button.textContent = "保存到本地画廊";

      let inspectBtn = document.getElementById("sanctuary-pixiv-inspect");
      if (!(inspectBtn instanceof HTMLButtonElement)) {
        inspectBtn = document.createElement("button");
        inspectBtn.id = "sanctuary-pixiv-inspect";
        inspectBtn.type = "button";
        inspectBtn.title = "查看当前作品的 AI 视觉标签并设置拦截规则";
        inspectBtn.textContent = "🔍 AI 元素透视";
        inspectBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const selectedArtworkId = currentArtworkId();
          if (!selectedArtworkId) return;
          const isArtworkUrlForId = (u) => Boolean(
            u &&
            (u.includes("/img-master/") || u.includes("/img-original/") || u.includes("/custom-thumb/")) &&
            (u.includes("/" + selectedArtworkId + "_") || u.includes("/" + selectedArtworkId + "."))
          );
          const imgs = Array.from(document.querySelectorAll("main figure img, main [role='presentation'] img, img[src*='pximg.net']"));
          const artworkImgs = imgs.filter((el) => isArtworkUrlForId(el.currentSrc || el.getAttribute("src") || el.src || ""));

          let candidateImg = null;
          if (artworkImgs.length > 0) {
            let minDistance = Infinity;
            const viewCenter = window.innerHeight / 2;
            for (const el of artworkImgs) {
              const rect = el.getBoundingClientRect();
              const centerY = rect.top + rect.height / 2;
              const dist = Math.abs(centerY - viewCenter);
              if (dist < minDistance) {
                minDistance = dist;
                candidateImg = el;
              }
            }
          }

          const imgSrc = candidateImg ? (candidateImg.currentSrc || candidateImg.getAttribute("src") || candidateImg.src || "") : "";
          if (imgSrc && isArtworkUrlForId(imgSrc)) {
            console.info("sanctuary-inspect:" + revealToken + ":" + selectedArtworkId + ":" + encodeURIComponent(imgSrc));
          } else {
            console.info("sanctuary-inspect:" + revealToken + ":" + selectedArtworkId);
          }
        });
        island.appendChild(inspectBtn);
      }

      state.downloadButton = button;
    };

    const removePlaceholder = (url, image) => {
      const placeholder = image?.parentElement?.querySelector("[data-sanctuary-review-placeholder]");
      if (placeholder?.getAttribute("data-sanctuary-review-placeholder") === url) placeholder.remove();
      for (const candidate of document.querySelectorAll("[data-sanctuary-review-placeholder]")) {
        if (candidate.getAttribute("data-sanctuary-review-placeholder") === url) candidate.remove();
      }
    };

    const decorateImage = (image, url, reasons) => {
      if (!(image instanceof HTMLImageElement) || state.revealedUrls.has(url)) return;
      const currentUrl = normalizeArtworkUrl(image.currentSrc || image.getAttribute("src") || image.src);
      if (currentUrl !== url) return;
      if (!image.dataset.sanctuaryReviewOriginalSrc) {
        image.dataset.sanctuaryReviewOriginalSrc = image.getAttribute("src") || image.src;
        image.dataset.sanctuaryReviewOriginalSrcset = image.getAttribute("srcset") || "";
      }
      image.style.visibility = "hidden";
      image.setAttribute("aria-hidden", "true");
      if (image.parentElement?.querySelector("[data-sanctuary-review-placeholder]")?.getAttribute("data-sanctuary-review-placeholder") === url) return;

      const placeholder = document.createElement("div");
      const rect = image.getBoundingClientRect();
      const isCompact = (rect.width > 0 && rect.width < 140) || (rect.height > 0 && rect.height < 140);
      if (isCompact) {
        placeholder.className = placeholderClass + " compact";
        placeholder.title = "作品已按规则拦截 (命中：" + (reasons.length ? reasons.join("、") : "特征黑名单") + ")";
      } else {
        placeholder.className = placeholderClass;
        if (rect.height > 20) placeholder.style.minHeight = Math.round(rect.height) + "px";
      }
      placeholder.setAttribute("data-sanctuary-review-placeholder", url);

      const title = document.createElement("strong");
      title.textContent = isCompact ? "🛡️ 已拦截" : "作品已按规则遮挡";
      const detail = document.createElement("small");
      detail.textContent = reasons.length ? "命中：" + reasons.join("、") : "审查未完成，默认保持遮挡";

      const actionsRow = document.createElement("div");
      actionsRow.className = "sanctuary-actions-row";

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = isCompact ? "查看" : "仅本次查看";
      button.title = "仅本次临时查看该画作";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.revealedUrls.add(url);
        if (revealToken) console.info("sanctuary-reveal:" + revealToken + ":" + encodeURIComponent(url));
      });

      const inspectButton = document.createElement("button");
      inspectButton.type = "button";
      inspectButton.className = "inspect-btn";
      inspectButton.textContent = isCompact ? "透视" : "🔍 元素透视";
      inspectButton.title = "查看被拦截作品的 AI 视觉标签";
      inspectButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (revealToken) console.info("sanctuary-inspect-url:" + revealToken + ":" + encodeURIComponent(url));
      });

      actionsRow.append(button, inspectButton);
      placeholder.append(title, detail, actionsRow);
      image.parentElement?.insertBefore(placeholder, image);
    };

    const decorateAll = (url, reasons) => {
      for (const image of document.images) decorateImage(image, url, reasons);
    };

    state.setBlockedReview = (url, reasons) => {
      const normalizedUrl = normalizeArtworkUrl(url);
      if (!normalizedUrl || state.revealedUrls.has(normalizedUrl)) return;
      const safeReasons = Array.isArray(reasons) ? reasons.map((reason) => String(reason)).slice(0, 8) : [];
      state.blockedReviews.set(normalizedUrl, safeReasons);
      decorateAll(normalizedUrl, safeReasons);
    };

    state.releaseOneShot = (url) => {
      const normalizedUrl = normalizeArtworkUrl(url);
      if (!normalizedUrl) return;
      state.revealedUrls.add(normalizedUrl);
      state.blockedReviews.delete(normalizedUrl);
      for (const image of document.images) {
        const originalSrc = image.dataset.sanctuaryReviewOriginalSrc || image.getAttribute("src") || image.src;
        if (normalizeArtworkUrl(originalSrc) !== normalizedUrl) continue;
        const originalSrcset = image.dataset.sanctuaryReviewOriginalSrcset || "";
        image.style.visibility = "";
        image.removeAttribute("aria-hidden");
        removePlaceholder(normalizedUrl, image);
        delete image.dataset.sanctuaryReviewOriginalSrc;
        delete image.dataset.sanctuaryReviewOriginalSrcset;
        if (originalSrcset) image.setAttribute("srcset", originalSrcset);
        image.setAttribute("src", originalSrc);
      }
    };

    const pendingReviews = window["__sanctuaryPixivPendingReviews"];
    if (Array.isArray(pendingReviews)) {
      for (const pending of pendingReviews) {
        if (Array.isArray(pending) && typeof pending[0] === "string") {
          state.setBlockedReview(pending[0], pending[1]);
        }
      }
      delete window["__sanctuaryPixivPendingReviews"];
    }

    const flush = () => {
      state.scheduled = false;
      state.syncDownloadButton();
      for (const node of state.pendingNodes) {
        if (node instanceof Element) {
          for (const [url, reasons] of state.blockedReviews) {
            for (const image of node.matches("img") ? [node] : node.querySelectorAll("img")) decorateImage(image, url, reasons);
          }
        }
      }
      state.pendingNodes = [];
    };
    const schedule = (nodes) => {
      state.pendingNodes.push(...nodes);
      if (state.scheduled) return;
      state.scheduled = true;
      queueMicrotask(flush);
    };

    state.observer = new MutationObserver((mutations) => {
      const nodes = [];
      for (const mutation of mutations) {
        nodes.push(...mutation.addedNodes);
        if (mutation.target instanceof Element) nodes.push(mutation.target);
      }
      if (nodes.length) schedule(nodes);
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    state.syncDownloadButton();
    return true;
  })()`;
}

export function buildPixivBlockedReviewScript(url: string, reasons: readonly string[]): string {
  return `(() => {
    const state = window[${JSON.stringify(ADAPTER_STATE_KEY)}];
    const review = [${JSON.stringify(url)}, ${JSON.stringify([...reasons])}];
    if (state?.setBlockedReview) state.setBlockedReview(review[0], review[1]);
    else {
      const pending = window["__sanctuaryPixivPendingReviews"] || [];
      pending.push(review);
      window["__sanctuaryPixivPendingReviews"] = pending;
    }
  })()`;
}

export function buildPixivReviewReleaseScript(url: string): string {
  return `(() => {
    const state = window[${JSON.stringify(ADAPTER_STATE_KEY)}];
    state?.releaseOneShot?.(${JSON.stringify(url)});
  })()`;
}

export const PIXIV_DOM_ADAPTER_PLACEHOLDER_CLASS = PLACEHOLDER_CLASS;
