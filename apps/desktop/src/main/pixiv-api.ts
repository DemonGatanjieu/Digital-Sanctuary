import type { Session } from "electron";
import type { AsyncTaskGate } from "../shared/bounded-concurrency.js";
import {
  parsePixivArtistProfile,
  parsePixivArtworkMetadata,
  parsePixivArtworkPages,
  parsePixivBookmarkPage,
  type PixivArtworkMetadata,
  type PixivArtworkPage
} from "../shared/pixiv-download.js";
import { PIXIV_HOME_URL } from "./explore-policy.js";

export const PIXIV_BOOKMARK_PAGE_SIZE = 48;
const PIXIV_API_DELAY_MS = 800;
const PIXIV_API_MAX_RETRIES = 2;

/** Stops a whole batch (rate limit, expired login, repeated network failure) instead of failing one work. */
export class PixivBatchAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PixivBatchAbortError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function pixivRetryDelay(response: Pick<Response, "headers"> | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim() ?? "";
  const seconds = Number(retryAfter);
  const headerDelay = retryAfter && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 0;
  const fallback = attempt === 0 ? 5_000 : 15_000;
  return Math.min(30_000, Math.max(headerDelay, fallback));
}

export interface PixivProgress { message?: string; totalArtworks?: number }
type PixivSession = Pick<Session, "fetch">;

/**
 * Pixiv AJAX client shared by downloads and avatar repair: one global request spacing,
 * bounded retries for 429 / 5xx / network errors, and batch-stopping errors for login loss.
 */
export class PixivApiClient {
  #nextCall = 0;

  constructor(
    private readonly gate: AsyncTaskGate,
    private readonly report: (progress: PixivProgress) => void,
    private readonly sleep: (milliseconds: number) => Promise<void> = delay,
    private readonly minIntervalMs = PIXIV_API_DELAY_MS
  ) {}

  async fetchJson(targetSession: PixivSession, url: string, referrer: string): Promise<unknown> {
    let attempt = 0;
    const retry = async (response: Response | null, reason: string) => {
      const backoffMs = pixivRetryDelay(response, attempt);
      attempt += 1;
      this.report({ message: `${reason}，${Math.ceil(backoffMs / 1_000)} 秒后重试 (${attempt}/${PIXIV_API_MAX_RETRIES})…` });
      await this.sleep(backoffMs);
    };
    while (true) {
      await this.#waitForSlot();
      let response: Response;
      try {
        response = await this.gate.run(() => targetSession.fetch(url, {
          credentials: "include",
          referrer,
          headers: { Accept: "application/json", Referer: referrer },
          bypassCustomProtocolHandlers: true
        }));
      } catch (networkError) {
        if (attempt >= PIXIV_API_MAX_RETRIES) throw new PixivBatchAbortError(`Pixiv 网络连续失败，批量任务已停止：${errorMessage(networkError)}`);
        await retry(null, "网络异常");
        continue;
      }
      if (response.status === 429) {
        if (attempt >= PIXIV_API_MAX_RETRIES) throw new PixivBatchAbortError("Pixiv 已限制请求频率，批量任务已停止。请稍后从收藏页重新开始，已保存作品会自动跳过。");
        await retry(response, "Pixiv 频率限制");
        continue;
      }
      if (response.status === 401) throw new PixivBatchAbortError("Pixiv 登录会话已失效，请重新登录后再继续下载");
      if (response.status === 403) throw new Error("作品不可访问、已删除或当前账号无权读取 (HTTP 403)");
      if (response.status >= 500 && response.status <= 599) {
        if (attempt >= PIXIV_API_MAX_RETRIES) throw new PixivBatchAbortError(`Pixiv 服务连续返回 HTTP ${response.status}，批量任务已停止`);
        await retry(response, "Pixiv 服务暂时异常");
        continue;
      }
      if (!response.ok) throw new Error(`Pixiv 数据请求失败：HTTP ${response.status}`);
      try {
        return await response.json();
      } catch {
        throw new Error("Pixiv 返回的不是有效 JSON 数据");
      }
    }
  }

  async bookmarkTotal(targetSession: PixivSession, userId: string): Promise<number> {
    const visible = await this.bookmarkPage(targetSession, userId, "show", 0);
    let hiddenTotal = 0;
    try {
      hiddenTotal = (await this.bookmarkPage(targetSession, userId, "hide", 0)).total;
    } catch (error) {
      console.info("[pixiv-download] private bookmarks are unavailable", error);
    }
    return visible.total + hiddenTotal;
  }

  async allBookmarkIds(targetSession: PixivSession, userId: string): Promise<string[]> {
    const allIds = new Set<string>();
    for (const visibility of ["show", "hide"] as const) {
      try {
        let offset = 0;
        let total = Number.POSITIVE_INFINITY;
        while (offset < total) {
          const page = await this.bookmarkPage(targetSession, userId, visibility, offset);
          total = page.total;
          for (const artworkId of page.artworkIds) allIds.add(artworkId);
          this.report({ totalArtworks: allIds.size, message: `已读取 ${allIds.size} 个收藏作品…` });
          if (page.artworkIds.length === 0) break;
          offset += PIXIV_BOOKMARK_PAGE_SIZE;
        }
      } catch (error) {
        if (visibility === "show") throw error;
        console.info("[pixiv-download] private bookmarks are unavailable", error);
      }
    }
    return [...allIds];
  }

  async bookmarkPage(targetSession: PixivSession, userId: string, visibility: "show" | "hide", offset: number) {
    const endpoint = new URL(`/ajax/user/${encodeURIComponent(userId)}/illusts/bookmarks`, PIXIV_HOME_URL);
    endpoint.searchParams.set("tag", "");
    endpoint.searchParams.set("offset", String(offset));
    endpoint.searchParams.set("limit", String(PIXIV_BOOKMARK_PAGE_SIZE));
    endpoint.searchParams.set("rest", visibility);
    endpoint.searchParams.set("lang", "zh");
    return parsePixivBookmarkPage(await this.fetchJson(targetSession, endpoint.toString(), `${PIXIV_HOME_URL}users/${userId}/bookmarks/artworks`));
  }

  async artworkPages(targetSession: PixivSession, artworkId: string): Promise<PixivArtworkPage[]> {
    const endpoint = new URL(`/ajax/illust/${encodeURIComponent(artworkId)}/pages`, PIXIV_HOME_URL);
    endpoint.searchParams.set("lang", "zh");
    return parsePixivArtworkPages(await this.fetchJson(targetSession, endpoint.toString(), `${PIXIV_HOME_URL}artworks/${artworkId}`));
  }

  async artworkMetadata(targetSession: PixivSession, artworkId: string): Promise<PixivArtworkMetadata> {
    const endpoint = new URL(`/ajax/illust/${encodeURIComponent(artworkId)}`, PIXIV_HOME_URL);
    endpoint.searchParams.set("lang", "zh");
    return parsePixivArtworkMetadata(await this.fetchJson(targetSession, endpoint.toString(), `${PIXIV_HOME_URL}artworks/${artworkId}`), artworkId);
  }

  async artistProfile(targetSession: PixivSession, authorId: string) {
    const endpoint = new URL(`/ajax/user/${encodeURIComponent(authorId)}`, PIXIV_HOME_URL);
    endpoint.searchParams.set("full", "1");
    endpoint.searchParams.set("lang", "zh");
    return parsePixivArtistProfile(await this.fetchJson(targetSession, endpoint.toString(), `${PIXIV_HOME_URL}users/${authorId}`), authorId);
  }

  async #waitForSlot(): Promise<void> {
    const now = Date.now();
    const waitTime = Math.max(0, this.#nextCall - now);
    this.#nextCall = now + waitTime + this.minIntervalMs;
    if (waitTime > 0) await this.sleep(waitTime);
  }
}
