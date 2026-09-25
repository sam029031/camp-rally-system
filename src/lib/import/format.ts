/** terminal 輸出用：正規化排程表（npm run import:check 成功時印出）。 */
import { formatIssue } from "./cells";
import { teamLabel } from "./config";
import type { ImportIssue, NormalizedGame, NormalizedSchedule } from "./types";

/** terminal 顯示寬度（全形字算 2） */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

export function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function formatGame(game: NormalizedGame): string[] {
  const lines: string[] = [];
  const pk = game.code === "land";
  lines.push(`=== ${game.name}（工作表「${game.sheetName}」）===`);
  lines.push(
    `${game.stations.length} 個關卡、${game.slots.length} 個時段、${game.assignments.length} 個 assignment` +
      (pk ? "（休息的關卡不建立 assignment）" : ""),
  );
  for (const s of game.stations) {
    if (s.name !== s.sourceName) {
      lines.push(`  註：${s.code} 關顯示名稱「${s.name}」（Excel 原文「${s.sourceName}」）`);
    }
  }
  const labelWidth = Math.max(...game.stations.map((s) => displayWidth(`${s.code} ${s.name}`))) + 2;

  for (const slot of game.slots) {
    const list = game.assignments.filter((a) => a.slotNumber === slot.slotNumber);
    const byStation = new Map(list.map((a) => [a.stationCode, a]));
    const rest = game.stations.filter((s) => !byStation.has(s.code)).map((s) => s.code);
    const head = `第${slot.slotNumber}時段 ${slot.start}–${slot.end}`;
    lines.push("");
    lines.push(pk ? `${head}（${list.length} 組 PK，休息：${rest.join("、") || "無"}）` : head);
    for (const station of game.stations) {
      const a = byStation.get(station.code);
      const label = padDisplay(`${station.code} ${station.name}`, labelWidth);
      const teams = !a ? "本時段休息" : a.teamB === null ? teamLabel(a.teamA) : `${teamLabel(a.teamA)} vs ${teamLabel(a.teamB)}`;
      lines.push(`  ${label}${teams}`);
    }
  }
  return lines;
}

/** 兩個遊戲的完整排程表 */
export function formatScheduleTable(schedule: NormalizedSchedule): string {
  const lines: string[] = [];
  lines.push(`隊伍：${schedule.teams.map((t) => t.name).join("、")}（共 ${schedule.teams.length} 隊；幹部隊只參加大地遊戲）`);
  for (const game of [schedule.games.gold, schedule.games.land]) {
    lines.push("");
    lines.push(...formatGame(game));
  }
  return lines.join("\n");
}

/** 錯誤清單（全部列出） */
export function formatIssues(issues: readonly ImportIssue[]): string {
  return issues.map((i, idx) => `  ${idx + 1}. ${formatIssue(i)}`).join("\n");
}
