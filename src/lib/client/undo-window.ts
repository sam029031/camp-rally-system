/**
 * 現場撤銷倒數（第二十二節）：按下後 60 秒內顯示 [ 撤銷（剩 45 秒）]。
 * 一律用真實時間（real_created_at 與校正後真實時間），不受 Demo 倍速影響；refresh 後仍正確。
 */

import { SELF_UNDO_WINDOW_MS } from "@/lib/constants";

/** 剩餘可撤銷毫秒數（>= 0） */
export function undoRemainingMs(realCreatedAt: number, realNowMs: number, windowMs: number = SELF_UNDO_WINDOW_MS): number {
  return Math.max(0, realCreatedAt + windowMs - realNowMs);
}

/** 按鈕上顯示的剩餘秒數（無條件進位；0 代表已過期） */
export function undoRemainingSeconds(realCreatedAt: number, realNowMs: number, windowMs: number = SELF_UNDO_WINDOW_MS): number {
  return Math.ceil(undoRemainingMs(realCreatedAt, realNowMs, windowMs) / 1000);
}

/** 「撤銷（剩 45 秒）」 */
export function undoButtonLabel(seconds: number): string {
  return `撤銷（剩 ${seconds} 秒）`;
}

/** ISO 字串或 ms 轉成 ms（無法解析回傳 NaN） */
export function toEpochMs(t: number | string): number {
  return typeof t === "number" ? t : Date.parse(t);
}
