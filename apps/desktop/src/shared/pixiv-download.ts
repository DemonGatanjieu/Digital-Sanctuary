export type PixivPageKind = "artwork" | "bookmarks" | "other";

export interface PixivPageContext {
  kind: PixivPageKind;
  artworkId: string;
  bookmarkUserId: string;
}

export interface PixivArtworkPage {
  index: number;
  originalUrl: string;
}

export interface PixivBookmarkPage {
  artworkIds: string[];
  total: number;
}

export interface PixivArtworkMetadata {
  artworkId: string;
  title: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
}

export type ExploreDownloadPhase =
  | "idle"
  | "discovering"
  | "downloading"
  | "complete"
  | "partial"
  | "error"
  | "cancelled";

export type ExploreDownloadScope = "current" | "bookmarks" | null;

export interface ExploreDownloadState {
  phase: ExploreDownloadPhase;
  scope: ExploreDownloadScope;
  totalArtworks: number;
  completedArtworks: number;
  failedArtworks: number;
  totalPages: number;
  completedPages: number;
  skippedPages: number;
  lastFailure: string;
  message: string;
}

export interface BookmarkDownloadPreview {
  userId: string;
  total: number;
}

export interface ExploreDownloadResult {
  completedArtworks: number;
  failedArtworks: number;
  downloadedPages: number;
  skippedPages: number;
  lastFailure: string;
  destination: string;
}

const PIXIV_HOSTS = new Set(["www.pixiv.net", "pixiv.net"]);
const PIXIV_IMAGE_HOST = "i.pximg.net";

export const IDLE_EXPLORE_DOWNLOAD_STATE: ExploreDownloadState = {
  phase: "idle",
  scope: null,
  totalArtworks: 0,
  completedArtworks: 0,
  failedArtworks: 0,
  totalPages: 0,
  completedPages: 0,
  skippedPages: 0,
  lastFailure: "",
  message: ""
};

export function completedDownloadPhase(
  completedArtworks: number,
  failedArtworks: number
): ExploreDownloadPhase {
  if (failedArtworks === 0) return "complete";
  return completedArtworks > 0 ? "partial" : "error";
}

export function hasContiguousPixivPages(pageIndexes: readonly number[]): boolean {
  if (pageIndexes.length === 0) return false;
  const sorted = [...pageIndexes].sort((left, right) => left - right);
  if (new Set(sorted).size !== sorted.length) return false;
  return sorted.every((pageIndex, index) => pageIndex === index);
}

export function reachedConsecutiveFailureLimit(
  consecutiveFailures: number,
  limit = 5
): boolean {
  return consecutiveFailures >= limit;
}

export function parsePixivPageContext(value: string): PixivPageContext {
  const empty: PixivPageContext = {
    kind: "other",
    artworkId: "",
    bookmarkUserId: ""
  };
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !PIXIV_HOSTS.has(url.hostname)) return empty;
    const artworkMatch = url.pathname.match(/^\/artworks\/(\d+)(?:\/|$)/);
    const artworkId = artworkMatch?.[1];
    if (artworkId) {
      return { kind: "artwork", artworkId, bookmarkUserId: "" };
    }
    const bookmarkMatch = url.pathname.match(
      /^\/users\/(\d+)\/bookmarks\/artworks(?:\/|$)/
    );
    const bookmarkUserId = bookmarkMatch?.[1];
    if (bookmarkUserId) {
      return {
        kind: "bookmarks",
        artworkId: "",
        bookmarkUserId
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

export function parsePixivArtworkPages(value: unknown): PixivArtworkPage[] {
  const envelope = asRecord(value);
  if (!envelope || envelope.error !== false || !Array.isArray(envelope.body)) {
    throw new Error("Pixiv 返回了无法识别的作品页数据");
  }
  if (envelope.body.length === 0 || envelope.body.length > 1_000) {
    throw new Error("Pixiv 返回的作品页数量异常");
  }
  return envelope.body.map((item, index) => {
    const page = asRecord(item);
    const urls = asRecord(page?.urls);
    const originalUrl = urls?.original;
    if (typeof originalUrl !== "string" || !isPixivOriginalImageUrl(originalUrl)) {
      throw new Error(`Pixiv 第 ${index + 1} 页缺少可用原图地址`);
    }
    return { index, originalUrl };
  });
}

export function parsePixivBookmarkPage(value: unknown): PixivBookmarkPage {
  const envelope = asRecord(value);
  const body = asRecord(envelope?.body);
  if (envelope?.error !== false || !body || !Array.isArray(body.works)) {
    throw new Error("Pixiv 返回了无法识别的收藏数据");
  }
  const total = normalizeCount(body.total);
  const artworkIds = body.works.map((work, index) => {
    const id = asRecord(work)?.id;
    const normalized = typeof id === "number" ? String(id) : id;
    if (typeof normalized !== "string" || !/^\d+$/.test(normalized)) {
      throw new Error(`Pixiv 收藏列表第 ${index + 1} 项缺少作品 ID`);
    }
    return normalized;
  });
  return { artworkIds: [...new Set(artworkIds)], total };
}

export function parsePixivArtworkMetadata(
  value: unknown,
  artworkId: string
): PixivArtworkMetadata {
  const envelope = asRecord(value);
  const body = asRecord(envelope?.body);
  if (envelope?.error !== false || !body) {
    throw new Error("Pixiv 返回了无法识别的作品信息");
  }
  const authorId = normalizeId(body.userId);
  const title = normalizeDisplayText(body.title, `作品 ${artworkId}`);
  const authorName = normalizeDisplayText(body.userName, `作者 ${authorId}`);

  let authorAvatarUrl: string | null = null;
  if (typeof body.userUrl === "string" && isPixivOriginalImageUrl(body.userUrl)) {
    authorAvatarUrl = body.userUrl;
  } else {
    // Sometimes it's nested or named differently, try common Pixiv patterns
    const userDict = asRecord(body.user);
    if (userDict && typeof userDict.imageBig === "string" && isPixivOriginalImageUrl(userDict.imageBig)) {
      authorAvatarUrl = userDict.imageBig;
    } else if (userDict && typeof userDict.image === "string" && isPixivOriginalImageUrl(userDict.image)) {
      authorAvatarUrl = userDict.image;
    } else {
      const userIllusts = asRecord(body.userIllusts);
      if (userIllusts) {
        const firstIllust = Object.values(userIllusts)[0] as any;
        if (firstIllust && typeof firstIllust.profileImageUrl === "string" && isPixivOriginalImageUrl(firstIllust.profileImageUrl)) {
          authorAvatarUrl = firstIllust.profileImageUrl;
        }
      }
      if (!authorAvatarUrl) {
        const zengo = (asRecord(body.noLoginData)?.zengoIdWorks as any)?.[0];
        if (zengo && typeof zengo.profileImageUrl === "string" && isPixivOriginalImageUrl(zengo.profileImageUrl)) {
          authorAvatarUrl = zengo.profileImageUrl;
        }
      }
    }
  }
  if (authorAvatarUrl && authorAvatarUrl.includes("no_profile")) {
    authorAvatarUrl = null;
  }

  return { artworkId, title, authorId, authorName, authorAvatarUrl };
}

export function safePixivImageExtension(imageUrl: string, contentType = ""): string {
  const fromType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif"
  };
  const normalizedType = (contentType.split(";", 1)[0] ?? "").trim().toLowerCase();
  const extensionFromType = fromType[normalizedType];
  if (extensionFromType) return extensionFromType;
  try {
    const match = new URL(imageUrl).pathname.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif)$/);
    const extension = match?.[1];
    if (!extension) return ".jpg";
    return extension === "jpeg" ? ".jpg" : `.${extension}`;
  } catch {
    return ".jpg";
  }
}

export function isPixivOriginalImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === PIXIV_IMAGE_HOST;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function normalizeCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
    throw new Error("Pixiv 返回的收藏总数异常");
  }
  return count;
}

function normalizeId(value: unknown): string {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^\d+$/.test(normalized)) {
    throw new Error("Pixiv 作品信息缺少作者 ID");
  }
  return normalized;
}

function normalizeDisplayText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, 300);
  return normalized || fallback;
}
