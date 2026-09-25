/**
 * CSV 產生（第二十五節「匯出 CSV」）。純函式，單元測試見 tests/unit/server-csv.test.ts。
 * - UTF-8 BOM：Excel 直接開啟中文不亂碼。
 * - CRLF 換行；含逗號、雙引號、換行的欄位加雙引號並跳脫。
 * - 以 = + @ 或 tab 開頭的文字前加 '，避免 Excel 公式注入（原因欄是人輸入的）。
 */

export type CsvCell = string | number | boolean | null | undefined;

export const CSV_BOM = "﻿";

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "boolean" ? (v ? "是" : "否") : String(v);
  if (typeof v === "string" && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  if (typeof v === "string" && /^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s) && !/^-\d{2}:\d{2}/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
