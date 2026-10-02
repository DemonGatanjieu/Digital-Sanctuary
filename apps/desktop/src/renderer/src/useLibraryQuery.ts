import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { WorkQuery } from "@sanctuary/domain";
import { EMPTY_WORK_RESULT, INITIAL_WORK_QUERY, LibraryQueryController } from "./library-query-controller";

export function useLibraryQuery(onError: (error: unknown) => void) {
  const [state, setState] = useState({ query: INITIAL_WORK_QUERY, result: EMPTY_WORK_RESULT, loading: true });
  const controllerRef = useRef<LibraryQueryController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new LibraryQueryController((query) => window.sanctuary.queryWorks(query), setState, onError);
  }
  const controller = controllerRef.current;
  const setQuery = useCallback((next: SetStateAction<WorkQuery>) => {
    controller.changeQuery(typeof next === "function" ? next(controller.state.query) : next);
  }, [controller]);
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const loadMore = useCallback(() => controller.loadMore(), [controller]);

  useEffect(() => {
    const timer = window.setTimeout(() => void controller.refresh(), state.query.search ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [controller, state.query]);
  useEffect(() => () => controller.invalidate(), [controller]);

  return { query: state.query, result: state.result, loading: state.loading, setQuery, refresh, loadMore };
}
