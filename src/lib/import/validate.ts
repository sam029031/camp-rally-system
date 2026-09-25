/**
 * 時段層級的 validation（第五、二十六節）。輸入是 parse.ts 解析出的正規化遊戲。
 *
 * 黃金每一時段：13 個關卡各一隊、第 1~13 小隊各恰好一次、沒有幹部隊。
 * 大地每一時段：恰 7 組 PK、13 小隊＋幹部隊共 14 隊各恰好一次、3 個關卡休息。
 *
 * 注意：「每隊走 8 個不同關卡」「沒有重複 PK」「各關啟用次數」等只是本次檔案的已驗證事實，
 * 只寫在測試裡，不寫成通用 validation（之後換年份的排程不一定相同）。
 */
import { STAFF_TEAM_CODE } from "@/lib/constants";
import { cellAddress, columnLetter, issue } from "./cells";
import { ALL_TEAMS, LAND_PAIRS_PER_SLOT, LAYOUT, teamLabel } from "./config";
import type { ImportIssue, NormalizedAssignment, NormalizedGame } from "./types";

/** 該時段整列的範圍（例如 'B5:K5'），時段層級錯誤的座標 */
function slotRowRange(game: NormalizedGame, row: number): string {
  const first = LAYOUT.firstStationCol;
  const last = first + game.stations.length - 1;
  return `${cellAddress(row - 1, first)}:${columnLetter(last)}${row}`;
}

/** 依隊伍統計出現的格子 */
function teamOccurrences(assignments: NormalizedAssignment[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const a of assignments) {
    for (const code of a.teamB === null ? [a.teamA] : [a.teamA, a.teamB]) {
      const cells = map.get(code) ?? [];
      cells.push(a.cell);
      map.set(code, cells);
    }
  }
  return map;
}

/** 缺隊與重複隊伍的訊息 */
function teamCoverageMessages(expectedCodes: readonly string[], occurrences: Map<string, string[]>): string[] {
  const messages: string[] = [];
  const missing = expectedCodes.filter((code) => !occurrences.has(code));
  if (missing.length > 0) messages.push(`缺${missing.map(teamLabel).join("、")}`);
  for (const code of expectedCodes) {
    const cells = occurrences.get(code);
    if (cells && cells.length > 1) messages.push(`${teamLabel(code)}重複出現 ${cells.length} 次（${cells.join("、")}）`);
  }
  return messages;
}

export function validateGold(game: NormalizedGame): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const expectedTeams = ALL_TEAMS.filter((t) => !t.isStaffTeam).map((t) => t.code);

  for (const slot of game.slots) {
    const range = slotRowRange(game, slot.row);
    const list = game.assignments.filter((a) => a.slotNumber === slot.slotNumber);
    const prefix = `第${slot.slotNumber}時段：`;

    if (list.length !== game.stations.length) {
      issues.push(
        issue(game.sheetName, range, `${prefix}只有 ${list.length} 個關卡有分配小隊（應為 ${game.stations.length} 個關卡各一隊）`),
      );
    }
    // 每關一隊：同一關卡在同一時段只能有一筆
    const perStation = new Map<string, number>();
    for (const a of list) perStation.set(a.stationCode, (perStation.get(a.stationCode) ?? 0) + 1);
    for (const [code, count] of perStation) {
      if (count > 1) issues.push(issue(game.sheetName, range, `${prefix}${code} 關分配了 ${count} 隊（每關只能一隊）`));
    }
    const occ = teamOccurrences(list);
    if (occ.has(STAFF_TEAM_CODE)) {
      issues.push(issue(game.sheetName, range, `${prefix}出現幹部隊（${occ.get(STAFF_TEAM_CODE)!.join("、")}）；黃金傳奇沒有幹部隊`));
    }
    for (const message of teamCoverageMessages(expectedTeams, occ)) {
      issues.push(issue(game.sheetName, range, `${prefix}${message}`));
    }
  }
  return issues;
}

export function validateLand(game: NormalizedGame): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const expectedTeams = ALL_TEAMS.map((t) => t.code); // 13 小隊 + 幹部隊
  const expectedRest = game.stations.length - LAND_PAIRS_PER_SLOT;

  for (const slot of game.slots) {
    const range = slotRowRange(game, slot.row);
    const list = game.assignments.filter((a) => a.slotNumber === slot.slotNumber);
    const prefix = `第${slot.slotNumber}時段：`;

    if (list.length !== LAND_PAIRS_PER_SLOT) {
      const rest = game.stations.length - list.length;
      issues.push(
        issue(
          game.sheetName,
          range,
          `${prefix}不是 ${LAND_PAIRS_PER_SLOT} 組 PK（目前 ${list.length} 組），休息關卡應為 ${expectedRest} 個（目前 ${rest} 個）`,
        ),
      );
    }
    for (const a of list) {
      if (a.teamB === null) {
        issues.push(issue(game.sheetName, a.cell, `${prefix}${a.stationCode} 關只有一隊（大地每一啟用關卡必須 2 隊）`));
      }
    }
    for (const message of teamCoverageMessages(expectedTeams, teamOccurrences(list))) {
      issues.push(issue(game.sheetName, range, `${prefix}${message}`));
    }
  }
  return issues;
}

export function validateGame(game: NormalizedGame): ImportIssue[] {
  return game.code === "gold" ? validateGold(game) : validateLand(game);
}
