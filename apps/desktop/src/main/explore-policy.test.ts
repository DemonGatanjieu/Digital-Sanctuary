import { describe, expect, it } from "vitest";
import {
  isAllowedPixivNavigation,
  isPixivArtworkImageUrl,
  normalizePixivArtworkImageUrl,
  parseExploreBounds,
  nativeExploreBounds,
  pixivArtistUrl,
  PIXIV_LOGIN_URL,
  PIXIV_PASSWORD_SETUP_URL,
  shouldAllowPixivLoginPermission,
  shouldBlockExploreAdRequest,
  shouldBlockExploreResource
} from "./explore-policy.js";

describe("Pixiv exploration policy", () => {
  it("allows only HTTPS Pixiv top-level navigation", () => {
    expect(isAllowedPixivNavigation("https://www.pixiv.net/artworks/1")).toBe(true);
    expect(isAllowedPixivNavigation("https://accounts.pixiv.net/login")).toBe(true);
    expect(isAllowedPixivNavigation(PIXIV_LOGIN_URL)).toBe(true);
    expect(isAllowedPixivNavigation(PIXIV_PASSWORD_SETUP_URL)).toBe(true);
    expect(isAllowedPixivNavigation("http://www.pixiv.net/")).toBe(false);
    expect(isAllowedPixivNavigation("https://pixiv.net.example.com/")).toBe(false);
    expect(isAllowedPixivNavigation("https://example.com/")).toBe(false);
  });

  it("builds artist navigation only from a bounded numeric Pixiv id", () => {
    expect(pixivArtistUrl(" 76840940 ")).toBe("https://www.pixiv.net/users/76840940");
    expect(pixivArtistUrl("../../login")).toBeNull();
    expect(pixivArtistUrl("1?redirect=https://evil.test")).toBeNull();
    expect(pixivArtistUrl("1".repeat(21))).toBeNull();
  });

  it("recognizes only Pixiv artwork image URLs for AI review", () => {
    expect(isPixivArtworkImageUrl(
      "https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/01/01/00/00/00/1_p0_square1200.jpg"
    )).toBe(true);
    expect(isPixivArtworkImageUrl(
      "https://i.pximg.net/img-original/img/2026/01/01/00/00/00/1_p0.png"
    )).toBe(true);
    expect(isPixivArtworkImageUrl("https://i.pximg.net/user-profile/img/1.jpg")).toBe(false);
    expect(isPixivArtworkImageUrl("https://s.pximg.net/common/images/logo.svg")).toBe(false);
    expect(isPixivArtworkImageUrl("https://i.pximg.net.evil.test/img-master/1.jpg")).toBe(false);
  });

  it("normalizes artwork URLs without mixing tracking query strings into cache keys", () => {
    expect(normalizePixivArtworkImageUrl(
      "https://i.pximg.net/img-original/1.png?format=webp#preview"
    )).toBe("https://i.pximg.net/img-original/1.png");
    expect(normalizePixivArtworkImageUrl("https://www.pixiv.net/artworks/1")).toBeNull();
  });

  it("allows UI images but keeps media fail-closed", () => {
    expect(shouldBlockExploreResource("image")).toBe(false);
    expect(shouldBlockExploreResource("media")).toBe(true);
    expect(shouldBlockExploreResource("script")).toBe(false);
    expect(shouldBlockExploreResource("xhr")).toBe(false);
  });

  it("blocks ad hosts and non-Pixiv subframes without hostname spoofing gaps", () => {
    expect(shouldBlockExploreAdRequest(
      "script",
      "https://securepubads.g.doubleclick.net/tag/js/gpt.js"
    )).toBe(true);
    expect(shouldBlockExploreAdRequest(
      "xhr",
      "https://ads.pubmatic.com/AdServer/js/user_sync.html"
    )).toBe(true);
    expect(shouldBlockExploreAdRequest("subFrame", "https://example.com/embed")).toBe(true);
    expect(shouldBlockExploreAdRequest("subFrame", "https://accounts.pixiv.net/login"))
      .toBe(false);
    expect(shouldBlockExploreAdRequest(
      "script",
      "https://doubleclick.net.evil.test/script.js"
    )).toBe(false);
  });

  it("allows only reCAPTCHA storage access while the Pixiv login page is active", () => {
    const loginUrl = "https://accounts.pixiv.net/login";
    const recaptchaUrl = "https://www.recaptcha.net/recaptcha/enterprise/anchor";
    expect(shouldAllowPixivLoginPermission("storage-access", recaptchaUrl, loginUrl))
      .toBe(true);
    expect(shouldAllowPixivLoginPermission("media", recaptchaUrl, loginUrl)).toBe(false);
    expect(shouldAllowPixivLoginPermission("storage-access", recaptchaUrl, PIXIV_LOGIN_URL))
      .toBe(false);
    expect(shouldAllowPixivLoginPermission("storage-access", "https://evil.test/", loginUrl))
      .toBe(false);
    expect(shouldBlockExploreResource("image", recaptchaUrl, loginUrl)).toBe(false);
    expect(shouldBlockExploreAdRequest("subFrame", recaptchaUrl, loginUrl)).toBe(false);
    expect(shouldBlockExploreResource("image", "https://i.pximg.net/example.jpg", loginUrl))
      .toBe(false);
  });

  it("accepts and rounds safe renderer bounds", () => {
    expect(parseExploreBounds({ x: 224.4, y: 142.6, width: 900.2, height: 600.8 }))
      .toEqual({ x: 224, y: 143, width: 900, height: 601 });
    expect(parseExploreBounds({ x: 0, y: 0, width: 20, height: 20 })).toBeNull();
    expect(parseExploreBounds({ x: 0, y: 0, width: Number.NaN, height: 500 }))
      .toBeNull();
  });
  it.each([1, 1.25, 1.5])("maps CSS rectangles to native View coordinates at zoom %s", (zoom) => {
    expect(nativeExploreBounds({ x: 190, y: 80, width: 710, height: 540 }, zoom)).toEqual({
      x: Math.round(190 * zoom), y: Math.round(80 * zoom), width: Math.round(710 * zoom), height: Math.round(540 * zoom)
    });
  });
});
