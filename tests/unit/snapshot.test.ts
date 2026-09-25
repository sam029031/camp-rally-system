/**
 * 快照讀取與正規化（src/lib/data/snapshot.ts）。
 * loadGameSnapshot 用記憶體中的假 supabase client 測（只實作用到的 query builder 方法）。
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActiveEvent, loadGameSnapshot, normalizeSnapshot, type RawGameSnapshot } from "@/lib/data/snapshot";
import type {
  AssignmentRow,
  CheckRecordRow,
  EventRow,
  GameRow,
  NotificationRow,
  SlotTimeRow,
  StationRow,
  TeamRow,
} from "@/lib/types";
import { deriveGame } from "@/lib/derive";
import { t } from "./fixtures/game";

type Row = Record<string, unknown>;

/** 極簡的 PostgREST query builder（eq / in / order / limit / range / maybeSingle） */
class FakeQuery implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;

  constructor(
    private readonly rows: Row[],
    private readonly log: string[],
    private readonly table: string,
    private readonly maxRows: number,
  ) {}

  select(cols: string): this {
    void cols;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  order(col: string): this {
    this.orders.push(col);
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rng = [from, to];
    return this;
  }

  private run(): Row[] {
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length > 0) {
      out = [...out].sort((a, b) => {
        for (const col of this.orders) {
          const x = a[col] as string | number;
          const y = b[col] as string | number;
          if (x < y) return -1;
          if (x > y) return 1;
        }
        return 0;
      });
    }
    if (this.rng) out = out.slice(this.rng[0], Math.min(this.rng[1] + 1, this.rng[0] + this.maxRows));
    else out = out.slice(0, this.maxRows);
    if (this.lim !== null) out = out.slice(0, this.lim);
    this.log.push(this.table);
    return out;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const out = this.run();
    if (out.length > 1) return { data: null, error: { message: "multiple rows" } };
    return { data: out[0] ?? null, error: null };
  }

  then<A = { data: Row[] | null; error: { message: string } | null }, B = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve({ data: this.run(), error: null }).then(onfulfilled, onrejected);
  }
}

function fakeClient(tables: Record<string, Row[]>, maxRows = 1000) {
  const log: string[] = [];
  const client = {
    from(table: string) {
      return new FakeQuery(tables[table] ?? [], log, table, maxRows);
    },
  } as unknown as SupabaseClient;
  return { client, log };
}

// ---------------------------------------------------------------------
// 測試資料（黃金，只放 2 個時段、2 個關卡）
// ---------------------------------------------------------------------

const EVENT: EventRow = {
  id: "ev1",
  name: "2026 宿營",
  event_date: "2026-10-17",
  timezone: "Asia/Taipei",
  is_active: true,
  sim_enabled: true,
  sim_speed: 10,
  sim_anchor_real: "2026-09-01T00:00:00Z",
  sim_anchor_virtual: "2026-10-17T01:08:00Z",
  team_group_label: "隊輔群",
  station_group_label: "活動組群",
  lead_title: "活動長",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const GOLD: GameRow = {
  id: "g-gold",
  event_id: "ev1",
  code: "gold",
  name: "黃金傳奇",
  station_duration_seconds: 900,
  transition_duration_seconds: 420,
  teams_per_station: 1,
  end_policy: "FULL_DURATION",
  min_play_seconds: 600,
  sort_order: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const LAND: GameRow = { ...GOLD, id: "g-land", code: "land", name: "大地遊戲", station_duration_seconds: 1200, teams_per_station: 2, end_policy: "FIXED_END", sort_order: 2 };

function slotRow(n: number, start: string, end: string, offsetSec = 0, game = GOLD): SlotTimeRow {
  const s = t(start);
  const e = t(end);
  return {
    slot_id: `${game.code}-s${n}`,
    game_id: game.id,
    event_id: "ev1",
    game_code: game.code,
    slot_number: n,
    start_local: `${start}:00`,
    end_local: `${end}:00`,
    original_start: new Date(s).toISOString(),
    original_end: new Date(e).toISOString(),
    total_offset_seconds: offsetSec,
    scheduled_start: new Date(s + offsetSec * 1000).toISOString(),
    scheduled_end: new Date(e + offsetSec * 1000).toISOString(),
  };
}

const SLOTS: SlotTimeRow[] = [slotRow(2, "09:32", "09:47", 600), slotRow(1, "09:10", "09:25")];
const STATIONS: StationRow[] = [
  { id: "st-B", game_id: "g-gold", code: "B", name: "按摩墊上的身影", source_name: "按摩墊上的身影", sort_order: 2 },
  { id: "st-A", game_id: "g-gold", code: "A", name: "九九乘法", source_name: "九九乘法", sort_order: 1 },
];
const TEAMS: TeamRow[] = [
  { id: "t-S", code: "S", name: "幹部隊", is_staff_team: true, sort_order: 14 },
  { id: "t-2", code: "2", name: "第2小隊", is_staff_team: false, sort_order: 2 },
  { id: "t-10", code: "10", name: "第10小隊", is_staff_team: false, sort_order: 10 },
  { id: "t-4", code: "4", name: "第4小隊", is_staff_team: false, sort_order: 4 },
];
const ASSIGNMENTS: AssignmentRow[] = [
  { id: "a-2B", game_id: "g-gold", slot_id: "gold-s2", station_id: "st-B", team_a_id: "t-10", team_b_id: null },
  { id: "a-1A", game_id: "g-gold", slot_id: "gold-s1", station_id: "st-A", team_a_id: "t-2", team_b_id: null },
  { id: "a-1B", game_id: "g-gold", slot_id: "gold-s1", station_id: "st-B", team_a_id: "t-4", team_b_id: null },
  { id: "a-2A", game_id: "g-gold", slot_id: "gold-s2", station_id: "st-A", team_a_id: "t-4", team_b_id: null },
];

function recordRow(id: string, action: CheckRecordRow["action"], at: string, extra: Partial<CheckRecordRow> = {}): CheckRecordRow {
  return {
    id,
    client_request_id: `c-${id}`,
    assignment_id: "a-1A",
    action,
    team_id: null,
    no_show: false,
    single_team_override: false,
    confirmed_team_ids: null,
    recorded_at: new Date(t(at)).toISOString(),
    real_created_at: "2026-09-01T00:00:00.123Z",
    identity_id: "id-1",
    source: "ui",
    reason: null,
    client_info: { ua: "test" },
    voided_at: null,
    voided_by: null,
    void_reason: null,
    replaces_record_id: null,
    game_id: "g-gold",
    slot_id: "gold-s1",
    station_id: "st-A",
    ...extra,
  };
}

const RECORDS: CheckRecordRow[] = [
  recordRow("r2", "team_check_in", "09:10:23", { team_id: "t-2" }),
  recordRow("r1", "station_check_in", "09:10:18"),
  recordRow("r0", "station_check_in", "09:09:00", { voided_at: "2026-10-17T01:09:30Z", void_reason: "SELF_UNDO" }),
];

const NOTIFS: NotificationRow[] = [
  {
    id: "n1",
    kind: "STATION_OVERTIME",
    game_id: "g-gold",
    subkind: null,
    assignment_id: "a-1A",
    team_id: null,
    trigger_record_id: "r1",
    trigger_adjustment_id: null,
    trigger_cancellation_id: null,
    trigger_override_id: null,
    trigger_phase: "CREATE",
    message: "九九乘法－第2小隊已超時",
    invalidated_at: null,
    created_at: "2026-10-17T01:25:18Z",
    real_created_at: "2026-09-01T00:00:00Z",
  },
];

function tables(extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  const base: Record<string, Row[]> = {
    events: [EVENT as unknown as Row, { ...EVENT, id: "ev-old", is_active: false } as unknown as Row],
    games: [GOLD as unknown as Row, LAND as unknown as Row],
    v_slot_times: SLOTS as unknown as Row[],
    stations: STATIONS as unknown as Row[],
    teams: TEAMS as unknown as Row[],
    assignments: ASSIGNMENTS as unknown as Row[],
    v_check_records: RECORDS as unknown as Row[],
    v_assignment_cancellations: [
      { id: "c1", assignment_id: "a-2B", reason: "下雨", identity_id: "adm", created_at: "2026-10-17T00:00:00Z", voided_at: null, voided_by: null, void_reason: null, game_id: "g-gold" },
    ],
    v_assignment_end_overrides: [],
    schedule_adjustments: [
      { id: "adj1", game_id: "g-gold", from_slot_number: 2, offset_seconds: 600, input_mode: "DELAY", reason: "晚開始", identity_id: "adm", created_at: "2026-10-17T00:30:00Z", voided_at: null, voided_by: null, void_reason: null },
    ],
    notifications: NOTIFS as unknown as Row[],
  };
  return { ...base, ...(extra as Record<string, Row[]>) };
}

describe("loadGameSnapshot", () => {
  it("依 active event + gameCode 讀取並正規化", async () => {
    const { client, log } = fakeClient(tables());
    const snap = await loadGameSnapshot(client, { gameCode: "gold" });
    expect(snap.event).toMatchObject({ id: "ev1", eventDate: "2026-10-17", leadTitle: "活動長" });
    expect(snap.event.clock).toEqual({ simEnabled: true, simSpeed: 10, simAnchorReal: Date.UTC(2026, 8, 1), simAnchorVirtual: t("09:08") });
    expect(snap.game).toMatchObject({ id: "g-gold", stationDurationMs: 900_000, transitionDurationMs: 420_000, minPlayMs: 600_000 });
    // 時段依 slot_number；時間用 Date.parse
    expect(snap.slots.map((s) => s.number)).toEqual([1, 2]);
    expect(snap.slots[1]).toMatchObject({ scheduledStart: t("09:42"), originalStart: t("09:32"), totalOffsetMs: 600_000 });
    // 關卡依 sort_order
    expect(snap.stations.map((s) => s.code)).toEqual(["A", "B"]);
    // 隊伍 = 只有本遊戲 assignments 出現的隊伍（沒有幹部隊），依 sort_order
    expect(snap.teams.map((x) => x.code)).toEqual(["2", "4", "10"]);
    // assignments 依（時段, 關卡）
    expect(snap.assignments.map((a) => a.id)).toEqual(["a-1A", "a-1B", "a-2A", "a-2B"]);
    // 紀錄含已撤銷，依 recorded_at
    expect(snap.records.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    expect(snap.records[0].voidedAt).toBe(Date.parse("2026-10-17T01:09:30Z"));
    expect(snap.records[1]).toMatchObject({ recordedAt: t("09:10:18"), realCreatedAt: Date.parse("2026-09-01T00:00:00.123Z"), teamId: null });
    expect(snap.cancellations).toHaveLength(1);
    expect(snap.adjustments[0]).toMatchObject({ offsetMs: 600_000, fromSlotNumber: 2 });
    expect(snap.notifications[0]).toMatchObject({ id: "n1", triggerRecordId: "r1", triggerPhase: "CREATE", createdAt: Date.parse("2026-10-17T01:25:18Z") });
    expect(snap.fetchedAt).toBeGreaterThan(0);
    for (const table of ["v_slot_times", "v_check_records", "v_assignment_cancellations", "v_assignment_end_overrides", "schedule_adjustments", "notifications"]) {
      expect(log).toContain(table);
    }

    // 可直接推導
    const d = deriveGame(snap, t("09:20"));
    expect(d.assignments.get("a-1A")!.state).toBe("IN_PROGRESS");
    expect(d.assignments.get("a-2B")!.state).toBe("CANCELLED");
    expect(d.activeAdjustmentLabel).toBe("第2時段起已延後 10 分鐘");
  });

  it("依 gameId 讀取", async () => {
    const { client } = fakeClient(tables({ v_slot_times: [slotRow(1, "13:05", "13:25", 0, LAND) as unknown as Row], assignments: [], v_check_records: [] }));
    const snap = await loadGameSnapshot(client, { gameId: "g-land" });
    expect(snap.game.code).toBe("land");
    expect(snap.event.id).toBe("ev1");
    expect(snap.teams).toEqual([]);
  });

  it("超過單次上限（1000 筆）時分頁讀完", async () => {
    const many: CheckRecordRow[] = [];
    for (let i = 0; i < 2345; i++) {
      many.push(
        recordRow(`m${String(i).padStart(4, "0")}`, "team_check_in", "09:11", {
          team_id: "t-2",
          voided_at: "2026-10-17T01:12:00Z",
          void_reason: "x",
        }),
      );
    }
    const { client, log } = fakeClient(tables({ v_check_records: many as unknown as Row[] }), 1000);
    const snap = await loadGameSnapshot(client, { gameCode: "gold" });
    expect(snap.records).toHaveLength(2345);
    expect(new Set(snap.records.map((r) => r.id)).size).toBe(2345);
    expect(log.filter((x) => x === "v_check_records")).toHaveLength(3);
  });

  it("沒有 active event → 清楚的中文錯誤", async () => {
    const { client } = fakeClient(tables({ events: [{ ...EVENT, is_active: false } as unknown as Row] }));
    await expect(loadGameSnapshot(client, { gameCode: "gold" })).rejects.toThrow("目前沒有啟用中的活動");
    expect(await loadActiveEvent(client)).toBeNull();
  });

  it("找不到遊戲 → 清楚的中文錯誤", async () => {
    const { client } = fakeClient(tables({ games: [GOLD as unknown as Row] }));
    await expect(loadGameSnapshot(client, { gameCode: "land" })).rejects.toThrow("找不到「大地遊戲」");
    await expect(loadGameSnapshot(client, { gameId: "nope" })).rejects.toThrow("找不到指定的遊戲");
    await expect(loadGameSnapshot(client, { gameCode: "gold", eventId: "nope" })).rejects.toThrow("找不到指定的活動");
  });

  it("查詢錯誤 → throw（不假裝成功）", async () => {
    const client = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          limit() {
            return this;
          },
          async maybeSingle() {
            return { data: null, error: { message: "permission denied" } };
          },
        };
      },
    } as unknown as SupabaseClient;
    await expect(loadActiveEvent(client)).rejects.toThrow("permission denied");
  });
});

describe("normalizeSnapshot", () => {
  it("時間格式錯誤 → throw", () => {
    const raw: RawGameSnapshot = {
      event: EVENT,
      game: GOLD,
      slots: [{ ...SLOTS[1], scheduled_start: "not-a-date" }],
      stations: STATIONS,
      teams: TEAMS,
      assignments: ASSIGNMENTS,
      records: [],
      cancellations: [],
      endOverrides: [],
      adjustments: [],
      notifications: [],
      fetchedAt: 1,
    };
    expect(() => normalizeSnapshot(raw)).toThrow("scheduled_start");
  });

  it("大地包含幹部隊（出現在 assignments 就算）", () => {
    const raw: RawGameSnapshot = {
      event: EVENT,
      game: LAND,
      slots: [slotRow(1, "13:05", "13:25", 0, LAND)],
      stations: [{ id: "ls-A", game_id: "g-land", code: "A", name: "ㄇㄉㄈㄎ", source_name: "ㄇㄉㄈㄎ", sort_order: 1 }],
      teams: TEAMS,
      assignments: [{ id: "la", game_id: "g-land", slot_id: "land-s1", station_id: "ls-A", team_a_id: "t-10", team_b_id: "t-S" }],
      records: [],
      cancellations: [],
      endOverrides: [
        { id: "o1", assignment_id: "la", official_end: "2026-10-17T05:30:00Z", reason: "延長", identity_id: null, created_at: "2026-10-17T05:00:00Z", voided_at: null, voided_by: null, void_reason: null, game_id: "g-land" },
      ],
      adjustments: [],
      notifications: [],
      fetchedAt: 1,
    };
    const snap = normalizeSnapshot(raw);
    expect(snap.teams.map((x) => x.code)).toEqual(["10", "S"]);
    expect(snap.assignments[0]).toEqual({ id: "la", slotId: "land-s1", stationId: "ls-A", teamAId: "t-10", teamBId: "t-S" });
    expect(snap.endOverrides[0].officialEnd).toBe(t("13:30"));
    expect(snap.game.teamsPerStation).toBe(2);
  });
});
