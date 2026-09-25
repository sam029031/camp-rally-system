"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => undefined;
}

/** SSR / hydration 期間為 false，之後為 true（portal 等只能在瀏覽器渲染的內容用） */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
