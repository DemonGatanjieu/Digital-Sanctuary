export type ViewerPoint = { x: number; y: number };
export type ViewerGeometry = { imageWidth: number; imageHeight: number; stageWidth: number; stageHeight: number };

export function nativePixelZoom(naturalWidth: number, displayedWidth: number): number {
  return naturalWidth > 0 && displayedWidth > 0 ? naturalWidth / displayedWidth : 1;
}

export function clampViewerPan(pan: ViewerPoint, zoom: number, geometry: ViewerGeometry): ViewerPoint {
  if (zoom <= 1) return { x: 0, y: 0 };
  const limitX = Math.max(0, (geometry.imageWidth * zoom - geometry.stageWidth) / 2);
  const limitY = Math.max(0, (geometry.imageHeight * zoom - geometry.stageHeight) / 2);
  return { x: Math.max(-limitX, Math.min(limitX, pan.x)), y: Math.max(-limitY, Math.min(limitY, pan.y)) };
}

export function anchoredViewerPan(pan: ViewerPoint, previousZoom: number, nextZoom: number, anchor: ViewerPoint): ViewerPoint {
  const ratio = nextZoom / previousZoom;
  return { x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio };
}

export function wheelViewerZoom(zoom: number, deltaY: number, deltaMode: number, maximum: number): number {
  const delta = Math.max(-100, Math.min(100, deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1)));
  return Math.max(0.5, Math.min(maximum, zoom * Math.exp(-delta * 0.002)));
}

export type CinemaKeyboardAction = "none" | "close" | "previous" | "next" | "first" | "last" | "fit" | "native" | "zoom-in" | "zoom-out";

export function cinemaKeyboardAction({ key, editable, suspended, modified }: { key: string; editable: boolean; suspended: boolean; modified: boolean }): CinemaKeyboardAction {
  if (suspended || modified) return "none";
  if (key === "Escape") return "close";
  if (editable) return "none";
  if (key === "ArrowLeft") return "previous";
  if (key === "ArrowRight") return "next";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "0" || key.toLowerCase() === "r") return "fit";
  if (key === "1") return "native";
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  return "none";
}

export type ViewerPreloadPage = { url: string; width?: number | null; height?: number | null; byteLength?: number | null };

export function adjacentViewerPreloads(pages: readonly ViewerPreloadPage[], index: number): string[] {
  // A huge original stays on demand; even a two-page lookahead can otherwise retain hundreds of MB.
  return [...new Set([pages[index + 1], pages[index - 1]].filter((page): page is ViewerPreloadPage => Boolean(page))
    .filter((page) => (page.byteLength ?? 0) <= 32 * 1024 * 1024 && (page.width ?? 0) * (page.height ?? 0) <= 40_000_000)
    .map((page) => page.url))];
}

export function createViewerFrameScheduler(paint: () => void, request: (paint: () => void) => number, cancel: (id: number) => void) {
  let frame: number | null = null;
  return {
    schedule() {
      if (frame !== null) return;
      frame = request(() => { frame = null; paint(); });
    },
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
    }
  };
}
