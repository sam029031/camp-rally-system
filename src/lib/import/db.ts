/**
 * 把正規化排程寫進 Supabase（第二十六節）。只給 scripts/import-schedule.ts 使用（service role client）。
 *
 * 可重跑：
 * - 沿用唯一一筆 is_active 的 events；沒有才用 EVENT_DATE 建立。
 * - 絕不覆寫 events.event_date、sim_*、群組名稱、games.end_policy／min_play_seconds，也不動 schedule_adjustments。
 *   唯一例外：--reset 時由 reset_game_records 把 sim_enabled 設為 false。
 * - 以自然鍵 upsert：games(event_id, code)、stations(game_id, code)、teams(code)、
 *   time_slots(game_id, slot_number)、assignments(slot_id, station_id)。
 * - 該遊戲已有打卡紀錄時預設拒絕；--reset 先呼叫 reset_game_records 清空執行期資料。
 *
 * 呼叫前必須已經通過 validation（schedule 只會在沒有任何錯誤時產生）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { GAME_DEFAULTS, TIMEZONE } from "@/lib/constants";
import type { AssignmentRow, EventRow, GameCode, GameRow, StationRow, TeamRow } from "@/lib/types";
import { GAME_ORDER } from "./pipeline";
import type { NormalizedGame, NormalizedSchedule, OverrideOutcome } from "./types";

/** 預設活動名稱（第一次建立 events 時使用；之後不覆寫） */
export const DEFAULT_EVENT_NAME = "宿營跑關";

/** 規則上不允許繼續匯入（例如已有打卡紀錄但沒加 --reset）。尚未寫入任何資料時丟出。 */
export class ImportAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportAbortError";
  }
}

export interface ImportScheduleOptions {
  /** --reset：先清空該遊戲的執行期資料 */
  reset: boolean;
  /** .env.local 的 EVENT_DATE（只在沒有 active event 時使用） */
  eventDate: string | undefined;
  /** audit log 用 */
  sourceFiles: Record<GameCode, string>;
  overrideOutcomes: readonly OverrideOutcome[];
  log: (line: string) => void;
}

export interface GameImportSummary {
  gameId: string;
  gameCreated: boolean;
  resetDone: boolean;
  stations: { inserted: number; updated: number; unchanged: number };
  slots: { inserted: number; updated: number; unchanged: number };
  assignments: { inserted: number; updated: number; deleted: number; unchanged: number };
}

export interface ImportScheduleResult {
  event: EventRow;
  eventCreated: boolean;
  games: Record<GameCode, GameImportSummary>;
  /** team code → row */
  teams: Map<string, TeamRow>;
  /** 各遊戲 station code → row */
  stations: Record<GameCode, Map<string, StationRow>>;
}

type Summary3 = { inserted: number; updated: number; unchanged: number };

/** supabase-js 回傳錯誤時轉成中文例外 */
function fail(step: string, error: { message: string; details?: string | null; hint?: string | null } | null): never {
  const extra = [error?.details, error?.hint].filter(Boolean).join("；");
  throw new Error(`${step}失敗：${error?.message ?? "未知錯誤"}${extra ? `（${extra}）` : ""}`);
}

function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** 'HH:MM' → Postgres time 'HH:MM:00' */
function toPgTime(hm: string): string {
  return `${hm}:00`;
}

/** Postgres time → 'HH:MM:SS'（比較用） */
function normalizePgTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t.slice(0, 8);
}

async function countCheckRecords(client: SupabaseClient, gameId: string): Promise<number> {
  const { count, error } = await client
    .from("v_check_records")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);
  if (error) fail("查詢打卡紀錄數", error);
  return count ?? 0;
}

async function loadActiveEvent(client: SupabaseClient): Promise<EventRow | null> {
  const { data, error } = await client.from("events").select("*").eq("is_active", true).maybeSingle();
  if (error) fail("讀取活動（events）", error);
  return (data as EventRow | null) ?? null;
}

async function loadGames(client: SupabaseClient, eventId: string): Promise<GameRow[]> {
  const { data, error } = await client.from("games").select("*").eq("event_id", eventId);
  if (error) fail("讀取遊戲（games）", error);
  return (data ?? []) as GameRow[];
}

/** 第一階段（唯讀）：確認能不能匯入。任何拒絕都在寫入前丟出 ImportAbortError。 */
async function preflight(
  client: SupabaseClient,
  opts: ImportScheduleOptions,
): Promise<{ event: EventRow | null; existingGames: Map<GameCode, GameRow>; recordCounts: Map<GameCode, number> }> {
  const event = await loadActiveEvent(client);
  const existingGames = new Map<GameCode, GameRow>();
  const recordCounts = new Map<GameCode, number>();

  if (!event) {
    if (!opts.eventDate || !isValidDate(opts.eventDate)) {
      throw new ImportAbortError(
        `資料庫還沒有 is_active 的活動，需要用 .env.local 的 EVENT_DATE 建立；目前 EVENT_DATE ${
          opts.eventDate ? `「${opts.eventDate}」不是有效日期` : "未設定"
        }（格式 YYYY-MM-DD，例如 2026-10-17）。`,
      );
    }
    return { event: null, existingGames, recordCounts };
  }

  for (const g of await loadGames(client, event.id)) existingGames.set(g.code, g);
  const blocked: string[] = [];
  for (const code of GAME_ORDER) {
    const g = existingGames.get(code);
    if (!g) continue;
    const n = await countCheckRecords(client, g.id);
    recordCounts.set(code, n);
    if (n > 0 && !opts.reset) blocked.push(`${g.name} 已有 ${n} 筆打卡紀錄（含已撤銷）`);
  }
  if (blocked.length > 0) {
    throw new ImportAbortError(
      `${blocked.join("；")}，預設拒絕匯入（沒有寫入任何資料）。\n` +
        "若確定要清空該遊戲的執行期資料（打卡、通知、延後、取消、延長）再匯入，請執行：npm run import -- --reset",
    );
  }
  return { event, existingGames, recordCounts };
}

async function upsertTeams(client: SupabaseClient, schedule: NormalizedSchedule): Promise<Map<string, TeamRow>> {
  const rows = schedule.teams.map((t) => ({
    code: t.code,
    name: t.name,
    is_staff_team: t.isStaffTeam,
    sort_order: t.sortOrder,
  }));
  const { data, error } = await client.from("teams").upsert(rows, { onConflict: "code" }).select("*");
  if (error) fail("寫入隊伍（teams）", error);
  const map = new Map<string, TeamRow>();
  for (const row of (data ?? []) as TeamRow[]) map.set(row.code, row);
  for (const t of schedule.teams) {
    if (!map.has(t.code)) throw new Error(`寫入隊伍後找不到 ${t.name}（code ${t.code}）`);
  }
  return map;
}

async function ensureGame(
  client: SupabaseClient,
  eventId: string,
  code: GameCode,
  existing: GameRow | undefined,
): Promise<{ game: GameRow; created: boolean }> {
  if (existing) return { game: existing, created: false };
  // 只在新建時使用預設值；之後 end_policy / min_play_seconds 只由 admin 頁修改
  const d = GAME_DEFAULTS[code];
  const { data, error } = await client
    .from("games")
    .insert({
      event_id: eventId,
      code,
      name: d.name,
      station_duration_seconds: d.stationDurationSeconds,
      transition_duration_seconds: d.transitionDurationSeconds,
      teams_per_station: d.teamsPerStation,
      end_policy: d.endPolicy,
      min_play_seconds: d.minPlaySeconds,
      sort_order: d.sortOrder,
    })
    .select("*")
    .single();
  if (error) fail(`建立遊戲 ${d.name}`, error);
  return { game: data as GameRow, created: true };
}

async function upsertStations(
  client: SupabaseClient,
  gameId: string,
  game: NormalizedGame,
  log: (line: string) => void,
): Promise<{ map: Map<string, StationRow>; summary: Summary3 }> {
  const { data: before, error: beforeErr } = await client.from("stations").select("*").eq("game_id", gameId);
  if (beforeErr) fail("讀取關卡（stations）", beforeErr);
  const beforeMap = new Map(((before ?? []) as StationRow[]).map((s) => [s.code, s]));
  const summary: Summary3 = { inserted: 0, updated: 0, unchanged: 0 };
  for (const s of game.stations) {
    const old = beforeMap.get(s.code);
    if (!old) summary.inserted++;
    else if (old.name !== s.name || old.source_name !== s.sourceName || old.sort_order !== s.sortOrder) summary.updated++;
    else summary.unchanged++;
  }

  const rows = game.stations.map((s) => ({
    game_id: gameId,
    code: s.code,
    name: s.name,
    source_name: s.sourceName,
    sort_order: s.sortOrder,
  }));
  const { data, error } = await client.from("stations").upsert(rows, { onConflict: "game_id,code" }).select("*");
  if (error) fail(`寫入 ${game.name} 關卡（stations）`, error);
  const map = new Map(((data ?? []) as StationRow[]).map((s) => [s.code, s]));

  const wanted = new Set(game.stations.map((s) => s.code));
  for (const old of beforeMap.values()) {
    if (!wanted.has(old.code)) {
      log(`  警告：資料庫中 ${game.name} 有 Excel 沒有的關卡 ${old.code}（${old.name}），未自動刪除，請人工確認。`);
    }
  }
  return { map, summary };
}

async function upsertSlots(
  client: SupabaseClient,
  gameId: string,
  game: NormalizedGame,
  log: (line: string) => void,
): Promise<{ map: Map<number, { id: string }>; summary: Summary3 }> {
  const { data: before, error: beforeErr } = await client
    .from("time_slots")
    .select("id, slot_number, start_local, end_local")
    .eq("game_id", gameId);
  if (beforeErr) fail("讀取時段（time_slots）", beforeErr);
  type SlotDbRow = { id: string; slot_number: number; start_local: string; end_local: string };
  const beforeMap = new Map(((before ?? []) as SlotDbRow[]).map((s) => [s.slot_number, s]));
  const summary: Summary3 = { inserted: 0, updated: 0, unchanged: 0 };
  for (const s of game.slots) {
    const old = beforeMap.get(s.slotNumber);
    if (!old) summary.inserted++;
    else if (normalizePgTime(old.start_local) !== toPgTime(s.start) || normalizePgTime(old.end_local) !== toPgTime(s.end))
      summary.updated++;
    else summary.unchanged++;
  }

  const rows = game.slots.map((s) => ({
    game_id: gameId,
    slot_number: s.slotNumber,
    start_local: toPgTime(s.start),
    end_local: toPgTime(s.end),
  }));
  const { data, error } = await client
    .from("time_slots")
    .upsert(rows, { onConflict: "game_id,slot_number" })
    .select("id, slot_number");
  if (error) fail(`寫入 ${game.name} 時段（time_slots）`, error);
  const map = new Map(((data ?? []) as Array<{ id: string; slot_number: number }>).map((s) => [s.slot_number, { id: s.id }]));

  const wanted = new Set(game.slots.map((s) => s.slotNumber));
  for (const old of beforeMap.values()) {
    if (!wanted.has(old.slot_number)) {
      log(`  警告：資料庫中 ${game.name} 有 Excel 沒有的第${old.slot_number}時段，未自動刪除，請人工確認。`);
    }
  }
  return { map, summary };
}

async function syncAssignments(
  client: SupabaseClient,
  gameRow: GameRow,
  game: NormalizedGame,
  slotIds: Map<number, { id: string }>,
  stations: Map<string, StationRow>,
  teams: Map<string, TeamRow>,
): Promise<GameImportSummary["assignments"]> {
  const { data: existingData, error } = await client.from("assignments").select("*").eq("game_id", gameRow.id);
  if (error) fail("讀取 assignments", error);
  const existing = new Map(((existingData ?? []) as AssignmentRow[]).map((a) => [`${a.slot_id}|${a.station_id}`, a]));

  const toInsert: Array<Omit<AssignmentRow, "id">> = [];
  const toUpdate: Array<{ id: string; team_a_id: string; team_b_id: string | null }> = [];
  const keep = new Set<string>();
  let unchanged = 0;

  for (const a of game.assignments) {
    const slotId = slotIds.get(a.slotNumber)?.id;
    const station = stations.get(a.stationCode);
    const teamA = teams.get(a.teamA);
    const teamB = a.teamB === null ? null : teams.get(a.teamB);
    if (!slotId || !station || !teamA || teamB === undefined) {
      throw new Error(`找不到 ${game.name} 第${a.slotNumber}時段 ${a.stationCode} 關（${a.cell}）對應的時段、關卡或隊伍`);
    }
    const key = `${slotId}|${station.id}`;
    keep.add(key);
    const teamBId = teamB ? teamB.id : null;
    const old = existing.get(key);
    if (!old) {
      toInsert.push({ game_id: gameRow.id, slot_id: slotId, station_id: station.id, team_a_id: teamA.id, team_b_id: teamBId });
    } else if (old.team_a_id !== teamA.id || old.team_b_id !== teamBId) {
      toUpdate.push({ id: old.id, team_a_id: teamA.id, team_b_id: teamBId });
    } else {
      unchanged++;
    }
  }
  const toDelete = [...existing.entries()].filter(([key]) => !keep.has(key)).map(([, a]) => a.id);

  // 刪除 / 改隊伍只允許在該遊戲沒有任何打卡紀錄時進行（check_records 會 cascade，不能誤刪紀錄）
  if (toDelete.length > 0 || toUpdate.length > 0) {
    const n = await countCheckRecords(client, gameRow.id);
    if (n > 0) {
      throw new Error(`${game.name} 目前有 ${n} 筆打卡紀錄，不能修改或刪除既有 assignments（請加 --reset）`);
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await client.from("assignments").insert(toInsert);
    if (insErr) fail(`新增 ${game.name} assignments`, insErr);
  }
  for (const u of toUpdate) {
    const { error: updErr } = await client
      .from("assignments")
      .update({ team_a_id: u.team_a_id, team_b_id: u.team_b_id })
      .eq("id", u.id);
    if (updErr) fail(`更新 ${game.name} assignment ${u.id}`, updErr);
  }
  if (toDelete.length > 0) {
    const { error: delErr } = await client.from("assignments").delete().in("id", toDelete);
    if (delErr) fail(`刪除 ${game.name} 已不在 Excel 的 assignments`, delErr);
  }
  return { inserted: toInsert.length, updated: toUpdate.length, deleted: toDelete.length, unchanged };
}

async function writeImportAudit(
  client: SupabaseClient,
  gameRow: GameRow,
  summary: GameImportSummary,
  opts: ImportScheduleOptions,
): Promise<void> {
  const overrides = opts.overrideOutcomes
    .filter((o) => o.override.game === gameRow.code)
    .map((o) => ({
      cell: o.cell,
      status: o.status,
      slot: o.override.slot,
      station: o.override.station,
      value: o.override.value,
      reason: o.override.reason,
    }));
  const { error } = await client.rpc("write_audit", {
    p_actor: null,
    p_game_id: gameRow.id,
    p_action: "IMPORT",
    p_target_table: "games",
    p_target_id: gameRow.id,
    p_before: null,
    p_after: {
      game: gameRow.code,
      source_file: opts.sourceFiles[gameRow.code],
      game_created: summary.gameCreated,
      reset: summary.resetDone,
      stations: summary.stations,
      slots: summary.slots,
      assignments: summary.assignments,
      overrides,
    },
    p_reason: opts.reset ? "import --reset" : "import",
    p_client_info: { source: "scripts/import-schedule.ts" },
  });
  if (error) fail(`寫入 ${gameRow.name} 的 IMPORT audit log`, error);
}

/** 把已通過 validation 的排程寫入資料庫 */
export async function importScheduleToDb(
  client: SupabaseClient,
  schedule: NormalizedSchedule,
  opts: ImportScheduleOptions,
): Promise<ImportScheduleResult> {
  const { log } = opts;
  const pre = await preflight(client, opts);

  // --reset：先清空既有遊戲的執行期資料（打卡、通知、延長、取消、延後），並關閉 Demo 時鐘
  const resetDone = new Set<GameCode>();
  if (opts.reset && pre.event) {
    for (const code of GAME_ORDER) {
      const g = pre.existingGames.get(code);
      if (!g) continue;
      const { data, error } = await client.rpc("reset_game_records", {
        p_game_id: g.id,
        p_identity_id: null,
        p_reason: "import --reset",
        p_disable_sim: true,
      });
      if (error) fail(`清空 ${g.name} 的執行期資料（reset_game_records）`, error);
      const result = data as { status?: string; code?: string } | null;
      if (result && result.status === "rejected") {
        throw new Error(`清空 ${g.name} 的執行期資料被拒絕：${result.code ?? "未知原因"}`);
      }
      resetDone.add(code);
      log(`  已清空 ${g.name} 的執行期資料（原有 ${pre.recordCounts.get(code) ?? 0} 筆打卡紀錄）`);
    }
    if (resetDone.size === 0 && pre.event.sim_enabled) {
      const { error } = await client.from("events").update({ sim_enabled: false }).eq("id", pre.event.id);
      if (error) fail("關閉 Demo 時鐘", error);
      log("  已關閉 Demo 時鐘（sim_enabled = false）");
    }
  }

  // 活動：沿用 active event；沒有才建立（之後不覆寫 event_date / sim_* / 名稱設定）
  let event = pre.event;
  let eventCreated = false;
  if (!event) {
    const { data, error } = await client
      .from("events")
      .insert({ name: DEFAULT_EVENT_NAME, event_date: opts.eventDate, timezone: TIMEZONE, is_active: true })
      .select("*")
      .single();
    if (error) fail("建立活動（events）", error);
    event = data as EventRow;
    eventCreated = true;
    log(`  已建立活動「${event.name}」，活動日期 ${event.event_date}`);
  } else {
    // --reset 可能改了 sim_enabled，重新讀一次
    const fresh = await loadActiveEvent(client);
    if (fresh) event = fresh;
    log(`  沿用現有活動「${event.name}」，活動日期 ${event.event_date}（不覆寫）`);
  }

  const teams = await upsertTeams(client, schedule);
  log(`  隊伍：${teams.size} 隊`);

  const games = {} as Record<GameCode, GameImportSummary>;
  const stationsByGame = {} as Record<GameCode, Map<string, StationRow>>;

  for (const code of GAME_ORDER) {
    const game = schedule.games[code];
    const { game: gameRow, created } = await ensureGame(client, event.id, code, pre.existingGames.get(code));
    const stations = await upsertStations(client, gameRow.id, game, log);
    const slots = await upsertSlots(client, gameRow.id, game, log);
    const assignments = await syncAssignments(client, gameRow, game, slots.map, stations.map, teams);

    // 讓已開啟的頁面透過 Realtime 重抓（只更新 updated_at，不動設定）
    if (!created) {
      const { error } = await client.from("games").update({ updated_at: new Date().toISOString() }).eq("id", gameRow.id);
      if (error) fail(`更新 ${gameRow.name} 的 updated_at`, error);
    }

    const summary: GameImportSummary = {
      gameId: gameRow.id,
      gameCreated: created,
      resetDone: resetDone.has(code),
      stations: stations.summary,
      slots: slots.summary,
      assignments,
    };
    await writeImportAudit(client, gameRow, summary, opts);
    games[code] = summary;
    stationsByGame[code] = stations.map;

    log(
      `  ${gameRow.name}：${created ? "新建遊戲" : "沿用遊戲（設定不變）"}；` +
        `關卡 新增 ${stations.summary.inserted}／更新 ${stations.summary.updated}／不變 ${stations.summary.unchanged}；` +
        `時段 新增 ${slots.summary.inserted}／更新 ${slots.summary.updated}／不變 ${slots.summary.unchanged}；` +
        `assignments 新增 ${assignments.inserted}／更新 ${assignments.updated}／刪除 ${assignments.deleted}／不變 ${assignments.unchanged}`,
    );
  }

  return { event, eventCreated, games, teams, stations: stationsByGame };
}
