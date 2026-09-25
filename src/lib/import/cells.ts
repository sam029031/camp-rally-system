/** A1 座標與 grid 存取小工具。 */
import type { ImportIssue, SheetGrid } from "./types";

/** 0-based 欄 index → 欄位字母（0 → 'A'、25 → 'Z'、26 → 'AA'） */
export function columnLetter(col: number): string {
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 0-based (row, col) → 'C5' */
export function cellAddress(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`;
}

/** 'C5' → 0-based { row, col }；格式不對回傳 null */
export function parseCellAddress(address: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(address.trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  if (row < 1) return null;
  return { row: row - 1, col: col - 1 };
}

/** 讀一格（超出範圍 = 空字串）；一律 trim */
export function cellText(grid: SheetGrid, row: number, col: number): string {
  const r = grid[row];
  if (!r) return "";
  const v = r[col];
  return v === undefined || v === null ? "" : String(v).trim();
}

/** 深拷貝 grid（overrides 與測試修改格子時用，不動原本的） */
export function cloneGrid(grid: SheetGrid): SheetGrid {
  return grid.map((row) => [...row]);
}

/** 寫一格（不足的列／欄補空字串），回傳同一個 grid */
export function setCell(grid: SheetGrid, row: number, col: number, value: string): SheetGrid {
  while (grid.length <= row) grid.push([]);
  const r = grid[row];
  while (r.length <= col) r.push("");
  r[col] = value;
  return grid;
}

/** 依 A1 座標寫一格（測試用） */
export function setCellA1(grid: SheetGrid, address: string, value: string): SheetGrid {
  const pos = parseCellAddress(address);
  if (!pos) throw new Error(`儲存格座標格式不正確：${address}`);
  return setCell(grid, pos.row, pos.col, value);
}

/** 錯誤訊息格式：「大地新跑關!C5：原因」 */
export function formatIssue(issue: ImportIssue): string {
  if (issue.sheet && issue.cell) return `${issue.sheet}!${issue.cell}：${issue.message}`;
  if (issue.sheet) return `${issue.sheet}：${issue.message}`;
  return issue.message;
}

export function issue(sheet: string | null, cell: string | null, message: string): ImportIssue {
  return { sheet, cell, message };
}
