/**
 * 連線／資料新鮮度的純函式（第二十八節），給 use-live-game 與測試使用。
 */

import { STALE_AFTER_MS } from "@/lib/constants";

export type ChannelStatus = "connecting" | "subscribed" | "error" | "closed";

export interface LiveStatus {
  /** navigator.onLine */
  online: boolean;
  /** Realtime channel 狀態 */
  channel: ChannelStatus;
  /** 最近一次成功抓取快照的時間（校正後真實時間，ms） */
  lastFetchOkAt: number | null;
  /** 超過 60 秒沒有成功抓取（或離線）→ 顯示「資料可能過期」 */
  stale: boolean;
  /** 最近一次抓取或推導的錯誤訊息（成功後清除） */
  error: string | null;
}

/**
 * 是否顯示「資料可能過期」：
 * - 有成功抓取過：距離上次成功 > 60 秒（真實時間）
 * - 從沒成功過：距離開始載入 > 60 秒
 */
export function isDataStale(lastFetchOkAt: number | null, realNowMs: number, startedAt: number): boolean {
  const base = lastFetchOkAt ?? startedAt;
  return realNowMs - base > STALE_AFTER_MS;
}

/** 連線指示器的顯示分類 */
export type ConnectionLevel = "offline" | "stale" | "live" | "polling" | "connecting";

/**
 * 頂端連線指示：
 * - offline：navigator.onLine = false
 * - stale：超過 60 秒沒有成功抓取
 * - live：Realtime 已訂閱
 * - polling：Realtime 出錯或關閉，但輪詢仍成功（資料仍在 60 秒內）
 * - connecting：Realtime 連線中
 */
export function connectionLevel(s: Pick<LiveStatus, "online" | "channel" | "stale">): ConnectionLevel {
  if (!s.online) return "offline";
  if (s.stale) return "stale";
  if (s.channel === "subscribed") return "live";
  if (s.channel === "error" || s.channel === "closed") return "polling";
  return "connecting";
}

export const CONNECTION_LEVEL_LABEL: Record<ConnectionLevel, string> = {
  offline: "離線",
  stale: "資料可能過期",
  live: "即時連線",
  polling: "定時更新中",
  connecting: "連線中",
};
