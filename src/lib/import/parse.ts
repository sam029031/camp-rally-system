/**
 * 解析正式工作表的 grid（第三、四節）。純函式：輸入 string[][]，輸出正規化遊戲與格式錯誤。
 *
 * 固定版面：
 * - 第 1 列 B 欄起：關卡名稱
 * - 第 2~9 列：第 1~8 時段（A 欄 'HH:MM - HH:MM'）
 * - 第 12 列 B 欄起：關卡代號（必須恰為依欄位順序的 A~M／A~J）
 * - 第 10、11 列與第 13 列以後不讀
 *
 * 每一格都已經是 String(v).trim() 後的文字（見 excel.ts）。
 * 格式錯誤全部收集，不會遇到第一個就停；時段層級的檢查（缺隊、重複、PK 組數）在 validate.ts。
 */
import type { GameCode } from "@/lib/types";
import { GAME_NAMES, OFFICIAL_SLOTS, STAFF_TEAM_CODE } from "@/lib/constants";
import { cellAddress, cellText, columnLetter, issue } from "./cells";
import {
  EXPECTED_STATION_CODES,
  GOLD_CELL_PATTERN,
  LAND_CELL_PATTERN,
  LAYOUT,
  SLOT_TIME_PATTERN,
  STAFF_TEAM_EXCEL_TOKEN,
  STATION_DISPLAY_NAME_OVERRIDES,
  TEAM_COUNT,
} from "./config";
import type {
  ImportIssue,
  NormalizedAssignment,
  NormalizedSlot,
  NormalizedStation,
  ParsedGame,
  SheetGrid,
} from "./types";

/** 格子內的小隊編號 → 1..13 的整數；不合法回傳 null */
function parseTeamNumber(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= TEAM_COUNT ? n : null;
}

/** 關卡顯示名稱：只有集中清單列出的關卡改名，其餘照 Excel 原文（第三節） */
export function stationDisplayName(game: GameCode, code: string, sourceName: string): string {
  const hit = STATION_DISPLAY_NAME_OVERRIDES.find(
    (o) => o.game === game && o.code === code && o.sourceName === sourceName,
  );
  return hit ? hit.displayName : sourceName;
}

/** 解析第 1 列（關卡名稱）與第 12 列（關卡代號） */
function parseStations(grid: SheetGrid, game: GameCode, sheetName: string, issues: ImportIssue[]): NormalizedStation[] {
  const expected = EXPECTED_STATION_CODES[game];
  const stations: NormalizedStation[] = [];
  const range = `${expected[0]}~${expected[expected.length - 1]}`;

  expected.forEach((expectedCode, i) => {
    const col = LAYOUT.firstStationCol + i;
    const code = cellText(grid, LAYOUT.codeRow, col);
    if (code !== expectedCode) {
      issues.push(
        issue(
          sheetName,
          cellAddress(LAYOUT.codeRow, col),
          `關卡代號應為「${expectedCode}」（第 ${LAYOUT.codeRow + 1} 列必須依欄位順序恰為 ${range}），目前是${
            code === "" ? "空白" : `「${code}」`
          }`,
        ),
      );
    }
    const sourceName = cellText(grid, LAYOUT.nameRow, col);
    if (sourceName === "") {
      issues.push(issue(sheetName, cellAddress(LAYOUT.nameRow, col), `${expectedCode} 關的關卡名稱是空白`));
    }
    stations.push({
      code: expectedCode,
      name: stationDisplayName(game, expectedCode, sourceName),
      sourceName,
      sortOrder: i + 1,
      column: columnLetter(col),
    });
  });

  // 關卡範圍右邊不應該還有資料（第 1~9、12 列），否則代表版面和預期不同
  const lastCol = LAYOUT.firstStationCol + expected.length - 1;
  const rowsToCheck = [
    LAYOUT.nameRow,
    ...Array.from({ length: LAYOUT.slotCount }, (_, i) => LAYOUT.firstSlotRow + i),
    LAYOUT.codeRow,
  ];
  for (const row of rowsToCheck) {
    const width = grid[row]?.length ?? 0;
    for (let col = lastCol + 1; col < width; col++) {
      const text = cellText(grid, row, col);
      if (text !== "") {
        issues.push(
          issue(
            sheetName,
            cellAddress(row, col),
            `超出關卡範圍（${columnLetter(LAYOUT.firstStationCol)}~${columnLetter(lastCol)} 欄）的格子有資料「${text}」，請確認工作表版面`,
          ),
        );
      }
    }
  }
  return stations;
}

/** 解析 A2:A9 的時段字串，並比對正式時段（第三、四節） */
function parseSlots(grid: SheetGrid, game: GameCode, sheetName: string, issues: ImportIssue[]): NormalizedSlot[] {
  const official = OFFICIAL_SLOTS[game];
  const slots: NormalizedSlot[] = [];
  for (let i = 0; i < LAYOUT.slotCount; i++) {
    const slotNumber = i + 1;
    const row = LAYOUT.firstSlotRow + i;
    const address = cellAddress(row, LAYOUT.timeCol);
    const text = cellText(grid, row, LAYOUT.timeCol);
    const [officialStart, officialEnd] = official[i];
    const m = SLOT_TIME_PATTERN.exec(text);
    if (!m) {
      issues.push(
        issue(
          sheetName,
          address,
          `第${slotNumber}時段的時間${text === "" ? "是空白" : `「${text}」格式不正確`}（應為 'HH:MM - HH:MM'，例如 '${officialStart} - ${officialEnd}'）`,
        ),
      );
    } else {
      const start = `${m[1]}:${m[2]}`;
      const end = `${m[3]}:${m[4]}`;
      if (start !== officialStart || end !== officialEnd) {
        issues.push(
          issue(
            sheetName,
            address,
            `第${slotNumber}時段時間 ${start} - ${end} 與正式時段 ${officialStart} - ${officialEnd} 不一致`,
          ),
        );
      }
    }
    slots.push({ slotNumber, start: officialStart, end: officialEnd, row: row + 1 });
  }
  return slots;
}

/** 黃金格：整數 1~13（raw:false 下是字串 '2'） */
function parseGoldCell(
  text: string,
  slotNumber: number,
  station: NormalizedStation,
  address: string,
  sheetName: string,
  issues: ImportIssue[],
): number | null {
  const where = `第${slotNumber}時段 ${station.code} 關（${station.sourceName || "未命名"}）`;
  if (text === "") {
    issues.push(issue(sheetName, address, `${where}沒有分配小隊（黃金每個時段每個關卡都必須有一個小隊）`));
    return null;
  }
  if (text.includes(STAFF_TEAM_EXCEL_TOKEN)) {
    issues.push(issue(sheetName, address, `${where}出現幹部隊「${text}」；黃金傳奇沒有幹部隊`));
    return null;
  }
  if (!GOLD_CELL_PATTERN.test(text)) {
    issues.push(issue(sheetName, address, `${where}「${text}」不是小隊編號（黃金格子應為 1~${TEAM_COUNT} 的整數）`));
    return null;
  }
  const n = parseTeamNumber(text);
  if (n === null) {
    issues.push(issue(sheetName, address, `${where}小隊編號 ${text} 超出 1~${TEAM_COUNT}`));
    return null;
  }
  return n;
}

/** 大地 PK 格：'6/8'、'7/幹'；空白 = 休息（第四節） */
function parseLandCell(
  text: string,
  slotNumber: number,
  station: NormalizedStation,
  address: string,
  sheetName: string,
  issues: ImportIssue[],
): { teamA: string; teamB: string } | "rest" | null {
  if (text === "") return "rest";
  const where = `第${slotNumber}時段 ${station.code} 關（${station.sourceName || "未命名"}）`;
  const m = LAND_CELL_PATTERN.exec(text);
  if (!m) {
    issues.push(
      issue(sheetName, address, `${where}「${text}」不是 PK 格式（應為「6/8」或「7/幹」；空白代表本時段休息）`),
    );
    return null;
  }
  let ok = true;
  const a = parseTeamNumber(m[1]);
  if (a === null) {
    issues.push(issue(sheetName, address, `${where}「${text}」左邊的隊號 ${m[1]} 超出 1~${TEAM_COUNT}`));
    ok = false;
  }
  let teamB: string | null;
  if (m[2] === STAFF_TEAM_EXCEL_TOKEN) {
    teamB = STAFF_TEAM_CODE;
  } else {
    const b = parseTeamNumber(m[2]);
    if (b === null) {
      issues.push(issue(sheetName, address, `${where}「${text}」右邊的隊號 ${m[2]} 超出 1~${TEAM_COUNT}`));
      ok = false;
      teamB = null;
    } else {
      teamB = String(b);
    }
  }
  if (!ok || a === null || teamB === null) return null;
  const teamA = String(a);
  if (teamA === teamB) {
    issues.push(issue(sheetName, address, `${where}「${text}」兩隊相同`));
    return null;
  }
  return { teamA, teamB };
}

function parseGrid(grid: SheetGrid, game: GameCode, sheetName: string): ParsedGame {
  const issues: ImportIssue[] = [];
  const stations = parseStations(grid, game, sheetName, issues);
  const slots = parseSlots(grid, game, sheetName, issues);
  const assignments: NormalizedAssignment[] = [];

  for (const slot of slots) {
    const row = slot.row - 1;
    stations.forEach((station, i) => {
      const col = LAYOUT.firstStationCol + i;
      const address = cellAddress(row, col);
      const text = cellText(grid, row, col);
      if (game === "gold") {
        const n = parseGoldCell(text, slot.slotNumber, station, address, sheetName, issues);
        if (n !== null) {
          assignments.push({ slotNumber: slot.slotNumber, stationCode: station.code, teamA: String(n), teamB: null, cell: address });
        }
      } else {
        const pk = parseLandCell(text, slot.slotNumber, station, address, sheetName, issues);
        if (pk && pk !== "rest") {
          assignments.push({
            slotNumber: slot.slotNumber,
            stationCode: station.code,
            teamA: pk.teamA,
            teamB: pk.teamB,
            cell: address,
          });
        }
      }
    });
  }

  return {
    game: { code: game, name: GAME_NAMES[game], sheetName, stations, slots, assignments },
    issues,
  };
}

/** 解析「黃金新路線」的 grid */
export function parseGoldGrid(grid: SheetGrid, sheetName: string): ParsedGame {
  return parseGrid(grid, "gold", sheetName);
}

/** 解析「大地新跑關」的 grid */
export function parseLandGrid(grid: SheetGrid, sheetName: string): ParsedGame {
  return parseGrid(grid, "land", sheetName);
}

export function parseGameGrid(grid: SheetGrid, game: GameCode, sheetName: string): ParsedGame {
  return game === "gold" ? parseGoldGrid(grid, sheetName) : parseLandGrid(grid, sheetName);
}
