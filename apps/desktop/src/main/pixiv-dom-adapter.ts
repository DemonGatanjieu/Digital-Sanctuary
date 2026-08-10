const ADAPTER_STATE_KEY = "__sanctuaryPixivDomAdapter";
const HIDDEN_CLASS = "sanctuary-pixiv-promotion-hidden";

/**
 * Builds page-local JavaScript. The injected code has no Electron or IPC
 * access; it only marks a confidently identified first-party promotion card.
 */
export function buildPixivDomAdapterScript(): string {
  return `(() => {
    const stateKey = ${JSON.stringify(ADAPTER_STATE_KEY)};
    const hiddenClass = ${JSON.stringify(HIDDEN_CLASS)};
    const markerWords = new Set(["pr", "推广", "promoted", "sponsored"]);
    const markerAttributes = ["aria-label", "title", "data-label", "data-ad-label"];

    if (window[stateKey]?.installed) return window[stateKey].hiddenCount ?? 0;

    const state = { installed: true, hiddenCount: 0, observer: null, scheduled: false, pendingNodes: [] };
    window[stateKey] = state;

    const styleId = "sanctuary-pixiv-promotion-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = "." + hiddenClass + " { display: none !important; }";
      (document.head || document.documentElement).appendChild(style);
    }

    const normalized = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const isMarker = (element) => {
      if (!(element instanceof Element)) return false;
      for (const attribute of markerAttributes) {
        if (markerWords.has(normalized(element.getAttribute(attribute)))) return true;
      }
      const testId = normalized(element.getAttribute("data-testid"));
      if (["pr", "promoted", "sponsored"].includes(testId)) return true;
      if (element.childElementCount === 0 && markerWords.has(normalized(element.textContent))) {
        return ["SPAN", "SMALL", "LABEL", "P", "DIV"].includes(element.tagName);
      }
      return false;
    };

    const findCard = (marker) => {
      let current = marker;
      for (let depth = 0; current && current !== document.body && depth < 9; depth += 1) {
        const tag = current.tagName;
        if (tag !== "MAIN" && tag !== "NAV" && tag !== "HEADER" && tag !== "ASIDE" && tag !== "A") {
          const imageCount = current.querySelectorAll("img, picture").length;
          const linkCount = current.querySelectorAll("a[href]").length;
          if (imageCount >= 1 && linkCount >= 1 && imageCount <= 8 && linkCount <= 12) {
            return current;
          }
        }
        current = current.parentElement;
      }
      return null;
    };

    const inspect = (root) => {
      if (!(root instanceof Element)) return;
      const candidates = [root, ...root.querySelectorAll("[aria-label], [title], [data-label], [data-testid], span, small, label, p, div")];
      for (const candidate of candidates) {
        if (!isMarker(candidate)) continue;
        const card = findCard(candidate);
        if (!card || card.classList.contains(hiddenClass)) continue;
        card.classList.add(hiddenClass);
        state.hiddenCount += 1;
      }
    };

    const flush = () => {
      state.scheduled = false;
      for (const node of state.pendingNodes) inspect(node);
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

export const PIXIV_DOM_ADAPTER_HIDDEN_CLASS = HIDDEN_CLASS;
