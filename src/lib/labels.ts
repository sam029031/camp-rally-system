/**
 * 狀態中文、顏色 class、隊名、動作名稱（第十、十一、十四節）。
 *
 * 顏色（第十四節）：
 * - 關卡：灰 WAITING / CHECKED_OUT / REST / CANCELLED、紫 READY、綠 IN_PROGRESS、黃 ENDING_SOON、紅 OVERTIME
 * - 小隊：藍 TRANSITIONING（剩餘 <= 2:00 轉黃）、紅 TRANSITION_OVERDUE、紫 ARRIVED（隊輔回報用紫色虛線框）、
 *         灰 WAITING / COMPLETED、AT_STATION 跟隨關卡顏色
 * - 「未到」（no_show）灰底紅字；次要標籤橘色；FIXED_END「時間不足」黃色
 * 一律同時保留文字，不能只靠顏色判讀。
 *
 * Tailwind v4 以原始碼掃描 class，所以這裡的 class 一律寫成完整字串，不要動態組字。
 */

import type { CheckAction, CheckRecord, NotificationKind, RecordSource, Role, Team } from "@/lib/types";
import type {
  ArrivedDetail,
  SecondaryTagKind,
  StationSlotState,
  TeamDerived,
  TeamState,
} from "@/lib/derive/types";
import { formatCountdown, formatHms, formatHm } from "@/lib/time";

// =====================================================================
// 文字
// =====================================================================

/** 關卡時段狀態（第十四節文字） */
export const STATION_STATE_LABEL: Record<StationSlotState, string> = {
  REST: "本時段休息",
  CANCELLED: "已取消",
  WAITING: "尚未開始",
  READY: "已到，等待開始",
  IN_PROGRESS: "進行中",
  ENDING_SOON: "即將結束",
  OVERTIME: "超時",
  CHECKED_OUT: "已出關",
};

/** CHECKED_OUT 且 no_show → 「未到」 */
export const NO_SHOW_LABEL = "未到";

/** 小隊狀態（ARRIVED 的細分見 ARRIVED_DETAIL_LABEL） */
export const TEAM_STATE_LABEL: Record<TeamState, string> = {
  WAITING: "等待中",
  TRANSITIONING: "跑關中",
  TRANSITION_OVERDUE: "跑關逾期",
  ARRIVED: "已到",
  AT_STATION: "關卡中",
  COMPLETED: "已完成",
};

export const ARRIVED_DETAIL_LABEL: Record<ArrivedDetail, string> = {
  TEAM_REPORTED: "已到（隊輔回報）",
  WAITING_START: "已到，等待開始",
  WAITING_OPPONENT: "已到，等待對手",
  QUEUED: "已到，排隊中",
};

/** 未到第一關（TRANSITION_OVERDUE 且沒有上一關） */
export const OVERDUE_FIRST_STATION_LABEL = "未到第一關";

/** 次要標籤文字（第十節 C） */
export const SECONDARY_TAG_LABEL: Record<SecondaryTagKind, string> = {
  TEAM_NOT_CHECKED_IN: "隊輔未確認進關",
  TEAM_NOT_CHECKED_OUT: "隊輔未確認出關",
  TEAM_OUT_STATION_NOT_OUT: "隊輔已出關，關主未出關",
  CHECKOUT_TIME_DIFF: "紀錄不一致",
  TEAM_CHECK_IN_MISSING: "隊輔漏按進關",
  PREV_NOT_CHECKED_OUT: "未出關（隊伍已到下一關）",
};

/** X 完全沒有關主進關、隊伍卻已在下一關時的 PREV_NOT_CHECKED_OUT 文字 */
export const PREV_NOT_CHECKED_IN_LABEL = "未到（隊伍已在下一關），待按本隊未到";

/** 通知種類標題（通知中心／Toast 標題） */
export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  STATION_OVERTIME: "關卡超時",
  TRANSITION_OVERDUE: "跑關逾期",
  STATION_NOT_STARTED: "關主未開始",
  PREV_NOT_CHECKED_OUT: "漏按出關",
  STATION_SHORTENED: "可玩時間不足",
  SCHEDULE_ADJUSTED: "排程調整",
  SELF_UNDO: "現場撤銷",
  RECORD_MISMATCH: "紀錄異常",
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "總召",
  STATION: "關主",
  TEAM: "隊輔",
  VIEWER: "唯讀",
};

export const SOURCE_LABEL: Record<RecordSource, string> = {
  ui: "現場",
  admin_correction: "管理員修正",
  admin_force: "強制結束",
};

/** 按鈕／紀錄上的動作名稱：確認進關／確認出關 */
export function actionLabel(action: CheckAction): string {
  switch (action) {
    case "station_check_in":
    case "team_check_in":
      return "確認進關";
    case "station_check_out":
    case "team_check_out":
      return "確認出關";
  }
}

/** 帶身分的動作名稱：「關主確認進關」「隊輔確認出關」 */
export function actionLabelWithSide(action: CheckAction): string {
  const side = action === "station_check_in" || action === "station_check_out" ? "關主" : "隊輔";
  return `${side}${actionLabel(action)}`;
}

/** 一筆紀錄的動作文字（本隊未到、強制結束、大地開始 另外標示） */
export function recordActionLabel(
  r: Pick<CheckRecord, "action" | "noShow" | "source">,
  opts?: { pk?: boolean },
): string {
  if (r.action === "station_check_out" && r.noShow) return opts?.pk ? "本場未進行" : "本隊未到";
  if (r.action === "station_check_out" && r.source === "admin_force") return "強制結束";
  if (r.action === "station_check_in" && opts?.pk) return "雙方到齊，開始";
  return actionLabel(r.action);
}

/** 「第N時段」 */
export function slotLabel(slotNumber: number): string {
  return `第${slotNumber}時段`;
}

/**
 * 隊名（第三節 C）：「第N小隊」；PK 版面空間不夠時 short →「第N隊」；幹部隊一律「幹部隊」。
 */
export function teamName(team: Pick<Team, "code" | "name" | "isStaffTeam">, opts?: { short?: boolean }): string {
  if (team.isStaffTeam) return "幹部隊";
  const code = team.code.trim();
  if (/^\d+$/.test(code)) return opts?.short ? `第${code}隊` : `第${code}小隊`;
  return team.name;
}

/** 關卡時段狀態文字（no_show 的 CHECKED_OUT 顯示「未到」） */
export function stationStateLabel(state: StationSlotState, noShow = false): string {
  if (state === "CHECKED_OUT" && noShow) return NO_SHOW_LABEL;
  return STATION_STATE_LABEL[state];
}

/** 小隊狀態文字（含 ARRIVED 細分與「未到第一關」） */
export function teamStateLabel(td: Pick<TeamDerived, "state" | "arrivedDetail" | "overdueFirstStation">): string {
  if (td.state === "ARRIVED" && td.arrivedDetail) return ARRIVED_DETAIL_LABEL[td.arrivedDetail];
  if (td.state === "TRANSITION_OVERDUE" && td.overdueFirstStation) return OVERDUE_FIRST_STATION_LABEL;
  return TEAM_STATE_LABEL[td.state];
}

/**
 * 小隊的一行狀態（Dashboard 格子小字、大地對手狀態）：
 * 「前往中 剩 03:12」「逾期 +01:10」「未到第一關 +00:40」「已到 14:24:05（隊輔回報）」「已到 14:24:05，等待對手」…
 */
export function teamStatusText(
  td: Pick<
    TeamDerived,
    "state" | "arrivedDetail" | "overdueFirstStation" | "transitionRemainingMs" | "deadline" | "arrivedAt"
  >,
): string {
  switch (td.state) {
    case "WAITING":
      return td.deadline !== null ? `等待中（${formatHm(td.deadline)} 前到第一關）` : TEAM_STATE_LABEL.WAITING;
    case "TRANSITIONING":
      return td.transitionRemainingMs !== null ? `前往中 剩 ${formatCountdown(td.transitionRemainingMs)}` : "前往中";
    case "TRANSITION_OVERDUE": {
      const over = td.transitionRemainingMs !== null ? ` +${formatCountdown(td.transitionRemainingMs)}` : "";
      return td.overdueFirstStation ? `${OVERDUE_FIRST_STATION_LABEL}${over}` : `逾期${over}`;
    }
    case "ARRIVED": {
      const at = td.arrivedAt !== null ? ` ${formatHms(td.arrivedAt)}` : "";
      switch (td.arrivedDetail) {
        case "TEAM_REPORTED":
          return `已到${at}（隊輔回報）`;
        case "WAITING_OPPONENT":
          return `已到${at}，等待對手`;
        case "QUEUED":
          return "已到，排隊中（前一隊尚未出關）";
        case "WAITING_START":
          return "已到，等待開始";
        default:
          return `已到${at}`;
      }
    }
    case "AT_STATION":
      return TEAM_STATE_LABEL.AT_STATION;
    case "COMPLETED":
      return TEAM_STATE_LABEL.COMPLETED;
  }
}

// =====================================================================
// 顏色 class（第十四節）
// =====================================================================

export interface StateClassSet {
  /** 關卡列／卡片（底色＋邊框＋字色） */
  card: string;
  /** 狀態徽章 */
  badge: string;
  /** 大字（Timer、剩餘時間）字色 */
  text: string;
  /** 小圓點 */
  dot: string;
}

const GRAY: StateClassSet = {
  card: "bg-slate-50 border-slate-300 text-slate-800",
  badge: "bg-slate-200 text-slate-800 border border-slate-300",
  text: "text-slate-700",
  dot: "bg-slate-400",
};
const PURPLE: StateClassSet = {
  card: "bg-purple-50 border-purple-500 text-purple-950",
  badge: "bg-purple-600 text-white border border-purple-700",
  text: "text-purple-700",
  dot: "bg-purple-600",
};
const GREEN: StateClassSet = {
  card: "bg-green-50 border-green-600 text-green-950",
  badge: "bg-green-600 text-white border border-green-700",
  text: "text-green-700",
  dot: "bg-green-600",
};
const YELLOW: StateClassSet = {
  card: "bg-yellow-50 border-yellow-500 text-yellow-950",
  badge: "bg-yellow-400 text-yellow-950 border border-yellow-500",
  text: "text-yellow-600",
  dot: "bg-yellow-400",
};
const RED: StateClassSet = {
  card: "bg-red-50 border-red-600 text-red-950",
  badge: "bg-red-600 text-white border border-red-700",
  text: "text-red-600",
  dot: "bg-red-600",
};
const BLUE: StateClassSet = {
  card: "bg-blue-50 border-blue-600 text-blue-950",
  badge: "bg-blue-600 text-white border border-blue-700",
  text: "text-blue-700",
  dot: "bg-blue-600",
};
/** 「已到（隊輔回報）」：紫色虛線框 */
const PURPLE_DASHED: StateClassSet = {
  card: "bg-purple-50 border-2 border-dashed border-purple-500 text-purple-950",
  badge: "bg-purple-50 text-purple-800 border-2 border-dashed border-purple-500",
  text: "text-purple-700",
  dot: "bg-purple-400",
};
/** 「未到」（no_show）：灰底紅字 */
export const NO_SHOW_CLASS: StateClassSet = {
  card: "bg-slate-100 border-slate-300 text-red-700",
  badge: "bg-slate-200 text-red-700 border border-slate-300 font-bold",
  text: "text-red-700",
  dot: "bg-red-600",
};

export const STATION_STATE_CLASS: Record<StationSlotState, StateClassSet> = {
  REST: GRAY,
  CANCELLED: GRAY,
  WAITING: GRAY,
  CHECKED_OUT: GRAY,
  READY: PURPLE,
  IN_PROGRESS: GREEN,
  ENDING_SOON: YELLOW,
  OVERTIME: RED,
};

/** 關卡狀態的顏色（no_show → 灰底紅字） */
export function stationStateClasses(state: StationSlotState, noShow = false): StateClassSet {
  if (state === "CHECKED_OUT" && noShow) return NO_SHOW_CLASS;
  return STATION_STATE_CLASS[state];
}

/**
 * 小隊狀態的顏色。AT_STATION 跟隨該關卡的狀態顏色（傳入 stationState）；
 * TRANSITIONING 剩餘 <= 2:00 轉黃（transitionWarning）。
 */
export function teamStateClasses(
  td: Pick<TeamDerived, "state" | "arrivedDetail" | "transitionWarning">,
  stationState?: StationSlotState | null,
): StateClassSet {
  switch (td.state) {
    case "TRANSITIONING":
      return td.transitionWarning ? YELLOW : BLUE;
    case "TRANSITION_OVERDUE":
      return RED;
    case "ARRIVED":
      return td.arrivedDetail === "TEAM_REPORTED" ? PURPLE_DASHED : PURPLE;
    case "AT_STATION":
      return stationState ? STATION_STATE_CLASS[stationState] : GREEN;
    case "WAITING":
    case "COMPLETED":
      return GRAY;
  }
}

/** 次要標籤：橘色角標／邊框，不蓋掉主色 */
export const SECONDARY_TAG_CLASS = "bg-orange-100 text-orange-900 border border-orange-500";
/** 卡片上有次要標籤時加的外框 */
export const SECONDARY_TAG_RING_CLASS = "ring-2 ring-orange-400";
/** FIXED_END「時間不足」黃色標籤 */
export const INSUFFICIENT_TIME_CLASS = "bg-yellow-300 text-yellow-950 border border-yellow-500";
/** 已取消：灰色（不是故障） */
export const CANCELLED_CLASS = "bg-slate-100 text-slate-600 border border-slate-300";
