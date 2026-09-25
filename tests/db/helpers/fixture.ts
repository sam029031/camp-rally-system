/**
 * 每個 DB 測試檔自己的測試活動（SPEC 第三十節）：
 * is_active = false 的 event（開啟模擬時鐘，app_now_for_event 由測試控制）＋ games／time_slots（正式時段）／
 * stations／teams（全域唯一的隨機 code，不碰正式的 '1'..'13'、'S'）／assignments／identities。
 * cleanup() 依序刪除：本測試的 audit_logs → event（cascade 到 games 以下所有資料）→ identities → teams。
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GAME_DEFAULTS, OFFICIAL_SLOTS } from "@/lib/constants";
import type { GameCode } from "@/lib/types";
import { getClock, must, setAppTime } from "./db";

/** 測試活動日期（任何日期都可以；時間一律由模擬時鐘決定） */
export const TEST_EVENT_DATE = "2030-08-01";

export interface AssignmentSpec {
  slot: number;
  station: string;
  /** 黃金 1 隊、大地 2 隊（team key） */
  teams: [string] | [string, string];
}

export interface GameSpec {
  code: GameCode;
  /** 關卡代號（整個 fixture 內不可重複） */
  stations: string[];
  assignments: AssignmentSpec[];
  minPlaySeconds?: number;
}

export interface FixtureSpec {
  /** 檔名之類的標籤，放進活動名稱方便辨識 */
  label: string;
  /** team key（例如 'T1'）；DB 的 code 會是 t<隨機>-<key> */
  teams: string[];
  games: GameSpec[];
}

export interface GameFixture {
  id: string;
  code: GameCode;
  slotIds: Map<number, string>;
}

export interface Fixture {
  runId: string;
  eventId: string;
  eventDate: string;
  games: Partial<Record<GameCode, GameFixture>>;
  adminId: string;
  viewerId: string;
  /** team key → teams.id */
  team(key: string): string;
  /** team key → TEAM identity id */
  teamIdentity(key: string): string;
  /** station code → stations.id */
  station(code: string): string;
  /** station code → STATION identity id */
  stationIdentity(code: string): string;
  /** (時段, 關卡代號) → assignment id */
  a(slot: number, station: string): string;
  game(code: GameCode): GameFixture;
  /** 設定本活動的模擬時間（台北時間 'HH:mm[:ss]'） */
  at(time: string, speed?: number): Promise<number>;
  cleanup(): Promise<void>;
}

function lookup<V>(map: Map<string, V>, key: string, what: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`fixture 沒有${what}「${key}」`);
  return v;
}

export async function createFixture(client: SupabaseClient, spec: FixtureSpec): Promise<Fixture> {
  const runId = randomBytes(4).toString("hex");
  const teamIds = new Map<string, string>();
  const teamIdentityIds = new Map<string, string>();
  const stationIds = new Map<string, string>();
  const stationIdentityIds = new Map<string, string>();
  const assignmentIds = new Map<string, string>();
  const games: Partial<Record<GameCode, GameFixture>> = {};
  const identityIds: string[] = [];
  let eventId: string | null = null;

  const cleanup = async (): Promise<void> => {
    const gameIds = Object.values(games).map((g) => g!.id);
    const errors: string[] = [];
    const run = async (what: string, q: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q;
      if (error) errors.push(`${what}：${error.message}`);
    };
    if (gameIds.length > 0) await run("刪除 audit_logs（game）", client.from("audit_logs").delete().in("game_id", gameIds));
    if (identityIds.length > 0) {
      await run("刪除 audit_logs（actor）", client.from("audit_logs").delete().in("actor_identity_id", identityIds));
    }
    const aIds = Array.from(assignmentIds.values());
    if (aIds.length > 0) await run("刪除 audit_logs（target）", client.from("audit_logs").delete().in("target_id", aIds));
    if (eventId) await run("刪除測試 event", client.from("events").delete().eq("id", eventId).eq("is_active", false));
    if (identityIds.length > 0) await run("刪除測試 identities", client.from("identities").delete().in("id", identityIds));
    const tIds = Array.from(teamIds.values());
    if (tIds.length > 0) await run("刪除測試 teams", client.from("teams").delete().in("id", tIds));
    if (errors.length > 0) throw new Error(`清除測試資料失敗：\n${errors.join("\n")}`);
  };

  try {
    // ---- event（is_active = false；模擬時鐘開啟，先停在活動日 08:00）
    const { server_now } = await getClock(client, null);
    const ev = await must<{ id: string }>(
      "建立測試 event",
      client
        .from("events")
        .insert({
          name: `DB測試 ${spec.label} ${runId}`,
          event_date: TEST_EVENT_DATE,
          timezone: "Asia/Taipei",
          is_active: false,
          sim_enabled: true,
          sim_speed: 1,
          sim_anchor_real: server_now,
          sim_anchor_virtual: `${TEST_EVENT_DATE}T08:00:00+08:00`,
        })
        .select("id")
        .single(),
    );
    eventId = ev.id;

    // ---- teams（code 全域唯一）
    const teamRows = await must<Array<{ id: string; code: string }>>(
      "建立測試 teams",
      client
        .from("teams")
        .insert(
          spec.teams.map((key, i) => ({
            code: `t${runId}-${key}`,
            name: `測試${key}隊`,
            is_staff_team: false,
            sort_order: 1000 + i,
          })),
        )
        .select("id, code"),
    );
    for (const row of teamRows) teamIds.set(row.code.slice(`t${runId}-`.length), row.id);

    // ---- games / slots / stations / assignments
    for (const g of spec.games) {
      const d = GAME_DEFAULTS[g.code];
      const game = await must<{ id: string }>(
        `建立測試 game（${g.code}）`,
        client
          .from("games")
          .insert({
            event_id: eventId,
            code: g.code,
            name: `${d.name}（DB測試）`,
            station_duration_seconds: d.stationDurationSeconds,
            transition_duration_seconds: d.transitionDurationSeconds,
            teams_per_station: d.teamsPerStation,
            end_policy: d.endPolicy,
            min_play_seconds: g.minPlaySeconds ?? d.minPlaySeconds,
            sort_order: d.sortOrder,
          })
          .select("id")
          .single(),
      );
      const slots = await must<Array<{ id: string; slot_number: number }>>(
        `建立測試 time_slots（${g.code}）`,
        client
          .from("time_slots")
          .insert(
            OFFICIAL_SLOTS[g.code].map(([start, end], i) => ({
              game_id: game.id,
              slot_number: i + 1,
              start_local: start,
              end_local: end,
            })),
          )
          .select("id, slot_number"),
      );
      const slotIds = new Map(slots.map((s) => [s.slot_number, s.id] as const));
      const slotIdByKey = new Map(slots.map((s) => [String(s.slot_number), s.id] as const));
      games[g.code] = { id: game.id, code: g.code, slotIds };

      const stations = await must<Array<{ id: string; code: string }>>(
        `建立測試 stations（${g.code}）`,
        client
          .from("stations")
          .insert(
            g.stations.map((code, i) => ({
              game_id: game.id,
              code,
              name: `測試關${code}`,
              source_name: `測試關${code}`,
              sort_order: i + 1,
            })),
          )
          .select("id, code"),
      );
      for (const s of stations) {
        if (stationIds.has(s.code)) throw new Error(`fixture 的關卡代號重複：${s.code}`);
        stationIds.set(s.code, s.id);
      }

      const rows = g.assignments.map((x) => ({
        game_id: game.id,
        slot_id: lookup(slotIdByKey, String(x.slot), "時段"),
        station_id: lookup(stationIds, x.station, "關卡"),
        team_a_id: lookup(teamIds, x.teams[0], "隊伍"),
        team_b_id: x.teams[1] ? lookup(teamIds, x.teams[1], "隊伍") : null,
      }));
      if (rows.length > 0) {
        const inserted = await must<Array<{ id: string; slot_id: string; station_id: string }>>(
          `建立測試 assignments（${g.code}）`,
          client.from("assignments").insert(rows).select("id, slot_id, station_id"),
        );
        const slotNo = new Map(Array.from(slotIds, ([n, id]) => [id, n] as const));
        const stationCode = new Map(Array.from(stationIds, ([c, id]) => [id, c] as const));
        for (const r of inserted) assignmentIds.set(`${slotNo.get(r.slot_id)}|${stationCode.get(r.station_id)}`, r.id);
      }
    }

    // ---- identities（pin_hash 不會被用到；label 帶 runId 避免撞到唯一索引）
    const identityRows: Array<Record<string, unknown>> = [
      { role: "ADMIN", label: `DB測試總召-${runId}`, pin_hash: "db-test", station_id: null, team_id: null },
      { role: "VIEWER", label: `DB測試唯讀-${runId}`, pin_hash: "db-test", station_id: null, team_id: null },
      ...Array.from(stationIds, ([code, id]) => ({
        role: "STATION",
        label: `測試關${code}關主`,
        pin_hash: "db-test",
        station_id: id,
        team_id: null,
      })),
      ...Array.from(teamIds, ([key, id]) => ({
        role: "TEAM",
        label: `測試${key}隊隊輔`,
        pin_hash: "db-test",
        station_id: null,
        team_id: id,
      })),
    ];
    const identities = await must<Array<{ id: string; role: string; station_id: string | null; team_id: string | null }>>(
      "建立測試 identities",
      client.from("identities").insert(identityRows).select("id, role, station_id, team_id"),
    );
    let adminId = "";
    let viewerId = "";
    const stationCodeById = new Map(Array.from(stationIds, ([c, id]) => [id, c] as const));
    const teamKeyById = new Map(Array.from(teamIds, ([k, id]) => [id, k] as const));
    for (const idn of identities) {
      identityIds.push(idn.id);
      if (idn.role === "ADMIN") adminId = idn.id;
      else if (idn.role === "VIEWER") viewerId = idn.id;
      else if (idn.role === "STATION" && idn.station_id) stationIdentityIds.set(stationCodeById.get(idn.station_id)!, idn.id);
      else if (idn.role === "TEAM" && idn.team_id) teamIdentityIds.set(teamKeyById.get(idn.team_id)!, idn.id);
    }

    const createdEventId = eventId;
    return {
      runId,
      eventId: createdEventId,
      eventDate: TEST_EVENT_DATE,
      games,
      adminId,
      viewerId,
      team: (key) => lookup(teamIds, key, "隊伍"),
      teamIdentity: (key) => lookup(teamIdentityIds, key, "隊伍身分"),
      station: (code) => lookup(stationIds, code, "關卡"),
      stationIdentity: (code) => lookup(stationIdentityIds, code, "關卡身分"),
      a: (slot, station) => lookup(assignmentIds, `${slot}|${station}`, "assignment"),
      game: (code) => {
        const g = games[code];
        if (!g) throw new Error(`fixture 沒有遊戲 ${code}`);
        return g;
      },
      at: (time, speed = 1) => setAppTime(client, createdEventId, TEST_EVENT_DATE, time, speed),
      cleanup,
    };
  } catch (e) {
    // 建立到一半失敗：把已經建立的刪掉再往上丟
    await cleanup().catch((ce) => console.error("[tests/db] 建立失敗後清除也失敗", ce));
    throw e;
  }
}
