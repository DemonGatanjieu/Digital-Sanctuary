import type { InspectArtworkPage } from "@sanctuary/domain";
import { normalizePixivArtworkImageUrl } from "./explore-policy.js";

export function inspectorImageCandidates(
  providedUrl: unknown,
  pages: InspectArtworkPage[],
  activePageIndex: number
): string[] {
  const activePage = pages.find((page) => page.pageIndex === activePageIndex) ?? pages[activePageIndex];
  const candidates = [
    typeof providedUrl === "string" ? providedUrl : "",
    activePage?.regularUrl ?? "",
    activePage?.thumbUrl ?? ""
  ];
  const normalized = candidates
    .map((candidate) => normalizePixivArtworkImageUrl(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(normalized)];
}

export function describeInspectorFailure(
  error: unknown,
  runtime: { available: boolean; engine: string; executionProvider: string; error: string }
): string {
  const modelName = runtime.engine === "wd-swinv2-tagger-v3" ? "WD Tagger" : runtime.engine;
  if (!runtime.available) {
    return `本地 ${modelName} 当前未就绪：${runtime.error || "视觉进程已经停止"}。画廊图片不会因此被隐藏。`;
  }

  const raw = error instanceof Error ? error.message : String(error || "未知错误");
  const provider = runtime.executionProvider && runtime.executionProvider !== "unknown"
    ? `（${runtime.executionProvider}）`
    : "";
  if (/thumbnail|fetch|network|http\s*\d+|content type|empty|size limit|exceeds/i.test(raw)) {
    const reason = /HTTP\s*403/i.test(raw)
      ? "Pixiv 拒绝了本次图片请求（HTTP 403）"
      : /HTTP\s*404/i.test(raw)
        ? "Pixiv 没有返回这一页图片（HTTP 404）"
        : /exceeds|size limit/i.test(raw)
          ? "图片超过了单次检查的大小上限"
          : "图片请求失败或超时";
    return `本地 ${modelName} 已就绪${provider}，但${reason}；图片尚未送入模型。`;
  }
  return `本地 ${modelName} 已就绪${provider}，但本次分析没有完成：${raw}`;
}
