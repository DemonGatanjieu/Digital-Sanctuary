import { describe, expect, it } from "vitest";
import { buildPixivDomAdapterScript, PIXIV_DOM_ADAPTER_HIDDEN_CLASS } from "./pixiv-dom-adapter.js";

describe("Pixiv DOM adapter", () => {
  it("is page-local, idempotent, and observes only added subtrees", () => {
    const script = buildPixivDomAdapterScript();
    expect(script).toContain("__sanctuaryPixivDomAdapter");
    expect(script).toContain(PIXIV_DOM_ADAPTER_HIDDEN_CLASS);
    expect(script).toContain("if (window[stateKey]?.installed)");
    expect(script).toContain("subtree: true");
    expect(script).toContain("childList: true");
    expect(script).not.toContain("ipcRenderer");
    expect(script).not.toContain("querySelectorAll(\"*\")");
  });
});
