import { useEffect, useLayoutEffect, useRef } from "react";
import { WorkReadingRecorder } from "./work-reading";

export function useWorkReading({ workId, assetId, resolveAssetId, imageLoaded, onSaved, onError }: {
  workId: string;
  assetId: string | null;
  resolveAssetId?: () => Promise<string | null>;
  imageLoaded: boolean;
  onSaved: () => Promise<void> | void;
  onError: (error: unknown) => void;
}): void {
  const callbacks = useRef({ onSaved, onError });
  useLayoutEffect(() => { callbacks.current = { onSaved, onError }; });
  const recorder = useRef<WorkReadingRecorder | null>(null);
  if (!recorder.current) recorder.current = new WorkReadingRecorder(
    (currentWorkId, currentAssetId) => window.sanctuary.recordWorkView(currentWorkId, currentAssetId),
    (error) => callbacks.current.onError(error)
  );

  useEffect(() => {
    if (!imageLoaded) return;
    if (assetId) recorder.current?.loaded(workId, assetId);
    else if (resolveAssetId) recorder.current?.loadedResolved(workId, resolveAssetId);
  }, [workId, assetId, resolveAssetId, imageLoaded]);

  useEffect(() => () => {
    // Closing is immediate; persistence and recent-list refresh complete in order afterward.
    void recorder.current?.flush().then((changed) => {
      if (changed) return callbacks.current.onSaved();
    }).catch((error: unknown) => callbacks.current.onError(error));
  }, []);
}
