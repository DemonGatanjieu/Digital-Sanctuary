import { describe, expect, it } from "vitest";
import {
  buildPixivBlockedReviewScript,
  buildPixivDomAdapterScript,
  buildPixivReviewReleaseScript,
  PIXIV_DOM_ADAPTER_PLACEHOLDER_CLASS
} from "./pixiv-dom-adapter.js";

describe("Pixiv DOM adapter", () => {
  it("is page-local, idempotent, and observes only added subtrees", () => {
    const script = buildPixivDomAdapterScript();
    expect(script).toContain("__sanctuaryPixivDomAdapter");
    expect(script).toContain("if (window[stateKey]?.installed)");
    expect(script).toContain("subtree: true");
    expect(script).toContain("childList: true");
    expect(script).toContain(PIXIV_DOM_ADAPTER_PLACEHOLDER_CLASS);
    expect(script).toContain("仅本次查看");
    expect(script).toContain("sanctuary-reveal:");
    expect(script).toContain("sanctuary-download:");
    expect(script).toContain("保存到本地画廊");
    expect(script).toContain("sanctuary-pixiv-download");
    expect(script).not.toContain("isPromotionImage");
    expect(script).not.toContain("promotionImages");
    expect(script).not.toContain("booth.pm");
    expect(script).not.toContain("ipcRenderer");
    expect(script).not.toContain("querySelectorAll(\"*\")");
  });

  it("uses constrained scripts for blocked review and one-shot release", () => {
    expect(buildPixivBlockedReviewScript("https://i.pximg.net/img-original/1.jpg", ["blood"]))
      .toContain("setBlockedReview");
    expect(buildPixivReviewReleaseScript("https://i.pximg.net/img-original/1.jpg"))
      .toContain("releaseOneShot");
  });
});
