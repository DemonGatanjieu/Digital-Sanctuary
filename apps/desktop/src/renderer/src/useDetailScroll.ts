import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { ScrollPosition } from "./gallery-detail-session";
import { bindDetailScroll, type DetailScrollBinding } from "./detail-scroll";

export function useDetailScroll({ channel, containerRef, contentRef, items, position, onChange, enabled = true }: {
  channel: string;
  containerRef: RefObject<HTMLElement | null>;
  contentRef?: RefObject<HTMLElement | null>;
  items: readonly { id: string; assetId?: string | null }[];
  position: ScrollPosition | null;
  onChange: (position: ScrollPosition) => void;
  enabled?: boolean;
}): () => ScrollPosition | null {
  const bindingRef = useRef<DetailScrollBinding | null>(null);
  const lastPositionRef = useRef<{ channel: string; position: ScrollPosition } | null>(null);
  const bindingChannelRef = useRef(channel);
  useLayoutEffect(() => {
    const container = containerRef.current, content = contentRef?.current ?? container;
    if (!enabled || !container || !content) return;
    const previous = lastPositionRef.current;
    const binding = bindDetailScroll(container, content, items, previous?.channel === channel ? previous.position : position, (next) => {
      lastPositionRef.current = { channel, position: next }; onChange(next);
    });
    bindingChannelRef.current = channel;
    bindingRef.current = binding;
    return () => { binding.dispose(); if (bindingRef.current === binding) bindingRef.current = null; };
    // A binding owns one scope/mode. Snapshot writes alone must not schedule another restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, containerRef, contentRef, enabled, items]);
  return useCallback(() => {
    const position = bindingRef.current?.capture() ?? null;
    if (position) lastPositionRef.current = { channel: bindingChannelRef.current, position };
    return position;
  }, []);
}
