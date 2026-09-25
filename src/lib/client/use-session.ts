"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { LogoutResponse, MeResponse } from "@/lib/api/contract";
import type { SessionInfo } from "@/lib/types";
import { getApi, postApi, SESSION_EXPIRED_EVENT } from "@/lib/client/api";

export interface SessionState {
  /** loading = 第一次讀取中；ready = 已知結果（session 可能為 null = 未登入）；error = 讀取失敗（網路） */
  status: "loading" | "ready" | "error";
  session: SessionInfo | null;
  /** server 的 APP_ENV（development / demo / production …） */
  appEnv: string | null;
  error: string | null;
  /** session 被 server 判定失效（改 PIN、停用）→ 頁面應導向 /login */
  expired: boolean;
}

let state: SessionState = { status: "loading", session: null, appEnv: null, error: null, expired: false };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let loadedOnce = false;
let expiryListenerInstalled = false;

function setState(next: SessionState): void {
  state = next;
  for (const l of listeners) l();
}

/** 重新讀取 GET /api/auth/me（多個元件同時呼叫只會送一次） */
export function refreshSession(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const res = await getApi<MeResponse>("/api/auth/me");
    if (res.ok) {
      setState({ status: "ready", session: res.session, appEnv: res.appEnv, error: null, expired: false });
    } else if (res.code === "UNAUTHORIZED" || res.code === "SESSION_EXPIRED") {
      setState({ status: "ready", session: null, appEnv: state.appEnv, error: null, expired: res.code === "SESSION_EXPIRED" });
    } else {
      setState({ ...state, status: state.status === "ready" ? "ready" : "error", error: res.message });
    }
    loadedOnce = true;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function installExpiryListener(): void {
  if (expiryListenerInstalled || typeof window === "undefined") return;
  expiryListenerInstalled = true;
  window.addEventListener(SESSION_EXPIRED_EVENT, (ev) => {
    const code = (ev as CustomEvent<{ code?: string }>).detail?.code;
    setState({ ...state, status: "ready", session: null, expired: code === "SESSION_EXPIRED" });
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): SessionState {
  return state;
}

/** 登出：POST /api/auth/logout 後回到 /login（即使網路失敗也清掉本機狀態並導向） */
export async function logout(redirectTo = "/login"): Promise<void> {
  await postApi<LogoutResponse>("/api/auth/logout", {}, { retry: false });
  setState({ status: "ready", session: null, appEnv: state.appEnv, error: null, expired: false });
  if (typeof window !== "undefined") window.location.replace(redirectTo);
}

/**
 * 目前登入的 session（GET /api/auth/me）。整個分頁共用一份。
 * 未登入：status = 'ready' 且 session = null。
 */
export function useSession(): SessionState & { refresh: () => Promise<void>; logout: () => Promise<void> } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    installExpiryListener();
    if (!loadedOnce) void refreshSession();
  }, []);

  const doLogout = useCallback(() => logout(), []);
  return { ...s, refresh: refreshSession, logout: doLogout };
}
