import { isAllowedPixivNavigation, normalizePixivArtworkImageUrl, PIXIV_HOME_URL } from "./explore-policy.js";

export const MAX_PIXIV_REVIEW_IMAGE_BYTES = 12 * 1024 * 1024;
export const PIXIV_REVIEW_FETCH_TIMEOUT_MS = 10_000;

class NonRetryableReviewFetchError extends Error {}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchPixivReviewImage(
  imageUrl: string,
  referrer: string,
  userAgent: string,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<Buffer> {
  const normalizedUrl = normalizePixivArtworkImageUrl(imageUrl);
  if (!normalizedUrl) throw new Error("Review image URL is not an allowed Pixiv artwork image");
  const safeReferrer = isAllowedPixivNavigation(referrer) ? referrer : PIXIV_HOME_URL;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(normalizedUrl, {
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: safeReferrer,
          "User-Agent": userAgent
        },
        signal: AbortSignal.timeout(PIXIV_REVIEW_FETCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        const statusError = new Error(`Thumbnail download failed: HTTP ${response.status}`);
        if (!shouldRetryStatus(response.status)) {
          throw new NonRetryableReviewFetchError(statusError.message);
        }
        throw statusError;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        throw new NonRetryableReviewFetchError(`Unexpected thumbnail content type: ${contentType || "unknown"}`);
      }
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredSize) && declaredSize > MAX_PIXIV_REVIEW_IMAGE_BYTES) {
        throw new NonRetryableReviewFetchError("Thumbnail exceeds the review size limit");
      }

      const imageBytes = Buffer.from(await response.arrayBuffer());
      if (imageBytes.length === 0 || imageBytes.length > MAX_PIXIV_REVIEW_IMAGE_BYTES) {
        throw new NonRetryableReviewFetchError("Thumbnail is empty or exceeds the review size limit");
      }
      return imageBytes;
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableReviewFetchError || attempt === 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Thumbnail download failed");
}

