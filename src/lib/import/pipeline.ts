/**
 * 完整流程（第五、二十六節）：套用 overrides → 解析 → validation → 正規化排程。
 * 純函式；讀檔在 excel.ts。任何一個錯誤都讓 schedule = null（不可匯入），但錯誤會全部列出。
 */
import type { GameCode } from "@/lib/types";
import { ALL_TEAMS } from "./config";
import { applyOverrides, SCHEDULE_OVERRIDES } from "./overrides";
import { parseGameGrid } from "./parse";
import { validateGame } from "./validate";
import type {
  ImportIssue,
  NormalizedGame,
  OfficialSheet,
  OverrideOutcome,
  ScheduleOverride,
  SchedulePipelineResult,
} from "./types";

export const GAME_ORDER: readonly GameCode[] = ["gold", "land"];

/** 單一遊戲：overrides → 解析 → validation */
export function processSheet(
  sheet: OfficialSheet,
  overrides: readonly ScheduleOverride[] = SCHEDULE_OVERRIDES,
): { game: NormalizedGame; issues: ImportIssue[]; overrideOutcomes: OverrideOutcome[] } {
  const applied = applyOverrides(sheet.grid, sheet.game, sheet.sheetName, overrides);
  const parsed = parseGameGrid(applied.grid, sheet.game, sheet.sheetName);
  const validation = validateGame(parsed.game);
  return {
    game: parsed.game,
    issues: [...applied.issues, ...parsed.issues, ...validation],
    overrideOutcomes: applied.outcomes,
  };
}

/** 兩個遊戲的完整流程 */
export function buildSchedule(
  sheets: Record<GameCode, OfficialSheet>,
  overrides: readonly ScheduleOverride[] = SCHEDULE_OVERRIDES,
): SchedulePipelineResult {
  const issues: ImportIssue[] = [];
  const overrideOutcomes: OverrideOutcome[] = [];
  const games = {} as Record<GameCode, NormalizedGame>;

  for (const code of GAME_ORDER) {
    const result = processSheet(sheets[code], overrides);
    games[code] = result.game;
    issues.push(...result.issues);
    overrideOutcomes.push(...result.overrideOutcomes);
  }

  return {
    schedule: issues.length === 0 ? { teams: ALL_TEAMS.map((t) => ({ ...t })), games } : null,
    issues,
    overrideOutcomes,
  };
}
