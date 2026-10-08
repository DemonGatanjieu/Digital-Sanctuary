import { describe, expect, it } from "vitest";
import { exploreInputUrl, publicWebUrl, isPrivateAddress } from "./web-explore-policy.js";

describe("explicit web exploration inputs", () => {
  it("opens a site or performs an encoded image search", () => {
    expect(exploreInputUrl("example.org/gallery?q=1")).toBe("https://example.org/gallery?q=1");
    expect(exploreInputUrl("雨夜 街景 & 天空")).toBe(`https://www.bing.com/images/search?q=${encodeURIComponent("雨夜 街景 & 天空")}`);
    expect(exploreInputUrl("https://www.pixiv.net/artworks/123")).toContain("/artworks/123");
  });
  it.each(["file:///C:/secret.png", "javascript:alert(1)", "data:image/png;base64,a", "sanctuary-image://local/a", "https://user:password@example.org", "https://127.0.0.1/a", "http://2130706433/a", "http://[::ffff:7f00:1]/", "http://192.168.1.1/", "https://localhost/", "https://server.local/"])("rejects privileged or private target %s", url => {
    expect(() => publicWebUrl(url)).toThrow();
  });
  it("also catches private addresses returned by DNS", () => {
    for (const address of ["127.1.2.3", "169.254.169.254", "10.1.1.1", "172.16.0.1", "100.64.0.1", "::1", "fd00::1"]) expect(isPrivateAddress(address)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});
