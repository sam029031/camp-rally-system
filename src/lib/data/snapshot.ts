/**
 * 遊戲快照讀取（client 與 server 共用，第二十七節「重抓完整狀態」）。
 *
 * client 端傳 anon client、server 端傳 service client，同一份程式。
 * 讀：events、games、v_slot_times、stations、teams、assignments、v_check_records、
 *     v_assignment_cancellations、v_assignment_end_overrides、schedule_adjustments、notifications。
 * 排程時間一律取自 v_slot_times（第六節），不自行計算。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Adjustment,
  AppNotification,
  Assignment,
  AssignmentRow,
  Cancellation,
  CancellationRow,
  CheckRecord,
  CheckRecordRow,
  EndOverride,
  EndOverrideRow,
  EventRow,
  GameCode,
  GameRow,
  GameSnapshot,
  NotificationRow,
  ScheduleAdjustmentRow,
  Slot,
  SlotTimeRow,
  Station,
  StationRow,
  Team,
  TeamRow,
} from "@/lib/types";
import { clockSettingsFromEventRow } from "@/lib/clock";
import { GAME_NAMES } from "@/lib/constants";

export interface RawGameSnapshot {
  event: EventRow;
  game: GameRow;
  slots: SlotTimeRow[];
  stations: StationRow[];
  teams: TeamRow[];
  assignments: AssignmentRow[];
  records: CheckRecordRow[];
  cancellations: CancellationRow[];
  endOverrides: EndOverrideRow[];
  adjustments: ScheduleAdjustmentRow[];
  notifications: NotificationRow[];
  fetchedAt: number;
}

// =====================================================================
// 正規化（純函式）
// =====================================================================

function ts(v: string, field: string): number {
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new Error(`資料格式錯誤：${field} 不是合法的時間（${v}）`);
  return ms;
}

function tsOrNull(v: string | null | undefined, field: string): number | null {
  if (v === null || v === undefined) return null;
  return ts(v, field);
}

function byNumber(a: number, b: number): number {
  return a - b;
}

function normalizeSlot(r: SlotTimeRow): Slot {
  return {
    id: r.slot_id,
    number: r.slot_number,
    scheduledStart: ts(r.scheduled_start, "v_slot_times.scheduled_start"),
    scheduledEnd: ts(r.scheduled_end, "v_slot_times.scheduled_end"),
    originalStart: ts(r.original_start, "v_slot_times.original_start"),
    originalEnd: ts(r.original_end, "v_slot_times.original_end"),
    totalOffsetMs: Number(r.total_offset_seconds ?? 0) * 1000,
  };
}

function normalizeRecord(r: CheckRecordRow): CheckRecord {
  return {
    id: r.id,
    clientRequestId: r.client_request_id,
    assignmentId: r.assignment_id,
    action: r.action,
    teamId: r.team_id,
    noShow: Boolean(r.no_show),
    singleTeamOverride: Boolean(r.single_team_override),
    confirmedTeamIds: r.confirmed_team_ids ?? null,
    recordedAt: ts(r.recorded_at, "check_records.recorded_at"),
    realCreatedAt: ts(r.real_created_at, "check_records.real_created_at"),
    identityId: r.identity_id,
    source: r.source,
    reason: r.reason ?? null,
    voidedAt: tsOrNull(r.voided_at, "check_records.voided_at"),
    voidedBy: r.voided_by ?? null,
    voidReason: r.void_reason ?? null,
    replacesRecordId: r.replaces_record_id ?? null,
  };
}

function normalizeNotification(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    kind: r.kind,
    subkind: r.subkind ?? null,
    assignmentId: r.assignment_id ?? null,
    teamId: r.team_id ?? null,
    triggerRecordId: r.trigger_record_id ?? null,
    triggerAdjustmentId: r.trigger_adjustment_id ?? null,
    triggerCancellationId: r.trigger_cancellation_id ?? null,
    triggerOverrideId: r.trigger_override_id ?? null,
    triggerPhase: r.trigger_phase ?? "CREATE",
    message: r.message,
    invalidatedAt: tsOrNull(r.invalidated_at, "notifications.invalidated_at"),
    createdAt: ts(r.created_at, "notifications.created_at"),
  };
}

/** DB rows → 推導用的 GameSnapshot（純函式，測試用） */
export function normalizeSnapshot(raw: RawGameSnapshot): GameSnapshot {
  const ev = raw.event;
  const g = raw.game;

  const slots = raw.slots.map(normalizeSlot).sort((a, b) => byNumber(a.number, b.number));
  const slotNumber = new Map(slots.map((s) => [s.id, s.number] as const));

  const stations: Station[] = raw.stations
    .map((s) => ({ id: s.id, code: s.code, name: s.name, sourceName: s.source_name, sortOrder: s.sort_order }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const stationOrder = new Map(stations.map((s) => [s.id, s.sortOrder] as const));

  const assignments: Assignment[] = raw.assignments
    .filter((a) => a.game_id === g.id)
    .map((a) => ({ id: a.id, slotId: a.slot_id, stationId: a.station_id, teamAId: a.team_a_id, teamBId: a.team_b_id }))
    .sort(
      (a, b) =>
        (slotNumber.get(a.slotId) ?? 0) - (slotNumber.get(b.slotId) ?? 0) ||
        (stationOrder.get(a.stationId) ?? 0) - (stationOrder.get(b.stationId) ?? 0),
    );

  // 本遊戲的參與隊伍 = 出現在本遊戲 assignments 的隊伍（黃金因此不含幹部隊）
  const participating = new Set<string>();
  for (const a of assignments) {
    participating.add(a.teamAId);
    if (a.teamBId) participating.add(a.teamBId);
  }
  const teams: Team[] = raw.teams
    .filter((t) => participating.has(t.id))
    .map((t) => ({ id: t.id, code: t.code, name: t.name, isStaffTeam: t.is_staff_team, sortOrder: t.sort_order }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "en", { numeric: true }));

  const records = raw.records.map(normalizeRecord).sort((a, b) => a.recordedAt - b.recordedAt || (a.id < b.id ? -1 : 1));

  const cancellations: Cancellation[] = raw.cancellations
    .map((c) => ({
      id: c.id,
      assignmentId: c.assignment_id,
      reason: c.reason,
      identityId: c.identity_id,
      createdAt: ts(c.created_at, "assignment_cancellations.created_at"),
      voidedAt: tsOrNull(c.voided_at, "assignment_cancellations.voided_at"),
      voidReason: c.void_reason ?? null,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  const endOverrides: EndOverride[] = raw.endOverrides
    .map((o) => ({
      id: o.id,
      assignmentId: o.assignment_id,
      officialEnd: ts(o.official_end, "assignment_end_overrides.official_end"),
      reason: o.reason,
      identityId: o.identity_id,
      createdAt: ts(o.created_at, "assignment_end_overrides.created_at"),
      voidedAt: tsOrNull(o.voided_at, "assignment_end_overrides.voided_at"),
      voidReason: o.void_reason ?? null,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  const adjustments: Adjustment[] = raw.adjustments
    .map((x) => ({
      id: x.id,
      fromSlotNumber: x.from_slot_number,
      offsetMs: x.offset_seconds * 1000,
      inputMode: x.input_mode,
      reason: x.reason,
      identityId: x.identity_id,
      createdAt: ts(x.created_at, "schedule_adjustments.created_at"),
      voidedAt: tsOrNull(x.voided_at, "schedule_adjustments.voided_at"),
      voidReason: x.void_reason ?? null,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);

  const notifications = raw.notifications
    .map(normalizeNotification)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  return {
    event: {
      id: ev.id,
      name: ev.name,
      eventDate: ev.event_date,
      timezone: ev.timezone,
      isActive: ev.is_active,
      clock: clockSettingsFromEventRow(ev),
      teamGroupLabel: ev.team_group_label,
      stationGroupLabel: ev.station_group_label,
      leadTitle: ev.lead_title,
    },
    game: {
      id: g.id,
      eventId: g.event_id,
      code: g.code,
      name: g.name,
      stationDurationMs: g.station_duration_seconds * 1000,
      transitionDurationMs: g.transition_duration_seconds * 1000,
      teamsPerStation: g.teams_per_station,
      endPolicy: g.end_policy,
      minPlayMs: g.min_play_seconds * 1000,
      updatedAt: g.updated_at,
    },
    slots,
    stations,
    teams,
    assignments,
    records,
    cancellations,
    endOverrides,
    adjustments,
    notifications,
    fetchedAt: raw.fetchedAt,
  };
}

// =====================================================================
// 讀取（supabase-js）
// =====================================================================

/** PostgREST 單次回傳上限（Supabase 預設 max rows = 1000）；超過就分頁讀完 */
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

function fail(what: string, error: { message: string }): never {
  throw new Error(`讀取${what}失敗：${error.message}`);
}

async function selectAll<T>(what: string, page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) fail(what, error);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** 唯一一筆 is_active = true 的活動；沒有 → null */
export async function loadActiveEvent(client: SupabaseClient): Promise<EventRow | null> {
  const { data, error } = await client.from("events").select("*").eq("is_active", true).limit(1).maybeSingle();
  if (error) fail("活動（events）", error);
  return (data as EventRow | null) ?? null;
}

async function loadEventById(client: SupabaseClient, eventId: string): Promise<EventRow | null> {
  const { data, error } = await client.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error) fail("活動（events）", error);
  return (data as EventRow | null) ?? null;
}

/**
 * 讀取一個遊戲的完整快照。
 * - `{ gameCode, eventId? }`：eventId 省略時用 active event。
 * - `{ gameId }`：直接指定遊戲（server 由 assignment → game 取得時用）。
 * 找不到活動或遊戲時 throw 中文錯誤。
 */
export async function loadGameSnapshot(
  client: SupabaseClient,
  sel: { gameCode: GameCode; eventId?: string } | { gameId: string },
): Promise<GameSnapshot> {
  let event: EventRow | null;
  let game: GameRow | null;

  if ("gameId" in sel) {
    const { data, error } = await client.from("games").select("*").eq("id", sel.gameId).maybeSingle();
    if (error) fail("遊戲（games）", error);
    game = (data as GameRow | null) ?? null;
    if (!game) throw new Error("找不到指定的遊戲，請確認排程已匯入。");
    event = await loadEventById(client, game.event_id);
    if (!event) throw new Error("找不到這個遊戲所屬的活動。");
  } else {
    event = sel.eventId ? await loadEventById(client, sel.eventId) : await loadActiveEvent(client);
    if (!event) {
      throw new Error(sel.eventId ? "找不到指定的活動。" : "目前沒有啟用中的活動，請先執行排程匯入（npm run import）。");
    }
    const { data, error } = await client
      .from("games")
      .select("*")
      .eq("event_id", event.id)
      .eq("code", sel.gameCode)
      .maybeSingle();
    if (error) fail("遊戲（games）", error);
    game = (data as GameRow | null) ?? null;
    if (!game) throw new Error(`找不到「${GAME_NAMES[sel.gameCode]}」，請確認排程已匯入。`);
  }

  const gameId = game.id;
  const [slots, stations, teams, assignments, records, cancellations, endOverrides, adjustments, notifications] =
    await Promise.all([
      selectAll<SlotTimeRow>("時段（v_slot_times）", (f, t) =>
        client.from("v_slot_times").select("*").eq("game_id", gameId).order("slot_number").range(f, t),
      ),
      selectAll<StationRow>("關卡（stations）", (f, t) =>
        client.from("stations").select("*").eq("game_id", gameId).order("sort_order").order("id").range(f, t),
      ),
      selectAll<TeamRow>("隊伍（teams）", (f, t) =>
        client.from("teams").select("*").order("sort_order").order("id").range(f, t),
      ),
      selectAll<AssignmentRow>("分配（assignments）", (f, t) =>
        client.from("assignments").select("*").eq("game_id", gameId).order("id").range(f, t),
      ),
      selectAll<CheckRecordRow>("打卡紀錄（v_check_records）", (f, t) =>
        client.from("v_check_records").select("*").eq("game_id", gameId).order("recorded_at").order("id").range(f, t),
      ),
      selectAll<CancellationRow>("關卡取消（v_assignment_cancellations）", (f, t) =>
        client.from("v_assignment_cancellations").select("*").eq("game_id", gameId).order("created_at").order("id").range(f, t),
      ),
      selectAll<EndOverrideRow>("延長紀錄（v_assignment_end_overrides）", (f, t) =>
        client.from("v_assignment_end_overrides").select("*").eq("game_id", gameId).order("created_at").order("id").range(f, t),
      ),
      selectAll<ScheduleAdjustmentRow>("排程調整（schedule_adjustments）", (f, t) =>
        client.from("schedule_adjustments").select("*").eq("game_id", gameId).order("created_at").order("id").range(f, t),
      ),
      selectAll<NotificationRow>("通知（notifications）", (f, t) =>
        client.from("notifications").select("*").eq("game_id", gameId).order("created_at").order("id").range(f, t),
      ),
    ]);

  return normalizeSnapshot({
    event,
    game,
    slots,
    stations,
    teams,
    assignments,
    records,
    cancellations,
    endOverrides,
    adjustments,
    notifications,
    // 真實時間（「資料可能過期」判斷用），不是 app 時間
    fetchedAt: Date.now(),
  });
}
