/**
 * 狀態顏色（第十四節）。文字一律來自 src/lib/labels.ts，這裡只負責顏色 class；
 * 不能只靠顏色判讀，所有元件都同時顯示文字。
 *
 * 關卡時段狀態：灰 WAITING / CHECKED_OUT / REST / CANCELLED、紫 READY、綠 IN_PROGRESS、黃 ENDING_SOON、紅 OVERTIME。
 * 小隊狀態：藍 TRANSITIONING（剩餘 <= 2:00 轉黃）、紅 TRANSITION_OVERDUE、紫 ARRIVED（隊輔回報用虛線框）、
 *           灰 WAITING / COMPLETED、AT_STATION 跟隨關卡顏色。
 * 「未到」（no_show）：灰底紅字。次要標籤：橘色。
 */

import type { StationSlotState, TeamState } from "@/lib/derive/types";

export type Tone = "gray" | "purple" | "green" | "yellow" | "red" | "blue" | "orange" | "noshow";

export interface ToneClasses {
  /** 淺底 + 深字 + 邊框（卡片、徽章） */
  soft: string;
  /** 實心底（大 Timer 背景、強調） */
  solid: string;
  /** 只有邊框顏色（卡片左邊條） */
  border: string;
  /** 只有文字顏色 */
  text: string;
}

export const TONE_CLASSES: Record<Tone, ToneClasses> = {
  gray: {
    soft: "bg-slate-100 text-slate-800 border-slate-400",
    solid: "bg-slate-600 text-white",
    border: "border-slate-400",
    text: "text-slate-700",
  },
  purple: {
    soft: "bg-violet-100 text-violet-950 border-violet-600",
    solid: "bg-violet-700 text-white",
    border: "border-violet-600",
    text: "text-violet-800",
  },
  green: {
    soft: "bg-emerald-100 text-emerald-950 border-emerald-600",
    solid: "bg-emerald-600 text-white",
    border: "border-emerald-600",
    text: "text-emerald-800",
  },
  yellow: {
    soft: "bg-yellow-100 text-yellow-950 border-yellow-500",
    solid: "bg-yellow-400 text-black",
    border: "border-yellow-500",
    text: "text-yellow-800",
  },
  red: {
    soft: "bg-red-100 text-red-950 border-red-600",
    solid: "bg-red-600 text-white",
    border: "border-red-600",
    text: "text-red-700",
  },
  blue: {
    soft: "bg-blue-100 text-blue-950 border-blue-600",
    solid: "bg-blue-700 text-white",
    border: "border-blue-600",
    text: "text-blue-800",
  },
  orange: {
    soft: "bg-orange-100 text-orange-950 border-orange-500",
    solid: "bg-orange-500 text-white",
    border: "border-orange-500",
    text: "text-orange-800",
  },
  noshow: {
    soft: "bg-slate-100 text-red-700 border-red-400",
    solid: "bg-slate-200 text-red-700",
    border: "border-red-400",
    text: "text-red-700",
  },
};

/** 關卡時段狀態 → 顏色 */
export function stationStateTone(state: StationSlotState, noShow = false): Tone {
  if (state === "CHECKED_OUT" && noShow) return "noshow";
  switch (state) {
    case "READY":
      return "purple";
    case "IN_PROGRESS":
      return "green";
    case "ENDING_SOON":
      return "yellow";
    case "OVERTIME":
      return "red";
    default:
      return "gray";
  }
}

/**
 * 小隊狀態 → 顏色
 * @param stationState AT_STATION 時跟隨的關卡狀態
 * @param transitionWarning 跑關剩餘 <= 2:00（藍轉黃）
 */
export function teamStateTone(
  state: TeamState,
  opts: { stationState?: StationSlotState | null; transitionWarning?: boolean } = {},
): Tone {
  switch (state) {
    case "TRANSITIONING":
      return opts.transitionWarning ? "yellow" : "blue";
    case "TRANSITION_OVERDUE":
      return "red";
    case "ARRIVED":
      return "purple";
    case "AT_STATION":
      return opts.stationState ? stationStateTone(opts.stationState) : "green";
    default:
      return "gray";
  }
}
