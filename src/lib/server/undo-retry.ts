/**
 * 撤銷重送判斷（第二十二節「撤銷後的提醒（必做）」）。純函式，單元測試見 tests/unit/server-undo-retry.test.ts。
 *
 * 情境：撤銷成功了，但回應在手機網路上遺失 → 前端重送 → undo_check 回 ALREADY_VOIDED。
 * 若直接顯示錯誤，關主／隊輔就看不到必做的提醒視窗。因此：
 * 這筆紀錄是「本人」以 SELF_UNDO 撤銷、且撤銷發生在真實時間 90 秒內 → 視為同一次撤銷的重送，回成功。
 *
 * voided_at 寫的是 app 時間（app_now_for_event）；Demo 倍速時要換算回真實時間：
 * 真實經過 = (app_now − voided_at) / sim_speed；未開模擬時 app_now = server_now。
 */
import { SELF_UNDO_RETRY_WINDOW_MS } from "@/lib/constants";
import { parseDbTimestamp } from "@/lib/server/time-input";

/** get_clock 的回傳（只取這裡用得到的欄位） */
export interface UndoRetryClock {
  serverNow: number;
  appNow: number;
  simEnabled: boolean;
  simSpeed: number;
}

/** 已撤銷紀錄的撤銷欄位 */
export interface VoidedRecordFields {
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

/** get_clock 的回傳 → UndoRetryClock；格式不對回 null */
export function parseUndoRetryClock(data: unknown): UndoRetryClock | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const serverNow = parseDbTimestamp(r.server_now);
  const appNow = parseDbTimestamp(r.app_now);
  if (serverNow === null || appNow === null) return null;
  const speed = Number(r.sim_speed);
  return {
    serverNow,
    appNow,
    simEnabled: r.sim_enabled === true,
    simSpeed: Number.isFinite(speed) && speed > 0 ? speed : 1,
  };
}

/** 從撤銷到現在經過的真實毫秒數；voided_at 無法解析回 null */
export function realMsSinceVoid(voidedAt: string | null, clock: UndoRetryClock): number | null {
  const voidedMs = parseDbTimestamp(voidedAt);
  if (voidedMs === null) return null;
  return clock.simEnabled ? (clock.appNow - voidedMs) / clock.simSpeed : clock.serverNow - voidedMs;
}

/** 容許的時鐘誤差（撤銷用 now()，get_clock 用 clock_timestamp()，理論上不會是負的） */
const CLOCK_SKEW_TOLERANCE_MS = 1_000;

/** 這筆已撤銷紀錄是不是「本人剛剛自己撤銷的」（重送應回成功） */
export function isRecentOwnSelfUndo(record: VoidedRecordFields, identityId: string, clock: UndoRetryClock): boolean {
  if (record.voided_at === null || record.voided_by !== identityId || record.void_reason !== "SELF_UNDO") return false;
  const elapsed = realMsSinceVoid(record.voided_at, clock);
  if (elapsed === null) return false;
  return elapsed >= -CLOCK_SKEW_TOLERANCE_MS && elapsed <= SELF_UNDO_RETRY_WINDOW_MS;
}
