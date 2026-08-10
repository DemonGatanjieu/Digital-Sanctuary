const ADAPTER_STATE_KEY = "__sanctuaryPixivDomAdapter";
const HIDDEN_CLASS = "sanctuary-pixiv-promotion-hidden";
const PLACEHOLDER_CLASS = "sanctuary-pixiv-review-placeholder";

/**
 * Builds page-local JavaScript. The injected code has no Electron or IPC
 * access; it only marks first-party promotions and guarded artwork images.
 */
export function buildPixivDomAdapterScript(revealToken = ""): string {
  return `(() => {
    const stateKey = ${JSON.stringify(ADAPTER_STATE_KEY)};
    const hiddenClass = ${JSON.stringify(HIDDEN_CLASS)};
    const placeholderClass = ${JSON.stringify(PLACEHOLDER_CLASS)};
    const revealToken = ${JSON.stringify(revealToken)};
    const markerWords = new Set(["pr", "推广", "promoted", "sponsored", "promotion", "advertisement", "广告"]);
    const legacyPromotionClassHints = ["yfl-ads", "yfl-pr-band"];
    const promotionLinkHosts = ["booth.pm", "fanbox.cc"];
    const markerAttributes = [
      "aria-label", "title", "alt", "data-label", "data-ad-label", "data-ad",
      "data-ad-type", "data-advertisement", "data-promotion", "data-testid", "data-test-id"
    ];

    if (window[stateKey]?.installed) return window[stateKey].hiddenCount ?? 0;

    const state = {
      installed: true,
      hiddenCount: 0,
      observer: null,
      scheduled: false,
      pendingNodes: [],
      blockedReviews: new Map(),
      revealedUrls: new Set()
    };
    window[stateKey] = state;

    const styleId = "sanctuary-pixiv-review-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = [
        "." + hiddenClass + " { display: none !important; }",
        "." + placeholderClass + " { display: grid; box-sizing: border-box; min-height: 160px; width: 100%; place-items: center; align-content: center; gap: 8px; padding: 18px; border: 1px solid #e1e5e9; border-radius: 12px; color: #69727d; background: #f3f5f7; font: 12px/1.5 sans-serif; text-align: center; }",
        "." + placeholderClass + " strong { color: #4e5863; font-size: 13px; }",
        "." + placeholderClass + " small { max-width: 28em; color: #818b96; }",
        "." + placeholderClass + " button { padding: 6px 10px; border: 1px solid #b9ddf5; border-radius: 8px; color: #087fc0; background: #eef8fe; cursor: pointer; font: inherit; }"
      ].join("\\n");
      (document.head || document.documentElement).appendChild(style);
    }

    const normalized = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const isPromotionLink = (element) => {
      if (!(element instanceof HTMLAnchorElement)) return false;
      try {
        const hostname = new URL(element.href).hostname.toLowerCase();
        return promotionLinkHosts.some((host) => hostname === host || hostname.endsWith("." + host));
      } catch {
        return false;
      }
    };
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

    const isMarker = (element) => {
      if (!(element instanceof Element)) return false;
      const className = normalized(typeof element.className === "string" ? element.className : "");
      if (legacyPromotionClassHints.some((hint) => className.includes(hint))) return true;
      if (isPromotionLink(element)) return true;
      for (const attribute of markerAttributes) {
        const value = normalized(element.getAttribute(attribute));
        if (!value) continue;
        if (markerWords.has(value)) return true;
        if (attribute.startsWith("data-") && value.split(/[^a-z0-9\u4e00-\u9fff]+/).some((token) => markerWords.has(token))) return true;
      }
      if (element.childElementCount === 0 && markerWords.has(normalized(element.textContent))) {
        return ["SPAN", "SMALL", "LABEL", "P", "DIV", "A", "BUTTON", "STRONG", "EM", "SVG", "TEXT"].includes(element.tagName);
      }
      return false;
    };

    const findCard = (marker) => {
      let current = marker;
      for (let depth = 0; current && current !== document.body && depth < 9; depth += 1) {
        const tag = current.tagName;
        if (tag !== "MAIN" && tag !== "NAV" && tag !== "HEADER" && tag !== "ASIDE" && tag !== "A") {
          const imageCount = current.querySelectorAll("img, picture").length;
          const linkCount = current.querySelectorAll("a[href], [role=\"link\"], [data-gtm-id], [data-gtm-label], [onclick]").length;
          if (imageCount >= 1 && linkCount >= 1 && imageCount <= 12 && linkCount <= 16) return current;
        }
        current = current.parentElement;
      }

      let scope = marker.parentElement;
      for (let depth = 0; scope && scope !== document.body && depth < 4; depth += 1) {
        const sibling = [...scope.children].find((candidate) => {
          const imageCount = candidate.querySelectorAll("img, picture").length;
          const linkCount = candidate.querySelectorAll("a[href], [role=\"link\"], [data-gtm-id], [data-gtm-label], [onclick]").length;
          return imageCount >= 1 && linkCount >= 1 && imageCount <= 12 && linkCount <= 16;
        });
        if (sibling) return sibling;
        scope = scope.parentElement;
      }
      return null;
    };

    const inspect = (root) => {
      if (!(root instanceof Element)) return;
      const candidates = [root, ...root.querySelectorAll("[aria-label], [title], [alt], [data-label], [data-testid], [class*=yfl-ads], [class*=yfl-pr-band], img, svg, text, span, small, label, p, div, a, button, strong, em")];
      for (const candidate of candidates) {
        if (!isMarker(candidate)) continue;
        const card = findCard(candidate);
        if (!card || card.classList.contains(hiddenClass)) continue;
        card.classList.add(hiddenClass);
        state.hiddenCount += 1;
      }
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
      const currentUrl = normalizeArtworkUrl(image.getAttribute("src") || image.currentSrc || image.src);
      if (currentUrl !== url) return;
      if (!image.dataset.sanctuaryReviewOriginalSrc) {
        image.dataset.sanctuaryReviewOriginalSrc = image.getAttribute("src") || image.src;
        image.dataset.sanctuaryReviewOriginalSrcset = image.getAttribute("srcset") || "";
      }
      image.style.visibility = "hidden";
      image.setAttribute("aria-hidden", "true");
      if (image.parentElement?.querySelector("[data-sanctuary-review-placeholder]")?.getAttribute("data-sanctuary-review-placeholder") === url) return;

      const placeholder = document.createElement("div");
      placeholder.className = placeholderClass;
      placeholder.setAttribute("data-sanctuary-review-placeholder", url);
      const rect = image.getBoundingClientRect();
      if (rect.height > 20) placeholder.style.minHeight = Math.round(rect.height) + "px";
      const title = document.createElement("strong");
      title.textContent = "作品已按规则遮挡";
      const detail = document.createElement("small");
      detail.textContent = reasons.length ? "命中：" + reasons.join("、") : "审查未完成，默认保持遮挡";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "仅本次查看";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.revealedUrls.add(url);
        if (revealToken) console.info("sanctuary-reveal:" + revealToken + ":" + encodeURIComponent(url));
      });
      placeholder.append(title, detail, button);
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
      for (const node of state.pendingNodes) {
        inspect(node);
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
    inspect(document.body || document.documentElement);
    return state.hiddenCount;
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

export const PIXIV_DOM_ADAPTER_HIDDEN_CLASS = HIDDEN_CLASS;
export const PIXIV_DOM_ADAPTER_PLACEHOLDER_CLASS = PLACEHOLDER_CLASS;
