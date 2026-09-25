"use client";

/**
 * 保持亮屏（第十六、十七節）。
 *
 * - 計時中／跑關中用 navigator.wakeLock.request('screen')。
 * - 頁面回到前景（visibilitychange → visible）要重新 request（系統在背景時會自動釋放）。
 * - 失敗靜默略過；無法取得時，頂端顯示一次提示「此裝置無法保持亮屏，請到設定把自動鎖定改成永不」。
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

export const WAKE_LOCK_HINT = "此裝置無法保持亮屏，請到設定把自動鎖定改成永不";

type HintState = "none" | "show" | "dismissed";

// 整個分頁只提示一次（多個元件共用）
let hintState: HintState = "none";
const hintListeners = new Set<() => void>();

function setHint(next: HintState): void {
  if (hintState === next) return;
  // 一旦關掉就不再出現
  if (hintState === "dismissed") return;
  hintState = next;
  for (const l of hintListeners) l();
}

function subscribeHint(l: () => void): () => void {
  hintListeners.add(l);
  return () => {
    hintListeners.delete(l);
  };
}

function getHint(): HintState {
  return hintState;
}

function getServerHint(): HintState {
  return "none";
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return wl && typeof wl.request === "function" ? wl : null;
}

export interface WakeLockView {
  /** 要顯示的提示（只顯示一次）；null = 不顯示 */
  hint: string | null;
  /** 關閉提示（之後不再出現） */
  dismissHint: () => void;
}

/**
 * @param active true 時保持亮屏（例如關卡計時中、跑關中）
 */
export function useWakeLock(active: boolean): WakeLockView {
  const hint = useSyncExternalStore(subscribeHint, getHint, getServerHint);

  useEffect(() => {
    if (!active) return;
    const api = getWakeLock();
    if (!api) {
      setHint("show");
      return;
    }

    let disposed = false;
    let sentinel: WakeLockSentinelLike | null = null;
    let requesting = false;

    const acquire = async () => {
      if (disposed || requesting || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      requesting = true;
      try {
        const s = await api.request("screen");
        if (disposed) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
      } catch {
        // 省電模式、權限政策、iOS 舊版等：靜默略過，只提示一次
        if (!disposed) setHint("show");
      } finally {
        requesting = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);

  const dismissHint = useCallback(() => setHint("dismissed"), []);
  return { hint: hint === "show" ? WAKE_LOCK_HINT : null, dismissHint };
}
