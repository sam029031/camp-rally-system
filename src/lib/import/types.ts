/**
 * Excel 匯入（第三、四、五、二十六節）用的型別。
 *
 * 流程：讀取 Excel → 套用 overrides → 解析 → validation → 正規化排程 → 匯入 DB。
 * 解析、overrides、validation 都是操作記憶體中 string[][] 的純函式，測試可以直接改格子。
 */
import type { GameCode } from "@/lib/types";

/**
 * 工作表內容：grid[列 index][欄 index]，index 從 0 開始且對齊 A1
 * （grid[0][0] = A1、grid[4][2] = C5）。每一格都已經 String(v).trim()。
 */
export type SheetGrid = string[][];

/** 一份正式工作表（只有正式那一張，舊版工作表永遠不讀） */
export interface OfficialSheet {
  game: GameCode;
  sheetName: string;
  grid: SheetGrid;
}

/** 一個錯誤：工作表名稱＋儲存格座標＋原因（第二十六節） */
export interface ImportIssue {
  /** 工作表名稱；與特定工作表無關（例如找不到檔案）時為 null */
  sheet: string | null;
  /** A1 座標（例如 'C5'、'B5:K5'）；整張工作表的問題為 null */
  cell: string | null;
  message: string;
}

/** 集中管理的人工修正（第五節） */
export interface ScheduleOverride {
  game: GameCode;
  /** 第幾時段（1..8） */
  slot: number;
  /** 關卡代號（依第 12 列找欄位） */
  station: string;
  /** 修正後的格子內容（與 Excel 格子同樣的文字格式，例如 '2/4'） */
  value: string;
  /** 為什麼要修正（印在 terminal） */
  reason: string;
}

/** override 套用結果 */
export interface OverrideOutcome {
  override: ScheduleOverride;
  sheet: string;
  /** 目標儲存格（A1）；找不到欄位時為 null */
  cell: string | null;
  /** applied：原格為空白、已套用；already：原格已是相同值，只提示；error：見 issues */
  status: "applied" | "already" | "error";
  /** 套用前的原始內容（顯示用，已 trim） */
  originalValue: string | null;
}

export interface OverrideResult {
  /** 套用後的新 grid（不修改傳入的 grid，更不會修改 Excel 檔） */
  grid: SheetGrid;
  outcomes: OverrideOutcome[];
  issues: ImportIssue[];
}

/** 正規化後的隊伍（teams 不綁遊戲） */
export interface NormalizedTeam {
  code: string; // '1'..'13', 'S'
  name: string; // 第N小隊 / 幹部隊
  isStaffTeam: boolean;
  sortOrder: number;
}

export interface NormalizedStation {
  code: string;
  /** 顯示名稱 */
  name: string;
  /** Excel 原文 */
  sourceName: string;
  sortOrder: number;
  /** Excel 欄位字母（例如 'B'），錯誤訊息與列印用 */
  column: string;
}

export interface NormalizedSlot {
  slotNumber: number;
  /** 'HH:MM' */
  start: string;
  end: string;
  /** Excel 列號（1-based），錯誤訊息與列印用 */
  row: number;
}

export interface NormalizedAssignment {
  slotNumber: number;
  stationCode: string;
  /** 隊伍 code；大地為格子左邊 */
  teamA: string;
  /** 黃金一律 null；大地為格子右邊 */
  teamB: string | null;
  /** 來源儲存格（A1） */
  cell: string;
}

export interface NormalizedGame {
  code: GameCode;
  name: string;
  sheetName: string;
  /** 依 sortOrder（= 欄位順序） */
  stations: NormalizedStation[];
  /** 依 slotNumber */
  slots: NormalizedSlot[];
  /** 依 slotNumber、station sortOrder；大地休息的關卡不建立 assignment */
  assignments: NormalizedAssignment[];
}

export interface NormalizedSchedule {
  teams: NormalizedTeam[];
  games: Record<GameCode, NormalizedGame>;
}

/** 解析一張工作表的結果：格式錯誤都收集在 issues（不會遇到第一個就停） */
export interface ParsedGame {
  game: NormalizedGame;
  issues: ImportIssue[];
}

/** 完整流程（overrides → 解析 → validation）的結果 */
export interface SchedulePipelineResult {
  /** 沒有任何錯誤時才有值 */
  schedule: NormalizedSchedule | null;
  /** 所有錯誤（全部列出） */
  issues: ImportIssue[];
  overrideOutcomes: OverrideOutcome[];
}
