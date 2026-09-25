/**
 * Excel 匯入設定：檔案位置、正式工作表、固定版面、關卡顯示名稱修正、隊伍（第三節）。
 */
import type { GameCode } from "@/lib/types";
import { STAFF_TEAM_CODE, STAFF_TEAM_NAME } from "@/lib/constants";
import type { NormalizedTeam } from "./types";

/** 預設 Excel 位置（相對於專案根目錄；CLI 可用 --gold / --land 覆寫） */
export const DEFAULT_EXCEL_PATHS: Record<GameCode, string> = {
  gold: "data/黃金新路線 的副本 的副本.xlsx",
  land: "data/大地新跑關 的副本 的副本.xlsx",
};

/**
 * 正式工作表（第三節）。每份檔案另一張是舊版排程（「每個小隊跑的路線」「各隊跑關情況」），
 * 一律不讀取、不 cross-check、不拿來做 validation。
 */
export const OFFICIAL_SHEET_NAMES: Record<GameCode, string> = {
  gold: "黃金新路線",
  land: "大地新跑關",
};

/** 固定版面（0-based index；第 1 列 = index 0） */
export const LAYOUT = {
  /** 第 1 列：關卡名稱 */
  nameRow: 0,
  /** 第 2~9 列：第 1~8 時段 */
  firstSlotRow: 1,
  slotCount: 8,
  /** 第 12 列：關卡代號 */
  codeRow: 11,
  /** A 欄：時段時間字串 */
  timeCol: 0,
  /** B 欄起：關卡 */
  firstStationCol: 1,
} as const;

/** 各遊戲的關卡代號（依欄位順序）：黃金 A~M（B..N）、大地 A~J（B..K） */
export const EXPECTED_STATION_CODES: Record<GameCode, readonly string[]> = {
  gold: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"],
  land: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
};

/**
 * 關卡顯示名稱修正（第三節）：只有這裡列出的關卡顯示名稱與 Excel 原文不同，
 * 原文另存在 stations.source_name。其他關名一律照 Excel 原文（「(水)」標記保留）。
 */
export const STATION_DISPLAY_NAME_OVERRIDES: ReadonlyArray<{
  game: GameCode;
  code: string;
  sourceName: string;
  displayName: string;
  reason: string;
}> = [
  {
    game: "gold",
    code: "L",
    sourceName: "幾隻小鳥幾隻腳(是大地變黃金)",
    displayName: "幾隻小鳥幾隻腳",
    reason: "「(是大地變黃金)」是排程備註，不是關名",
  },
];

/** 小隊數（第 1~13 小隊） */
export const TEAM_COUNT = 13;

/** 大地每個時段的 PK 組數（13 小隊 + 幹部隊 = 14 隊 / 2） */
export const LAND_PAIRS_PER_SLOT = 7;

/** 時段字串格式（第四節） */
export const SLOT_TIME_PATTERN = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/;
/** 大地 PK 格格式（第四節） */
export const LAND_CELL_PATTERN = /^(\d{1,2})\/(\d{1,2}|幹)$/;
/** 黃金格：整數小隊編號 */
export const GOLD_CELL_PATTERN = /^\d{1,2}$/;
/** Excel 裡代表幹部隊的字 */
export const STAFF_TEAM_EXCEL_TOKEN = "幹";

/** 第 1~13 小隊（code '1'..'13'，sort 1..13）＋幹部隊（code 'S'，sort 14） */
export const ALL_TEAMS: readonly NormalizedTeam[] = [
  ...Array.from({ length: TEAM_COUNT }, (_, i) => ({
    code: String(i + 1),
    name: `第${i + 1}小隊`,
    isStaffTeam: false,
    sortOrder: i + 1,
  })),
  { code: STAFF_TEAM_CODE, name: STAFF_TEAM_NAME, isStaffTeam: true, sortOrder: TEAM_COUNT + 1 },
];

/** 錯誤訊息用的隊名（第N小隊／幹部隊） */
export function teamLabel(code: string): string {
  if (code === STAFF_TEAM_CODE) return STAFF_TEAM_NAME;
  return `第${code}小隊`;
}
