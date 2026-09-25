/**
 * Excel 匯入模組（純函式部分）。
 * 讀檔（node:fs + SheetJS）在 ./excel，寫入 DB 在 ./db 與 ./identities，只給 scripts 與測試直接 import，
 * 避免被前端 bundle 帶進去。
 */
export * from "./types";
export * from "./config";
export {
  cellAddress,
  cellText,
  cloneGrid,
  columnLetter,
  formatIssue,
  parseCellAddress,
  setCell,
  setCellA1,
} from "./cells";
export { SCHEDULE_OVERRIDES, applyOverrides, describeOverrideOutcome, findStationColumn } from "./overrides";
export { parseGameGrid, parseGoldGrid, parseLandGrid, stationDisplayName } from "./parse";
export { validateGame, validateGold, validateLand } from "./validate";
export { GAME_ORDER, buildSchedule, processSheet } from "./pipeline";
export { formatIssues, formatScheduleTable } from "./format";
