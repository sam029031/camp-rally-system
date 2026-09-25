/**
 * 前端統一時鐘（第三十一節）。整個分頁共用一份（module 單例）。
 *
 * - 校時：呼叫 get_clock RPC，offset = server_now − Date.now()（用 RTT/2 修正，見 computeServerOffset）。
 * - realNow = Date.now() + offset（校正後真實時間：撤銷 60 秒、資料過期 60 秒用它）。
 * - appNow = computeAppNow(realNow, 時鐘設定)（排程、倒數、狀態推導一律用它）。
 * - 每 60 秒、回到前景、重新上線時重新校時。
 * - 時鐘設定（Demo 開關／倍速／anchor）也會跟著快照（events 表 Realtime）更新。
 *
 * 不依賴 React；hook 包裝在 use-clock.ts。
 */

import { clockSettingsFromRpc, computeAppNow, computeServerOffset } from "@/lib/clock";
import { CLOCK_RESYNC_MS } from "@/lib/constants";
import type { ClockRpcResult, ClockSettings } from "@/lib/types";
import { getBrowserSupabase } from "@/lib/client/supabase";

export interface ClockState {
  /** server_now − Date.now()（毫秒） */
  offsetMs: number;
  settings: ClockSettings;
  /** 最近一次成功校時（Date.now()）；null = 尚未校時（暫用手機時間） */
  calibratedAt: number | null;
  /** 最近一次校時的來回時間 */
  lastRttMs: number | null;
  /** 校時對象活動 id（null = active event） */
  eventId: string | null;
  /** 最近一次校時失敗的訊息 */
  error: string | null;
}

export const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  simEnabled: false,
  simSpeed: 1,
  simAnchorReal: null,
  simAnchorVirtual: null,
};

/** RTT 超過這個值的樣本不太可靠：已有較好的樣本時只更新設定、不更新 offset */
const MAX_TRUSTED_RTT_MS = 4_000;
/** 可靠樣本的有效期（超過就算 RTT 大也接受新樣本） */
const TRUSTED_SAMPLE_TTL_MS = 10 * 60_000;

let state: ClockState = {
  offsetMs: 0,
  settings: DEFAULT_CLOCK_SETTINGS,
  calibratedAt: null,
  lastRttMs: null,
  eventId: null,
  error: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(patch: Partial<ClockState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getClockState(): ClockState {
  return state;
}

export function subscribeClockState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 校正後的真實時間（epoch ms） */
export function realNow(): number {
  return Date.now() + state.offsetMs;
}

/** app 時間（epoch ms）：排程、倒數、狀態推導用 */
export function appNow(): number {
  return computeAppNow(realNow(), state.settings);
}

export function sameClockSettings(a: ClockSettings, b: ClockSettings): boolean {
  return (
    a.simEnabled === b.simEnabled &&
    a.simSpeed === b.simSpeed &&
    a.simAnchorReal === b.simAnchorReal &&
    a.simAnchorVirtual === b.simAnchorVirtual
  );
}

/** 快照（events 表）帶來的時鐘設定：與目前不同就採用（Demo 設定走 Realtime，所有裝置立即跟上） */
export function applyClockSettings(settings: ClockSettings): void {
  if (!sameClockSettings(settings, state.settings)) setState({ settings });
}

/** 指定校時的活動（null = active event）；改變時立即重新校時 */
export function setClockEvent(eventId: string | null): void {
  if (eventId !== state.eventId) {
    setState({ eventId });
    void calibrateClock();
  }
}

let inFlight: Promise<void> | null = null;

/** 呼叫 get_clock 校時。同時只會有一個請求在跑。 */
export function calibrateClock(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const supabase = getBrowserSupabase();
      const start = Date.now();
      const { data, error } = await supabase.rpc("get_clock", { p_event_id: state.eventId });
      const end = Date.now();
      if (error) throw new Error(error.message);
      const r = data as ClockRpcResult | null;
      if (!r || typeof r.server_now !== "string") throw new Error("get_clock 回傳格式不正確");

      const rtt = end - start;
      const settings = clockSettingsFromRpc(r);
      const hasTrustedSample =
        state.calibratedAt !== null &&
        state.lastRttMs !== null &&
        state.lastRttMs <= MAX_TRUSTED_RTT_MS &&
        end - state.calibratedAt < TRUSTED_SAMPLE_TTL_MS;

      if (rtt > MAX_TRUSTED_RTT_MS && hasTrustedSample) {
        // 網路很慢時的樣本誤差大：保留原本的 offset，只更新時鐘設定
        setState({ settings: sameClockSettings(settings, state.settings) ? state.settings : settings, error: null });
        return;
      }
      setState({
        offsetMs: computeServerOffset(r.server_now, start, end),
        settings: sameClockSettings(settings, state.settings) ? state.settings : settings,
        calibratedAt: end,
        lastRttMs: rtt,
        error: null,
      });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// ---------------------------------------------------------------------
// 自動重新校時（有人使用時鐘時才啟動；ref count）
// ---------------------------------------------------------------------

let users = 0;
let resyncTimer: ReturnType<typeof setInterval> | null = null;

function onVisibility(): void {
  if (document.visibilityState === "visible") void calibrateClock();
}
function onOnline(): void {
  void calibrateClock();
}

/** 開始自動校時；回傳釋放函式。多個元件同時使用只會有一組計時器。 */
export function retainClockSync(): () => void {
  users += 1;
  if (users === 1 && typeof window !== "undefined") {
    void calibrateClock();
    resyncTimer = setInterval(() => void calibrateClock(), CLOCK_RESYNC_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0 && typeof window !== "undefined") {
      if (resyncTimer) clearInterval(resyncTimer);
      resyncTimer = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    }
  };
}

// ---------------------------------------------------------------------
// 每秒 tick（畫面倒數用）
// ---------------------------------------------------------------------

export interface ClockTick {
  /** app 時間 */
  app: number;
  /** 校正後真實時間 */
  real: number;
}

const SERVER_TICK: ClockTick = { app: 0, real: 0 };
let tick: ClockTick = SERVER_TICK;
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setTimeout> | null = null;

function computeTick(): ClockTick {
  const real = realNow();
  let app = real;
  try {
    app = computeAppNow(real, state.settings);
  } catch {
    app = real;
  }
  return { app, real };
}

function scheduleTick(): void {
  // 正常速度：對齊真實時間的整秒；Demo 倍速：每 250ms 更新一次，倒數才不會一次跳很多秒
  const fast = state.settings.simEnabled && state.settings.simSpeed > 1;
  const r = realNow();
  const delay = fast ? 250 : 1_000 - (((r % 1_000) + 1_000) % 1_000) + 5;
  tickTimer = setTimeout(() => {
    tick = computeTick();
    for (const l of tickListeners) l();
    scheduleTick();
  }, delay);
}

function onClockStateChange(): void {
  // 校時或設定改變：立刻更新一次，不必等下一個 tick
  if (tickListeners.size === 0) return;
  tick = computeTick();
  for (const l of tickListeners) l();
}

let unsubscribeState: (() => void) | null = null;

export function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickListeners.size === 1) {
    tick = computeTick();
    unsubscribeState = subscribeClockState(onClockStateChange);
    scheduleTick();
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0) {
      if (tickTimer) clearTimeout(tickTimer);
      tickTimer = null;
      unsubscribeState?.();
      unsubscribeState = null;
    }
  };
}

export function getTick(): ClockTick {
  return tick;
}

export function getServerTick(): ClockTick {
  return SERVER_TICK;
}
