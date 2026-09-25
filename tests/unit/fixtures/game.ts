/**
 * 測試用 GameSnapshot 建構器：使用真實的黃金／大地排程矩陣（第三、四、五節，大地第4時段 B 已套用 2/4 override），
 * 活動日固定 2026-10-17（+08:00），可在指定的台北時間加入打卡紀錄、撤銷、取消、延長、整場調整與通知。
 */

import type {
  Adjustment,
  AppNotification,
  Assignment,
  Cancellation,
  CheckAction,
  CheckRecord,
  EndOverride,
  EndPolicy,
  GameCode,
  GameSnapshot,
  NotificationKind,
  RecordSource,
  Slot,
  Station,
  Team,
} from "@/lib/types";
import { GAME_DEFAULTS, OFFICIAL_SLOTS } from "@/lib/constants";
import { taipeiLocalToMs } from "@/lib/time";

export const EVENT_DATE = "2026-10-17";

/** 台北時間 'HH:mm' 或 'HH:mm:ss' → epoch ms（活動日） */
export function t(hms: string): number {
  return taipeiLocalToMs(EVENT_DATE, hms);
}

export const GOLD_STATIONS: ReadonlyArray<readonly [code: string, name: string, sourceName: string]> = [
  ["A", "九九乘法", "九九乘法"],
  ["B", "按摩墊上的身影", "按摩墊上的身影"],
  ["C", "3的倍數", "3的倍數"],
  ["D", "繩采飛揚", "繩采飛揚"],
  ["E", "下午茶極與極", "下午茶極與極"],
  ["F", "吃定你了", "吃定你了"],
  ["G", "表情包猜詞", "表情包猜詞"],
  ["H", "鐵頭功", "鐵頭功"],
  ["I", "節奏達人", "節奏達人"],
  ["J", "異口同聲", "異口同聲"],
  ["K", "跳跳36格", "跳跳36格"],
  ["L", "幾隻小鳥幾隻腳", "幾隻小鳥幾隻腳(是大地變黃金)"],
  ["M", "紅旗白旗", "紅旗白旗"],
];

/** 黃金新路線：slot 1..8 × station A..M → 小隊 */
export const GOLD_MATRIX: ReadonlyArray<ReadonlyArray<number>> = [
  [2, 4, 3, 1, 13, 12, 11, 9, 10, 8, 6, 7, 5],
  [1, 3, 2, 13, 12, 11, 10, 8, 9, 7, 5, 6, 4],
  [13, 2, 1, 12, 11, 10, 9, 7, 8, 6, 4, 5, 3],
  [12, 1, 13, 11, 10, 9, 8, 6, 7, 5, 3, 4, 2],
  [11, 13, 12, 10, 9, 8, 7, 5, 6, 4, 2, 3, 1],
  [10, 12, 11, 9, 8, 7, 6, 4, 5, 3, 1, 2, 13],
  [9, 11, 10, 8, 7, 6, 5, 3, 4, 2, 13, 1, 12],
  [8, 10, 9, 7, 6, 5, 4, 2, 3, 1, 12, 13, 11],
];

export const LAND_STATIONS: ReadonlyArray<readonly [code: string, name: string, sourceName: string]> = [
  ["A", "ㄇㄉㄈㄎ", "ㄇㄉㄈㄎ"],
  ["B", "歐北共", "歐北共"],
  ["C", "戲劇之王", "戲劇之王"],
  ["D", "(水)你坡我擋", "(水)你坡我擋"],
  ["E", "幾個人來的", "幾個人來的"],
  ["F", "就是要你濕濕(水)", "就是要你濕濕(水)"],
  ["G", "跳跳TEMPO", "跳跳TEMPO"],
  ["H", "敲敲杯(水)", "敲敲杯(水)"],
  ["I", "躲避球", "躲避球"],
  ["J", "複製人", "複製人"],
];

/** 大地新跑關：'-' = 休息；S = 幹部隊；第4時段 B 為 override 2/4 */
export const LAND_MATRIX: ReadonlyArray<ReadonlyArray<string>> = [
  ["6/8", "7/S", "4/10", "2/12", "-", "3/11", "-", "1/13", "5/9", "-"],
  ["-", "-", "7/8", "6/9", "1/2", "5/S", "3/10", "11/12", "-", "4/13"],
  ["2/13", "1/12", "3/S", "-", "4/5", "-", "8/9", "-", "10/11", "6/7"],
  ["1/9", "2/4", "-", "5/10", "-", "6/13", "-", "3/7", "12/S", "8/11"],
  ["5/12", "-", "1/6", "7/13", "3/8", "4/9", "2/11", "10/S", "-", "-"],
  ["-", "6/11", "5/13", "-", "9/S", "7/10", "4/12", "-", "2/8", "1/3"],
  ["3/4", "8/13", "-", "1/S", "7/11", "-", "5/6", "2/9", "-", "10/12"],
  ["-", "9/10", "-", "4/11", "6/12", "-", "1/7", "5/8", "3/13", "2/S"],
];

export function teamId(code: number | string): string {
  return `team-${code}`;
}
export function stationId(game: GameCode, code: string): string {
  return `${game}-st-${code}`;
}
export function slotId(game: GameCode, n: number): string {
  return `${game}-slot-${n}`;
}
export function assignmentId(game: GameCode, slot: number, station: string): string {
  return `${game}-${slot}-${station}`;
}

function makeTeam(code: string): Team {
  const staff = code === "S";
  return {
    id: teamId(code),
    code,
    name: staff ? "幹部隊" : `第${code}小隊`,
    isStaffTeam: staff,
    sortOrder: staff ? 14 : Number(code),
  };
}

export interface RecordOpts {
  team?: number | string;
  noShow?: boolean;
  id?: string;
  source?: RecordSource;
  singleTeamOverride?: boolean;
  confirmedTeamIds?: string[] | null;
  identityId?: string | null;
}

export interface BuilderOpts {
  endPolicy?: EndPolicy;
  minPlaySeconds?: number;
}

export class SnapshotBuilder {
  readonly game: GameCode;
  private readonly opts: BuilderOpts;
  private readonly stations: Station[];
  private readonly assignments: Assignment[] = [];
  private readonly teams: Team[];
  private readonly records: CheckRecord[] = [];
  private readonly cancellations: Cancellation[] = [];
  private readonly overrides: EndOverride[] = [];
  private readonly adjustments: Adjustment[] = [];
  private readonly notifications: AppNotification[] = [];
  private seq = 0;

  constructor(game: GameCode, opts: BuilderOpts = {}) {
    this.game = game;
    this.opts = opts;
    const defs = game === "gold" ? GOLD_STATIONS : LAND_STATIONS;
    this.stations = defs.map(([code, name, sourceName], i) => ({
      id: stationId(game, code),
      code,
      name,
      sourceName,
      sortOrder: i + 1,
    }));
    const teamCodes = new Set<string>();
    if (game === "gold") {
      GOLD_MATRIX.forEach((row, si) =>
        row.forEach((team, ci) => {
          const code = this.stations[ci].code;
          teamCodes.add(String(team));
          this.assignments.push({
            id: assignmentId(game, si + 1, code),
            slotId: slotId(game, si + 1),
            stationId: stationId(game, code),
            teamAId: teamId(team),
            teamBId: null,
          });
        }),
      );
    } else {
      LAND_MATRIX.forEach((row, si) =>
        row.forEach((cell, ci) => {
          if (cell === "-") return;
          const [a, b] = cell.split("/");
          const code = this.stations[ci].code;
          teamCodes.add(a);
          teamCodes.add(b);
          this.assignments.push({
            id: assignmentId(game, si + 1, code),
            slotId: slotId(game, si + 1),
            stationId: stationId(game, code),
            teamAId: teamId(a),
            teamBId: teamId(b),
          });
        }),
      );
    }
    this.teams = [...teamCodes].map(makeTeam).sort((x, y) => x.sortOrder - y.sortOrder);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  /** 取得 assignment id；該格是休息時 throw（避免測試寫錯） */
  aid(slot: number, station: string): string {
    const id = assignmentId(this.game, slot, station);
    if (!this.assignments.some((a) => a.id === id)) {
      throw new Error(`fixture：${this.game} 第${slot}時段 ${station} 沒有 assignment（休息）`);
    }
    return id;
  }

  record(action: CheckAction, slot: number, station: string, time: string, opts: RecordOpts = {}): string {
    const isTeamSide = action === "team_check_in" || action === "team_check_out";
    if (isTeamSide && opts.team === undefined) throw new Error("fixture：隊輔側紀錄需要 team");
    const id = opts.id ?? this.nextId("rec");
    const at = t(time);
    this.records.push({
      id,
      clientRequestId: `crid-${id}`,
      assignmentId: this.aid(slot, station),
      action,
      teamId: isTeamSide ? teamId(opts.team!) : null,
      noShow: opts.noShow ?? false,
      singleTeamOverride: opts.singleTeamOverride ?? false,
      confirmedTeamIds: opts.confirmedTeamIds ?? null,
      recordedAt: at,
      realCreatedAt: at,
      identityId: opts.identityId ?? "identity-1",
      source: opts.source ?? "ui",
      reason: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      replacesRecordId: null,
    });
    return id;
  }

  stationIn(slot: number, station: string, time: string, opts: RecordOpts = {}): string {
    return this.record("station_check_in", slot, station, time, opts);
  }
  stationOut(slot: number, station: string, time: string, opts: RecordOpts = {}): string {
    return this.record("station_check_out", slot, station, time, opts);
  }
  teamIn(slot: number, station: string, team: number | string, time: string): string {
    return this.record("team_check_in", slot, station, time, { team });
  }
  teamOut(slot: number, station: string, team: number | string, time: string): string {
    return this.record("team_check_out", slot, station, time, { team });
  }

  /** 撤銷一筆紀錄 */
  voidRecord(id: string, time = "12:00", reason = "SELF_UNDO"): this {
    const r = this.records.find((x) => x.id === id);
    if (!r) throw new Error(`fixture：找不到紀錄 ${id}`);
    r.voidedAt = t(time);
    r.voidReason = reason;
    return this;
  }

  /** 管理員修正時間：撤銷原紀錄＋新增 admin_correction */
  correctRecord(id: string, newTime: string): string {
    const r = this.records.find((x) => x.id === id);
    if (!r) throw new Error(`fixture：找不到紀錄 ${id}`);
    r.voidedAt = t("12:30");
    r.voidReason = "修正時間";
    const nid = this.nextId("rec");
    this.records.push({
      ...r,
      id: nid,
      clientRequestId: `crid-${nid}`,
      recordedAt: t(newTime),
      source: "admin_correction",
      voidedAt: null,
      voidReason: null,
      replacesRecordId: r.id,
    });
    return nid;
  }

  cancel(slot: number, station: string, reason = "下雨"): string {
    const id = this.nextId("cancel");
    this.cancellations.push({
      id,
      assignmentId: this.aid(slot, station),
      reason,
      identityId: "admin",
      createdAt: t("08:00"),
      voidedAt: null,
      voidReason: null,
    });
    return id;
  }

  voidCancellation(id: string): this {
    const c = this.cancellations.find((x) => x.id === id);
    if (!c) throw new Error(`fixture：找不到取消 ${id}`);
    c.voidedAt = t("08:30");
    c.voidReason = "撤銷取消";
    return this;
  }

  override(slot: number, station: string, officialEnd: string): string {
    const id = this.nextId("ovr");
    // 同一場只能有一筆有效 override：先撤銷舊的
    const aid = this.aid(slot, station);
    for (const o of this.overrides) if (o.assignmentId === aid && o.voidedAt === null) o.voidedAt = t("08:00");
    this.overrides.push({
      id,
      assignmentId: aid,
      officialEnd: t(officialEnd),
      reason: "延長",
      identityId: "admin",
      createdAt: t("08:00") + this.seq,
      voidedAt: null,
      voidReason: null,
    });
    return id;
  }

  voidOverride(id: string): this {
    const o = this.overrides.find((x) => x.id === id);
    if (!o) throw new Error(`fixture：找不到延長 ${id}`);
    o.voidedAt = t("08:30");
    o.voidReason = "撤銷延長";
    return this;
  }

  /** 從第 k 時段起延後（正）／提前（負）N 分鐘 */
  adjust(fromSlot: number, minutes: number): string {
    const id = this.nextId("adj");
    this.adjustments.push({
      id,
      fromSlotNumber: fromSlot,
      offsetMs: minutes * 60_000,
      inputMode: "DELAY",
      reason: "測試",
      identityId: "admin",
      createdAt: t("08:00") + this.seq,
      voidedAt: null,
      voidReason: null,
    });
    return id;
  }

  voidAdjustment(id: string): this {
    const a = this.adjustments.find((x) => x.id === id);
    if (!a) throw new Error(`fixture：找不到調整 ${id}`);
    a.voidedAt = t("08:30");
    a.voidReason = "撤銷";
    return this;
  }

  notify(n: {
    kind: NotificationKind;
    subkind?: string | null;
    assignmentId?: string | null;
    teamId?: string | null;
    triggerRecordId?: string | null;
    triggerOverrideId?: string | null;
    createdAt?: string;
  }): string {
    const id = this.nextId("ntf");
    this.notifications.push({
      id,
      kind: n.kind,
      subkind: n.subkind ?? null,
      assignmentId: n.assignmentId ?? null,
      teamId: n.teamId ?? null,
      triggerRecordId: n.triggerRecordId ?? null,
      triggerAdjustmentId: null,
      triggerCancellationId: null,
      triggerOverrideId: n.triggerOverrideId ?? null,
      triggerPhase: "CREATE",
      message: "測試通知",
      invalidatedAt: null,
      createdAt: t(n.createdAt ?? "09:00"),
    });
    return id;
  }

  /** 依 v_slot_times 的規則算有效時間：原定 + 所有未撤銷且 from_slot_number <= 本時段的 offset 總和 */
  private slots(): Slot[] {
    return OFFICIAL_SLOTS[this.game].map(([start, end], i) => {
      const n = i + 1;
      const offset = this.adjustments
        .filter((a) => a.voidedAt === null && a.fromSlotNumber <= n)
        .reduce((sum, a) => sum + a.offsetMs, 0);
      const originalStart = t(start);
      const originalEnd = t(end);
      return {
        id: slotId(this.game, n),
        number: n,
        scheduledStart: originalStart + offset,
        scheduledEnd: originalEnd + offset,
        originalStart,
        originalEnd,
        totalOffsetMs: offset,
      };
    });
  }

  build(): GameSnapshot {
    const d = GAME_DEFAULTS[this.game];
    return {
      event: {
        id: "event-1",
        name: "測試宿營",
        eventDate: EVENT_DATE,
        timezone: "Asia/Taipei",
        isActive: true,
        clock: { simEnabled: false, simSpeed: 1, simAnchorReal: null, simAnchorVirtual: null },
        teamGroupLabel: "隊輔群",
        stationGroupLabel: "活動組群",
        leadTitle: "活動長",
      },
      game: {
        id: `game-${this.game}`,
        eventId: "event-1",
        code: this.game,
        name: d.name,
        stationDurationMs: d.stationDurationSeconds * 1000,
        transitionDurationMs: d.transitionDurationSeconds * 1000,
        teamsPerStation: d.teamsPerStation,
        endPolicy: this.opts.endPolicy ?? d.endPolicy,
        minPlayMs: (this.opts.minPlaySeconds ?? d.minPlaySeconds) * 1000,
        updatedAt: "2026-10-01T00:00:00Z",
      },
      slots: this.slots(),
      stations: this.stations.map((s) => ({ ...s })),
      teams: this.teams.map((x) => ({ ...x })),
      assignments: this.assignments.map((a) => ({ ...a })),
      records: this.records.map((r) => ({ ...r })),
      cancellations: this.cancellations.map((c) => ({ ...c })),
      endOverrides: this.overrides.map((o) => ({ ...o })),
      adjustments: this.adjustments.map((a) => ({ ...a })),
      notifications: [...this.notifications].sort((a, b) => a.createdAt - b.createdAt).map((n) => ({ ...n })),
      fetchedAt: 0,
    };
  }
}

export function gold(opts?: BuilderOpts): SnapshotBuilder {
  return new SnapshotBuilder("gold", opts);
}
export function land(opts?: BuilderOpts): SnapshotBuilder {
  return new SnapshotBuilder("land", opts);
}

/** 該隊路線（station code，依時段，含被取消的） */
export function routeCodes(snap: GameSnapshot, team: number | string): string[] {
  const tid = teamId(team);
  const slotNo = new Map(snap.slots.map((s) => [s.id, s.number] as const));
  const code = new Map(snap.stations.map((s) => [s.id, s.code] as const));
  return snap.assignments
    .filter((a) => a.teamAId === tid || a.teamBId === tid)
    .sort((a, b) => slotNo.get(a.slotId)! - slotNo.get(b.slotId)!)
    .map((a) => code.get(a.stationId)!);
}
