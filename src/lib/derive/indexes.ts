/**
 * 推導用索引（每個 snapshot 建一次）。
 *
 * deriveGame 在手機上每秒呼叫一次（約 100 個 assignment、幾百筆紀錄），
 * 所以把「依 assignment 分組的有效紀錄」「依關卡／隊伍排序的 assignment」等先建成 Map。
 * GameSnapshot 視為不可變（每次重抓都是新的物件），因此以 WeakMap 快取；
 * 同一份快照每秒重算時不必重建索引。
 */

import type {
  Assignment,
  Cancellation,
  CheckRecord,
  EndOverride,
  GameSnapshot,
  Slot,
  Station,
  Team,
} from "@/lib/types";

/** 單一 assignment 上的有效紀錄（voidedAt === null） */
export interface AssignmentRecords {
  stationCheckIn: CheckRecord | null;
  stationCheckOut: CheckRecord | null;
  /** teamId → 該隊隊輔進關 */
  teamCheckIn: Map<string, CheckRecord>;
  /** teamId → 該隊隊輔出關 */
  teamCheckOut: Map<string, CheckRecord>;
}

export interface GameIndex {
  slotById: Map<string, Slot>;
  slotByNumber: Map<number, Slot>;
  /** 依 number 排序 */
  orderedSlots: Slot[];
  stationById: Map<string, Station>;
  teamById: Map<string, Team>;
  assignmentById: Map<string, Assignment>;
  /** 依（時段編號, 關卡排序）排序 */
  orderedAssignments: Assignment[];
  /** key = `${slotId}|${stationId}` */
  assignmentBySlotStation: Map<string, Assignment>;
  /** 關卡 → 該關所有 assignment（依時段，含被取消的） */
  byStation: Map<string, Assignment[]>;
  /** 隊伍 → 該隊所有 assignment（依時段，含被取消的） */
  byTeam: Map<string, Assignment[]>;
  /** assignment → 有效紀錄 */
  records: Map<string, AssignmentRecords>;
  /** 所有紀錄（含已撤銷） */
  recordById: Map<string, CheckRecord>;
  /** assignment → 有效取消 */
  cancellation: Map<string, Cancellation>;
  /** assignment → 有效 end override */
  endOverride: Map<string, EndOverride>;
}

const EMPTY_RECORDS: AssignmentRecords = Object.freeze({
  stationCheckIn: null,
  stationCheckOut: null,
  teamCheckIn: new Map<string, CheckRecord>(),
  teamCheckOut: new Map<string, CheckRecord>(),
}) as AssignmentRecords;

const cache = new WeakMap<GameSnapshot, GameIndex>();

/** 黃金 1 隊；大地 [team_a, team_b] */
export function teamIdsOf(a: Assignment): string[] {
  return a.teamBId ? [a.teamAId, a.teamBId] : [a.teamAId];
}

/** 同一 (assignment, action, team) 理論上只有一筆有效（DB 保證）；萬一有多筆，取最早的一筆，結果仍是確定的 */
function pickEarlier(existing: CheckRecord | null | undefined, candidate: CheckRecord): CheckRecord {
  if (!existing) return candidate;
  if (candidate.recordedAt < existing.recordedAt) return candidate;
  if (candidate.recordedAt === existing.recordedAt && candidate.id < existing.id) return candidate;
  return existing;
}

export function buildIndex(snap: GameSnapshot): GameIndex {
  const slotById = new Map<string, Slot>();
  const slotByNumber = new Map<number, Slot>();
  for (const s of snap.slots) {
    slotById.set(s.id, s);
    slotByNumber.set(s.number, s);
  }
  const orderedSlots = [...snap.slots].sort((a, b) => a.number - b.number);

  const stationById = new Map<string, Station>();
  for (const st of snap.stations) stationById.set(st.id, st);
  const teamById = new Map<string, Team>();
  for (const t of snap.teams) teamById.set(t.id, t);

  const assignmentById = new Map<string, Assignment>();
  const assignmentBySlotStation = new Map<string, Assignment>();
  const valid: Assignment[] = [];
  for (const a of snap.assignments) {
    if (!slotById.has(a.slotId) || !stationById.has(a.stationId)) continue;
    assignmentById.set(a.id, a);
    assignmentBySlotStation.set(`${a.slotId}|${a.stationId}`, a);
    valid.push(a);
  }
  const orderedAssignments = valid.sort((x, y) => {
    const sx = slotById.get(x.slotId)!.number;
    const sy = slotById.get(y.slotId)!.number;
    if (sx !== sy) return sx - sy;
    const ox = stationById.get(x.stationId)!.sortOrder;
    const oy = stationById.get(y.stationId)!.sortOrder;
    if (ox !== oy) return ox - oy;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });

  const byStation = new Map<string, Assignment[]>();
  const byTeam = new Map<string, Assignment[]>();
  for (const a of orderedAssignments) {
    let sl = byStation.get(a.stationId);
    if (!sl) byStation.set(a.stationId, (sl = []));
    sl.push(a);
    for (const tid of teamIdsOf(a)) {
      let tl = byTeam.get(tid);
      if (!tl) byTeam.set(tid, (tl = []));
      tl.push(a);
    }
  }

  const records = new Map<string, AssignmentRecords>();
  const recordById = new Map<string, CheckRecord>();
  for (const r of snap.records) {
    recordById.set(r.id, r);
    if (r.voidedAt !== null) continue;
    if (!assignmentById.has(r.assignmentId)) continue;
    let ar = records.get(r.assignmentId);
    if (!ar) {
      ar = { stationCheckIn: null, stationCheckOut: null, teamCheckIn: new Map(), teamCheckOut: new Map() };
      records.set(r.assignmentId, ar);
    }
    switch (r.action) {
      case "station_check_in":
        ar.stationCheckIn = pickEarlier(ar.stationCheckIn, r);
        break;
      case "station_check_out":
        ar.stationCheckOut = pickEarlier(ar.stationCheckOut, r);
        break;
      case "team_check_in":
        if (r.teamId) ar.teamCheckIn.set(r.teamId, pickEarlier(ar.teamCheckIn.get(r.teamId), r));
        break;
      case "team_check_out":
        if (r.teamId) ar.teamCheckOut.set(r.teamId, pickEarlier(ar.teamCheckOut.get(r.teamId), r));
        break;
    }
  }

  const cancellation = new Map<string, Cancellation>();
  for (const c of snap.cancellations) {
    if (c.voidedAt !== null) continue;
    const prev = cancellation.get(c.assignmentId);
    if (!prev || c.createdAt > prev.createdAt) cancellation.set(c.assignmentId, c);
  }
  const endOverride = new Map<string, EndOverride>();
  for (const o of snap.endOverrides) {
    if (o.voidedAt !== null) continue;
    const prev = endOverride.get(o.assignmentId);
    if (!prev || o.createdAt > prev.createdAt) endOverride.set(o.assignmentId, o);
  }

  return {
    slotById,
    slotByNumber,
    orderedSlots,
    stationById,
    teamById,
    assignmentById,
    orderedAssignments,
    assignmentBySlotStation,
    byStation,
    byTeam,
    records,
    recordById,
    cancellation,
    endOverride,
  };
}

/** 取得（或建立並快取）快照的索引 */
export function getIndex(snap: GameSnapshot): GameIndex {
  let idx = cache.get(snap);
  if (!idx) {
    idx = buildIndex(snap);
    cache.set(snap, idx);
  }
  return idx;
}

export function recordsOf(idx: GameIndex, assignmentId: string): AssignmentRecords {
  return idx.records.get(assignmentId) ?? EMPTY_RECORDS;
}

/** 該隊在此 assignment 的抵達紀錄 = team_check_in 或 station_check_in 取最早（第九節） */
export function arrivalRecord(recs: AssignmentRecords, teamId: string): CheckRecord | null {
  const tci = recs.teamCheckIn.get(teamId) ?? null;
  const sci = recs.stationCheckIn;
  if (tci && sci) return tci.recordedAt <= sci.recordedAt ? tci : sci;
  return tci ?? sci;
}

/** 「該隊的有效紀錄」：該隊隊輔側紀錄 + 本 assignment 的關主側紀錄（第十節 B） */
export function hasTeamRecord(recs: AssignmentRecords, teamId: string): boolean {
  return (
    recs.stationCheckIn !== null ||
    recs.stationCheckOut !== null ||
    recs.teamCheckIn.has(teamId) ||
    recs.teamCheckOut.has(teamId)
  );
}
