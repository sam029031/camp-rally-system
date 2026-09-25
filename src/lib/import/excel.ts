/**
 * 讀取 Excel（第四節，已用 SheetJS 實測的讀法）。只在 Node（scripts / 測試）使用。
 *
 * - XLSX.readFile 只解析正式工作表（sheets 選項），舊版工作表永遠不讀。
 * - sheet_to_json(sheet, { header: 1, raw: false, defval: '' })：
 *   raw:false 讓日期格輸出 Excel 顯示文字（'6/8'），defval:'' 讓空格一律是 ''。
 * - 每一格 String(v).trim()。不用 cellDates、不讀 cell.v（會把 6/8 變成 6/7）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import type { GameCode } from "@/lib/types";
import { issue } from "./cells";
import { DEFAULT_EXCEL_PATHS, OFFICIAL_SHEET_NAMES } from "./config";
import { buildSchedule, GAME_ORDER, processSheet } from "./pipeline";
import { SCHEDULE_OVERRIDES } from "./overrides";
import type { ImportIssue, OfficialSheet, ScheduleOverride, SchedulePipelineResult, SheetGrid } from "./types";

XLSX.set_fs(fs);

/** 讀取活頁簿，只解析指定遊戲的正式工作表 */
export function readOfficialWorkbook(filePath: string, game: GameCode): XLSX.WorkBook {
  return XLSX.readFile(filePath, { sheets: OFFICIAL_SHEET_NAMES[game] });
}

/**
 * 工作表 → grid。grid 對齊 A1：若工作表範圍不是從 A1 開始，前面補空列／空欄，
 * 讓 grid[row][col] 永遠對應 Excel 的儲存格座標。
 */
export function sheetToGrid(sheet: XLSX.WorkSheet): SheetGrid {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const origin = XLSX.utils.decode_range(ref).s;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  const grid: SheetGrid = Array.from({ length: origin.r }, () => []);
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : [];
    grid.push([...Array.from({ length: origin.c }, () => ""), ...cells.map((v) => String(v ?? "").trim())]);
  }
  return grid;
}

/** 從活頁簿取出正式工作表（只讀正式那一張；其他工作表完全不碰） */
export function officialSheetFromWorkbook(
  wb: XLSX.WorkBook,
  game: GameCode,
): { sheet: OfficialSheet | null; issues: ImportIssue[] } {
  const sheetName = OFFICIAL_SHEET_NAMES[game];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      sheet: null,
      issues: [issue(sheetName, null, `找不到正式工作表「${sheetName}」（檔案內的工作表：${wb.SheetNames.join("、") || "無"}）`)],
    };
  }
  return { sheet: { game, sheetName, grid: sheetToGrid(ws) }, issues: [] };
}

/** 一份正式工作表的讀取結果（readOfficialSheet 的回傳） */
export interface OfficialSheetRead {
  sheet: OfficialSheet | null;
  issues: ImportIssue[];
}

/** 讀檔 → 正式工作表 grid */
export function readOfficialSheet(filePath: string, game: GameCode): OfficialSheetRead {
  if (!fs.existsSync(filePath)) {
    return { sheet: null, issues: [issue(null, null, `找不到 Excel 檔案：${filePath}`)] };
  }
  let wb: XLSX.WorkBook;
  try {
    wb = readOfficialWorkbook(filePath, game);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { sheet: null, issues: [issue(null, null, `無法讀取 Excel 檔案 ${filePath}：${reason}`)] };
  }
  return officialSheetFromWorkbook(wb, game);
}

/** 預設路徑解析成絕對路徑（相對於 baseDir，預設為目前工作目錄 = 專案根目錄） */
export function resolveExcelPaths(
  custom: Partial<Record<GameCode, string>> = {},
  baseDir: string = process.cwd(),
): Record<GameCode, string> {
  return {
    gold: path.resolve(baseDir, custom.gold ?? DEFAULT_EXCEL_PATHS.gold),
    land: path.resolve(baseDir, custom.land ?? DEFAULT_EXCEL_PATHS.land),
  };
}

/**
 * 讀取結果 → overrides → 解析 → validation → 正規化排程（純函式，測試可直接傳記憶體中的 grid）。
 *
 * 任一份讀不到時仍把「有讀到」的工作表完整跑過 overrides → 解析 → validation，
 * 讀取錯誤排在最前面、其他錯誤接在後面一次全部列出（第二十六節：錯誤要一次列完，不要改一個才看到下一個）；
 * 這種情況 schedule 一律為 null。
 */
export function buildScheduleFromReads(
  reads: Record<GameCode, OfficialSheetRead>,
  overrides: readonly ScheduleOverride[] = SCHEDULE_OVERRIDES,
): SchedulePipelineResult {
  const readIssues: ImportIssue[] = [];
  const sheets = {} as Record<GameCode, OfficialSheet>;
  let allLoaded = true;
  for (const game of GAME_ORDER) {
    const { sheet, issues } = reads[game];
    readIssues.push(...issues);
    if (sheet) sheets[game] = sheet;
    else {
      allLoaded = false;
      if (issues.length === 0) readIssues.push(issue(null, null, `無法讀取「${OFFICIAL_SHEET_NAMES[game]}」工作表`));
    }
  }
  if (allLoaded && readIssues.length === 0) return buildSchedule(sheets, overrides);

  const issues = [...readIssues];
  const overrideOutcomes: SchedulePipelineResult["overrideOutcomes"] = [];
  for (const game of GAME_ORDER) {
    const sheet = reads[game].sheet;
    if (!sheet) continue;
    const result = processSheet(sheet, overrides);
    issues.push(...result.issues);
    overrideOutcomes.push(...result.overrideOutcomes);
  }
  return { schedule: null, issues, overrideOutcomes };
}

/** 讀兩份 Excel → overrides → validation → 正規化排程（讀不到的檔案不影響另一份的檢查） */
export function loadScheduleFromFiles(
  paths: Record<GameCode, string>,
  overrides: readonly ScheduleOverride[] = SCHEDULE_OVERRIDES,
): SchedulePipelineResult {
  const reads = {} as Record<GameCode, OfficialSheetRead>;
  for (const game of GAME_ORDER) reads[game] = readOfficialSheet(paths[game], game);
  return buildScheduleFromReads(reads, overrides);
}
