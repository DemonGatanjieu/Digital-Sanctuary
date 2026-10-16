import { describe, expect, it, vi } from "vitest";
import { fetchPixivReviewImage, MAX_PIXIV_REVIEW_IMAGE_BYTES } from "./pixiv-review-fetch.js";

describe("isolated Pixiv review fetch", () => {
  it("uses the supplied Node fetch path with Pixiv referer instead of an Explore Session", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "3" }
    }));
    await expect(fetchPixivReviewImage(
      "https://i.pximg.net/img-master/148777878_p0_master1200.jpg?tracking=1",
      "https://www.pixiv.net/artworks/148777878",
      "fixture-agent",
      fetchImpl
    )).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://i.pximg.net/img-master/148777878_p0_master1200.jpg",
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.pixiv.net/artworks/148777878",
          "User-Agent": "fixture-agent"
        })
      })
    );
  });

  it("rejects non-images and oversized responses before model inference", async () => {
    const htmlFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("blocked", {
      status: 200,
      headers: { "content-type": "text/html" }
    }));
    await expect(fetchPixivReviewImage(
      "https://i.pximg.net/img-master/1_p0_master1200.jpg",
      "https://www.pixiv.net/artworks/1",
      "fixture-agent",
      htmlFetch
    )).rejects.toThrow("content type");

    const largeFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(MAX_PIXIV_REVIEW_IMAGE_BYTES + 1)
      }
    }));
    await expect(fetchPixivReviewImage(
      "https://i.pximg.net/img-master/1_p0_master1200.jpg",
      "https://www.pixiv.net/artworks/1",
      "fixture-agent",
      largeFetch
    )).rejects.toThrow("size limit");
    expect(largeFetch).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first thumbnail fetch fails transiently", async () => {
    const flakyFetch = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "3" }
      }));

    await expect(fetchPixivReviewImage(
      "https://i.pximg.net/img-master/148777878_p0_master1200.jpg",
      "https://www.pixiv.net/artworks/148777878",
      "fixture-agent",
      flakyFetch
    )).resolves.toEqual(Buffer.from([7, 8, 9]));
    expect(flakyFetch).toHaveBeenCalledTimes(2);
  });
});

