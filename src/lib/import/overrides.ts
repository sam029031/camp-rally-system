/**
 * 已知的資料修正（第五節）：集中放在這一份清單，不散寫在 parser 裡，也不修改 Excel 檔。
 *
 * 流程：讀取 Excel → applyOverrides（印出套用了哪幾筆）→ validation → 匯入。
 * - 原格 trim 後為空：套用。
 * - 原格已等於 override 的值（例如之後已在 Excel 把 C5 改成 2/4）：只提示，不報錯。
 * - 原格是其他非空值：報錯，要求人工確認，不覆蓋。
 */
import type { GameCode } from "@/lib/types";
import { cellAddress, cellText, cloneGrid, issue, setCell } from "./cells";
import { EXPECTED_STATION_CODES, LAYOUT } from "./config";
import type { ImportIssue, OverrideOutcome, OverrideResult, ScheduleOverride, SheetGrid } from "./types";

export const SCHEDULE_OVERRIDES: readonly ScheduleOverride[] = [
  {
    game: "land",
    slot: 4,
    station: "B",
    value: "2/4",
    reason: "原檔該格為空白字元，人工確認為第2、4小隊",
  },
];

/**
 * 依第 12 列的關卡代號找出欄位（0-based）。
 * 找不到（或出現超過一次）時回傳 null，由呼叫端報錯。
 */
export function findStationColumn(grid: SheetGrid, game: GameCode, stationCode: string): number | null {
  const stationCount = EXPECTED_STATION_CODES[game].length;
  const matches: number[] = [];
  for (let i = 0; i < stationCount; i++) {
    const col = LAYOUT.firstStationCol + i;
    if (cellText(grid, LAYOUT.codeRow, col) === stationCode) matches.push(col);
  }
  return matches.length === 1 ? matches[0] : null;
}

/** 在 grid 上套用某一個遊戲的 overrides（回傳新 grid，不修改傳入的 grid） */
export function applyOverrides(
  grid: SheetGrid,
  game: GameCode,
  sheetName: string,
  overrides: readonly ScheduleOverride[] = SCHEDULE_OVERRIDES,
): OverrideResult {
  const out = cloneGrid(grid);
  const outcomes: OverrideOutcome[] = [];
  const issues: ImportIssue[] = [];
  const codeRowLabel = `第 ${LAYOUT.codeRow + 1} 列`;

  for (const ov of overrides) {
    if (ov.game !== game) continue;
    const describe = `overrides（第${ov.slot}時段 ${ov.station} 關 = ${ov.value}）`;

    if (!Number.isInteger(ov.slot) || ov.slot < 1 || ov.slot > LAYOUT.slotCount) {
      issues.push(issue(sheetName, null, `${describe}：時段必須是 1~${LAYOUT.slotCount}`));
      outcomes.push({ override: ov, sheet: sheetName, cell: null, status: "error", originalValue: null });
      continue;
    }
    const value = ov.value.trim();
    if (value === "") {
      issues.push(issue(sheetName, null, `${describe}：修正值不可為空白`));
      outcomes.push({ override: ov, sheet: sheetName, cell: null, status: "error", originalValue: null });
      continue;
    }
    const col = findStationColumn(out, game, ov.station);
    if (col === null) {
      issues.push(
        issue(sheetName, null, `${describe}：在${codeRowLabel}找不到唯一的關卡代號「${ov.station}」，無法套用`),
      );
      outcomes.push({ override: ov, sheet: sheetName, cell: null, status: "error", originalValue: null });
      continue;
    }

    const row = LAYOUT.firstSlotRow + ov.slot - 1;
    const address = cellAddress(row, col);
    const current = cellText(out, row, col);

    if (current === "") {
      setCell(out, row, col, value);
      outcomes.push({ override: ov, sheet: sheetName, cell: address, status: "applied", originalValue: current });
    } else if (current === value) {
      outcomes.push({ override: ov, sheet: sheetName, cell: address, status: "already", originalValue: current });
    } else {
      issues.push(
        issue(
          sheetName,
          address,
          `${describe}預期原格為空白，但目前是「${current}」。請人工確認正確的隊伍後，修改 Excel 或 overrides 清單（不會自動覆蓋）`,
        ),
      );
      outcomes.push({ override: ov, sheet: sheetName, cell: address, status: "error", originalValue: current });
    }
  }

  return { grid: out, outcomes, issues };
}

/** terminal 用：override 套用結果的說明文字 */
export function describeOverrideOutcome(o: OverrideOutcome): string {
  const where = o.cell ? `${o.sheet}!${o.cell}` : o.sheet;
  const what = `第${o.override.slot}時段 ${o.override.station} 關 → ${o.override.value}`;
  switch (o.status) {
    case "applied":
      return `已套用 override：${where}（${what}；原格為空白）。原因：${o.override.reason}`;
    case "already":
      return `提示：${where} 已經是 ${o.override.value}，override 不需要套用（${what}）`;
    case "error":
      return `override 未套用：${where}（${what}），見下方錯誤`;
  }
}
