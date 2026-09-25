/**
 * 震動（第十五、十七節）：只有 Android 有 navigator.vibrate；iPhone 沒有震動，只有畫面與聲音。
 * 呼叫前先檢查函式存在，任何錯誤都靜默略過。
 */

export const VIBRATE_PATTERNS = {
  /** 剩 2:00 */
  warning: [200, 100, 200],
  /** 時間到／超時 */
  overtime: [400, 150, 400, 150, 400],
  /** 一般 A 類通知 */
  notification: [250, 120, 250],
} as const;

export type VibrateKind = keyof typeof VIBRATE_PATTERNS;

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** 震動；不支援或失敗時回傳 false */
export function vibrate(pattern: VibrateKind | number | readonly number[]): boolean {
  if (!canVibrate()) return false;
  try {
    const p = typeof pattern === "string" ? VIBRATE_PATTERNS[pattern] : pattern;
    return navigator.vibrate(typeof p === "number" ? p : [...p]);
  } catch {
    return false;
  }
}
