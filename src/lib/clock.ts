/**
 * 統一時鐘（第三十一節），純函式。
 *
 * app_now（SQL）：
 *   sim_enabled = false → now()
 *   sim_enabled = true  → sim_anchor_virtual + (now() − sim_anchor_real) × sim_speed
 *
 * 前端：get_clock() 校時 → offset = server_now − Date.now()（以 RTT/2 修正）
 *       → 每秒 realNow = Date.now() + offset → appNow = computeAppNow(realNow, settings)。
 * 跟排程有關的長度用 app 時間；跟操作有關的（撤銷 60 秒等）用 realNow，不乘倍速。
 */

import type { ClockRpcResult, ClockSettings, EventRow } from "@/lib/types";

/** 關閉 Demo 的時鐘設定（app 時間 = 真實時間） */
export const REAL_CLOCK: ClockSettings = {
  simEnabled: false,
  simSpeed: 1,
  simAnchorReal: null,
  simAnchorVirtual: null,
};

function parseIsoOrNull(v: string | null | undefined, field: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new Error(`時鐘設定 ${field} 不是合法的時間：${v}`);
  return ms;
}

function normalizeSpeed(speed: number | null | undefined): number {
  const n = typeof speed === "number" ? speed : Number(speed);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 由真實時間（已校正）算出 app 時間（與 SQL app_now_for_event 同一公式） */
export function computeAppNow(realNowMs: number, clock: ClockSettings): number {
  if (!clock.simEnabled || clock.simAnchorReal === null || clock.simAnchorVirtual === null) {
    return realNowMs;
  }
  return Math.round(clock.simAnchorVirtual + (realNowMs - clock.simAnchorReal) * normalizeSpeed(clock.simSpeed));
}

/** app 時間經過一段真實時間後會前進多少（倍速換算；Demo 關閉時 = 原值） */
export function appDurationForReal(realMs: number, clock: ClockSettings): number {
  return clock.simEnabled ? realMs * normalizeSpeed(clock.simSpeed) : realMs;
}

export function clockSettingsFromEventRow(row: EventRow): ClockSettings {
  return {
    simEnabled: Boolean(row.sim_enabled),
    simSpeed: normalizeSpeed(row.sim_speed),
    simAnchorReal: parseIsoOrNull(row.sim_anchor_real, "sim_anchor_real"),
    simAnchorVirtual: parseIsoOrNull(row.sim_anchor_virtual, "sim_anchor_virtual"),
  };
}

export function clockSettingsFromRpc(r: ClockRpcResult): ClockSettings {
  return {
    simEnabled: Boolean(r.sim_enabled),
    simSpeed: normalizeSpeed(r.sim_speed),
    simAnchorReal: parseIsoOrNull(r.sim_anchor_real, "sim_anchor_real"),
    simAnchorVirtual: parseIsoOrNull(r.sim_anchor_virtual, "sim_anchor_virtual"),
  };
}

/**
 * 校時：offset = server_now − 本機時間（取請求中點，即以 RTT/2 修正）。
 * 之後 realNow = Date.now() + offset。
 */
export function computeServerOffset(serverNowIso: string, requestStartReal: number, responseEndReal: number): number {
  const serverNow = Date.parse(serverNowIso);
  if (Number.isNaN(serverNow)) throw new Error(`server_now 不是合法的時間：${serverNowIso}`);
  const midpoint = requestStartReal + (responseEndReal - requestStartReal) / 2;
  return Math.round(serverNow - midpoint);
}

/**
 * 模擬 set_clock RPC 的重設 anchor（第三十一節）：
 * anchor_real = 改動當下的真實時間；anchor_virtual = 要跳到的時刻，或改動當下的 app 時間。
 * 因此改倍速或開關 Demo 時（不跳時間）app 時間是連續的。
 * 前端可用它在 RPC 回來前先顯示預覽；server 以 DB 為準。
 */
export function reanchorClock(
  prev: ClockSettings,
  realNowMs: number,
  next: { enabled: boolean; speed: number; jumpTo?: number | null },
): ClockSettings {
  const appNow = computeAppNow(realNowMs, prev);
  return {
    simEnabled: next.enabled,
    simSpeed: normalizeSpeed(next.speed),
    simAnchorReal: realNowMs,
    simAnchorVirtual: next.jumpTo ?? appNow,
  };
}

/** Demo 橫幅文字，例如「DEMO 模式 ×10」；未開啟回傳 null */
export function demoBannerText(clock: ClockSettings): string | null {
  if (!clock.simEnabled) return null;
  const speed = normalizeSpeed(clock.simSpeed);
  const speedText = Number.isInteger(speed) ? String(speed) : speed.toFixed(1);
  return `DEMO 模式 ×${speedText}`;
}
