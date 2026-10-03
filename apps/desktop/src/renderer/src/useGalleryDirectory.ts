import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GalleryScope } from "@sanctuary/domain";
import type { GalleryMode } from "./GalleryView";
import { emptyGalleryDirectory, GalleryDirectoryController, galleryScopeKey } from "./gallery-directory-controller";

export function useGalleryDirectory(mode: GalleryMode, scope: GalleryScope | null, active: boolean, onError: (error: unknown) => void) {
  const [state, setState] = useState(emptyGalleryDirectory);
  const controllerRef = useRef<GalleryDirectoryController | null>(null);
  if (!controllerRef.current) controllerRef.current = new GalleryDirectoryController(window.sanctuary, setState, onError);
  const controller = controllerRef.current;
  useLayoutEffect(() => { controller.setContext(mode, scope, active); }, [controller, mode, scope, active]);
  useEffect(() => () => controller.invalidate(), [controller]);
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const refreshDirectory = useCallback(() => controller.refreshDirectory(), [controller]);
  const loadMoreSavedViews = useCallback(() => controller.loadMoreSavedViews(), [controller]);
  const scopeMatches = state.scopedKey === galleryScopeKey(scope);
  return { ...state, scopedArtworks: scopeMatches ? state.scopedArtworks : [],
    scopeLoading: state.scopeLoading || (active && mode !== "flat" && Boolean(scope) && !scopeMatches),
    refresh, refreshDirectory, loadMoreSavedViews };
}
