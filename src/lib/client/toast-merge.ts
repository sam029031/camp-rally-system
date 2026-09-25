/**
 * 多筆 A 類通知合併成一則 Toast（第十五節：「同時多筆時合併成一則（例如「3 關超時」），不要疊一整排」）。
 * 純函式，給 use-notification-watcher 與測試使用。
 */

import type { NotificationKind } from "@/lib/types";

export type ToastTone = "danger" | "warning" | "info" | "success";
export type AlertSound = "overtime" | "notification";

export interface ToastSource {
  id: string;
  kind: NotificationKind;
  subkind: string | null;
  message: string;
}

export interface MergedToast {
  /** 大標題：單筆為種類名稱（「關卡超時」）；多筆為「3 關超時、1 隊跑關逾期」 */
  title: string;
  /** 單筆時的通知內容；多筆時為 null（改看 lines） */
  body: string | null;
  /** 多筆時逐條列出（最多 MAX_TOAST_LINES 條，超過以「…另有 N 則」結尾） */
  lines: string[];
  tone: ToastTone;
  sound: AlertSound;
  /** 合併了哪些通知（依顯示順序） */
  ids: string[];
}

export const MAX_TOAST_LINES = 4;

type GroupKey = NotificationKind | "RECORD_MISMATCH:TEAM_OUT_STATION_NOT_OUT";

interface GroupSpec {
  title: string;
  count: (n: number) => string;
  tone: ToastTone;
  priority: number;
}

const GROUPS: Record<GroupKey, GroupSpec> = {
  STATION_OVERTIME: { title: "關卡超時", count: (n) => `${n} 關超時`, tone: "danger", priority: 1 },
  TRANSITION_OVERDUE: { title: "跑關逾期", count: (n) => `${n} 隊跑關逾期`, tone: "danger", priority: 2 },
  PREV_NOT_CHECKED_OUT: { title: "漏按出關", count: (n) => `${n} 關漏按出關`, tone: "danger", priority: 3 },
  "RECORD_MISMATCH:TEAM_OUT_STATION_NOT_OUT": {
    title: "隊輔已出關，關主未出關",
    count: (n) => `${n} 隊隊輔已出關、關主未出關`,
    tone: "danger",
    priority: 4,
  },
  STATION_NOT_STARTED: { title: "關主未開始", count: (n) => `${n} 關關主未開始`, tone: "warning", priority: 5 },
  STATION_SHORTENED: { title: "可玩時間不足", count: (n) => `${n} 場可玩時間不足`, tone: "warning", priority: 6 },
  SCHEDULE_ADJUSTED: { title: "排程調整", count: (n) => `${n} 則排程調整`, tone: "info", priority: 7 },
  RECORD_MISMATCH: { title: "紀錄不一致", count: (n) => `${n} 則紀錄不一致`, tone: "warning", priority: 8 },
  SELF_UNDO: { title: "現場撤銷", count: (n) => `${n} 則現場撤銷`, tone: "info", priority: 9 },
};

const TONE_RANK: Record<ToastTone, number> = { danger: 3, warning: 2, info: 1, success: 0 };

function groupKeyOf(s: ToastSource): GroupKey {
  if (s.kind === "RECORD_MISMATCH" && s.subkind === "TEAM_OUT_STATION_NOT_OUT") return "RECORD_MISMATCH:TEAM_OUT_STATION_NOT_OUT";
  return s.kind;
}

/** 通知種類的中文名稱（通知中心標題用） */
export function notificationKindTitle(kind: NotificationKind, subkind: string | null): string {
  return GROUPS[groupKeyOf({ id: "", kind, subkind, message: "" })].title;
}

/** 將同一批新出現的 A 類通知合併；沒有通知回傳 null */
export function mergeToast(items: readonly ToastSource[]): MergedToast | null {
  if (items.length === 0) return null;

  const groups = new Map<GroupKey, ToastSource[]>();
  for (const it of items) {
    const k = groupKeyOf(it);
    const arr = groups.get(k);
    if (arr) arr.push(it);
    else groups.set(k, [it]);
  }
  const ordered = [...groups.entries()].sort((a, b) => GROUPS[a[0]].priority - GROUPS[b[0]].priority);
  const sortedItems = ordered.flatMap(([, arr]) => arr);

  let tone: ToastTone = "info";
  for (const [k] of ordered) if (TONE_RANK[GROUPS[k].tone] > TONE_RANK[tone]) tone = GROUPS[k].tone;
  const sound: AlertSound = groups.has("STATION_OVERTIME") || groups.has("TRANSITION_OVERDUE") ? "overtime" : "notification";
  const ids = sortedItems.map((s) => s.id);

  if (items.length === 1) {
    const only = items[0];
    return { title: GROUPS[groupKeyOf(only)].title, body: only.message, lines: [], tone, sound, ids };
  }

  const title = ordered.map(([k, arr]) => GROUPS[k].count(arr.length)).join("、");
  const lines = sortedItems.slice(0, MAX_TOAST_LINES).map((s) => s.message);
  if (sortedItems.length > MAX_TOAST_LINES) lines.push(`…另有 ${sortedItems.length - MAX_TOAST_LINES} 則，請看通知中心`);
  return { title, body: null, lines, tone, sound, ids };
}

/** 系統通知（Browser Notification）用的內容 */
export function mergedToastText(t: MergedToast): string {
  return t.body ?? t.lines.join("\n");
}
