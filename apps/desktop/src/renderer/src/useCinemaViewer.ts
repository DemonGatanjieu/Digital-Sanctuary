import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type SyntheticEvent } from "react";
import {
  adjacentViewerPreloads, anchoredViewerPan, cinemaKeyboardAction, clampViewerPan,
  createViewerFrameScheduler, nativePixelZoom, wheelViewerZoom, type ViewerGeometry, type ViewerPoint, type ViewerPreloadPage
} from "./cinema-viewer";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex='0']";

export function useCinemaViewer(options: {
  imageKey: string;
  pages: readonly ViewerPreloadPage[];
  pageIndex: number;
  onPageChange: (index: number) => void;
  onClose: () => void;
  interactionSuspended: boolean;
  onDismissOverlay?: (() => void) | undefined;
}) {
  const latest = useRef(options);
  latest.current = options;
  const theaterRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const nativeZoomRef = useRef(1);
  const [nativeZoom, setNativeZoom] = useState(1);
  const [nativeMode, setNativeMode] = useState(false);
  const nativeModeRef = useRef(false);
  const panRef = useRef<ViewerPoint>({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; start: ViewerPoint; geometry: ViewerGeometry } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [loadState, setLoadState] = useState({ key: options.imageKey, status: "loading" as "loading" | "loaded" | "failed" });
  const [hudVisible, setHudVisible] = useState(true);
  const [displayProfile] = useState(() => typeof document === "undefined" ? "balanced" : document.querySelector(".app-shell")?.getAttribute("data-display-profile") ?? "balanced");
  const [reducedMotion] = useState(() => typeof document !== "undefined" && document.querySelector(".app-shell")?.getAttribute("data-reduced-motion") === "true");
  const activityRef = useRef(Date.now());
  const visibleRef = useRef(true);
  const preloadsRef = useRef(new Map<string, HTMLImageElement>());
  const schedulerRef = useRef<ReturnType<typeof createViewerFrameScheduler> | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = createViewerFrameScheduler(() => {
      if (imageRef.current) imageRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`;
    }, (paint) => window.requestAnimationFrame(paint), (id) => window.cancelAnimationFrame(id));
  }

  const geometry = useCallback((): ViewerGeometry => ({
    imageWidth: imageRef.current?.clientWidth ?? 0, imageHeight: imageRef.current?.clientHeight ?? 0,
    stageWidth: stageRef.current?.clientWidth ?? 0, stageHeight: stageRef.current?.clientHeight ?? 0
  }), []);

  const resetHudTimer = useCallback(() => {
    activityRef.current = Date.now();
    if (!visibleRef.current) { visibleRef.current = true; setHudVisible(true); }
  }, []);

  const changeZoom = useCallback((value: number, anchor: ViewerPoint = { x: 0, y: 0 }, native = false) => {
    const next = Math.max(0.5, Math.min(Math.max(5, nativeZoomRef.current), value));
    panRef.current = clampViewerPan(anchoredViewerPan(panRef.current, zoomRef.current, next, anchor), next, geometry());
    zoomRef.current = next;
    nativeModeRef.current = native;
    setZoom(next);
    setNativeMode(native);
    schedulerRef.current?.schedule();
    resetHudTimer();
  }, [geometry, resetHudTimer]);

  const resetZoom = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    changeZoom(1);
  }, [changeZoom]);

  const toggleNativeZoom = useCallback(() => {
    if (nativeModeRef.current) resetZoom();
    else { panRef.current = { x: 0, y: 0 }; changeZoom(nativeZoomRef.current, undefined, true); }
  }, [changeZoom, resetZoom]);

  const onImageLoad = useCallback((event?: SyntheticEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image || (event && event.currentTarget !== image)) return;
    nativeZoomRef.current = nativePixelZoom(image.naturalWidth, image.clientWidth);
    setNativeZoom(nativeZoomRef.current);
    setLoadState({ key: latest.current.imageKey, status: "loaded" });
    if (nativeModeRef.current) changeZoom(nativeZoomRef.current, undefined, true);
  }, [changeZoom]);
  const onImageError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    if (event.currentTarget === imageRef.current) setLoadState({ key: latest.current.imageKey, status: "failed" });
  }, []);

  useLayoutEffect(() => {
    dragRef.current = null;
    setIsPanning(false);
    zoomRef.current = 1;
    nativeZoomRef.current = 1;
    setNativeZoom(1);
    nativeModeRef.current = false;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setNativeMode(false);
    schedulerRef.current?.cancel();
    if (imageRef.current) imageRef.current.style.transform = "translate(0px, 0px) scale(1)";
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) onImageLoad();
    else setLoadState({ key: options.imageKey, status: "loading" });
    resetHudTimer();
    const active = theaterRef.current?.querySelector<HTMLElement>(".filmstrip-thumb-btn.active");
    const track = active?.parentElement;
    if (active && track) track.scrollLeft = Math.max(0, active.offsetLeft - (track.clientWidth - active.clientWidth) / 2);
  }, [options.imageKey, onImageLoad, resetHudTimer]);

  useEffect(() => {
    const image = imageRef.current;
    const stage = stageRef.current;
    if (!image || !stage) return;
    const observer = new ResizeObserver(() => {
      nativeZoomRef.current = nativePixelZoom(image.naturalWidth, image.clientWidth);
      setNativeZoom(nativeZoomRef.current);
      if (nativeModeRef.current) changeZoom(nativeZoomRef.current, undefined, true);
      else { panRef.current = clampViewerPan(panRef.current, zoomRef.current, geometry()); schedulerRef.current?.schedule(); }
    });
    observer.observe(image);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [options.imageKey, changeZoom, geometry]);

  useEffect(() => {
    const efficient = document.querySelector(".app-shell")?.getAttribute("data-display-profile") === "efficient";
    const urls = efficient ? [] : adjacentViewerPreloads(options.pages, options.pageIndex);
    const current = options.pages[options.pageIndex]?.url;
    for (const [url, image] of preloadsRef.current) {
      if (url === current || urls.includes(url)) continue;
      image.removeAttribute("src");
      preloadsRef.current.delete(url);
    }
    for (const url of urls) {
      if (url === current || preloadsRef.current.has(url)) continue;
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.src = url;
      preloadsRef.current.set(url, image);
    }
  }, [options.pages, options.pageIndex]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("lightbox-open");
    theaterRef.current?.focus();
    let timer: number;
    const hide = () => {
      const focused = document.activeElement;
      const hudFocused = focused instanceof Element && Boolean(focused.closest(".cinema-hud-island, .cinema-bottom-filmstrip"));
      const idle = Date.now() - activityRef.current;
      if (idle >= 3200 && !dragRef.current && !latest.current.interactionSuspended && !hudFocused) {
        visibleRef.current = false;
        setHudVisible(false);
      }
      timer = window.setTimeout(hide, idle < 3200 ? 3200 - idle : 600);
    };
    timer = window.setTimeout(hide, 3200);
    return () => {
      window.clearTimeout(timer);
      schedulerRef.current?.cancel();
      for (const image of preloadsRef.current.values()) image.removeAttribute("src");
      preloadsRef.current.clear();
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("lightbox-open");
      previousFocus?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (!options.interactionSuspended || document.querySelector(".dialog-overlay")) return;
    const drawer = theaterRef.current?.querySelector<HTMLElement>(".element-inspector-drawer, .cinema-radar-drawer");
    if (drawer && !drawer.contains(document.activeElement)) {
      drawer.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || document.querySelector(".dialog-overlay")) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Tab") {
        const scope = latest.current.interactionSuspended
          ? theaterRef.current?.querySelector<HTMLElement>(".element-inspector-drawer, .cinema-radar-drawer")
          : theaterRef.current;
        const focusable = [...(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !scope?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        resetHudTimer();
        return;
      }
      if (latest.current.interactionSuspended) {
        if (event.key === "Escape" && latest.current.onDismissOverlay) { event.preventDefault(); latest.current.onDismissOverlay(); }
        return;
      }
      const action = cinemaKeyboardAction({ key: event.key, editable: Boolean(target?.closest("input, textarea, select, [contenteditable='true']")), suspended: false, modified: event.ctrlKey || event.metaKey || event.altKey });
      if (action === "none") return;
      event.preventDefault();
      resetHudTimer();
      const opts = latest.current;
      if (action === "close") opts.onClose();
      else if (action === "previous") opts.onPageChange(Math.max(0, opts.pageIndex - 1));
      else if (action === "next") opts.onPageChange(Math.min(opts.pages.length - 1, opts.pageIndex + 1));
      else if (action === "first") opts.onPageChange(0);
      else if (action === "last") opts.onPageChange(opts.pages.length - 1);
      else if (action === "fit") resetZoom();
      else if (action === "native") toggleNativeZoom();
      else changeZoom(zoomRef.current + (action === "zoom-in" ? 0.25 : -0.25));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeZoom, resetHudTimer, resetZoom, toggleNativeZoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (latest.current.interactionSuspended || !event.deltaY || document.querySelector(".dialog-overlay")) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      changeZoom(wheelViewerZoom(zoomRef.current, event.deltaY, event.deltaMode, Math.max(5, nativeZoomRef.current)), anchor);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [changeZoom]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    resetHudTimer();
    if (event.button !== 0 || zoomRef.current <= 1 || latest.current.interactionSuspended) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX - panRef.current.x, y: event.clientY - panRef.current.y }, geometry: geometry() };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }, [geometry, resetHudTimer]);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panRef.current = clampViewerPan({ x: event.clientX - drag.start.x, y: event.clientY - drag.start.y }, zoomRef.current, drag.geometry);
    schedulerRef.current?.schedule();
    resetHudTimer();
  }, [resetHudTimer]);
  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
    resetHudTimer();
  }, [resetHudTimer]);
  const handleDoubleClick = useCallback(() => {
    if (!latest.current.interactionSuspended && !document.querySelector(".dialog-overlay")) toggleNativeZoom();
  }, [toggleNativeZoom]);

  const status = loadState.key === options.imageKey ? loadState.status : "loading";
  return {
    theaterRef, stageRef, imageRef, zoom, nativeMode, isPanning, hudVisible, displayProfile, reducedMotion,
    zoomPercent: Math.round(zoom / nativeZoom * 100),
    imageLoaded: status === "loaded", imageFailed: status === "failed",
    resetHudTimer, resetZoom, changeZoom, toggleNativeZoom, onImageLoad, onImageError,
    handlePointerDown, handlePointerMove, handlePointerUp, handleDoubleClick
  };
}
