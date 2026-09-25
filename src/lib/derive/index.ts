/**
 * 狀態推導（第十節）。
 *
 * 狀態 = f(有效打卡紀錄, 排程時間（含延後）, 有效取消, 有效 end override, now)
 *
 * Dashboard、關主頁、隊輔頁、小隊視角、server（/api/notifications/check、通知失效判斷）
 * 全部呼叫這裡，不得各自計算。純函式、確定性（同一份快照＋同一個 now → 同樣結果）。
 * 規則細節見 docs/ARCHITECTURE.md 第 3 節第 1～15 點。
 */

import type { AppNotification, Assignment, CheckRecord, GameSnapshot, NotificationKind, Slot } from "@/lib/types";
import type {
  ArrivedDetail,
  AssignmentDerived,
  AssignmentTeamSide,
  CurrentSlotInfo,
  DerivedGame,
  GridCell,
  NotificationCondition,
  SecondaryTag,
  SecondaryTagKind,
  StationRowView,
  StationSlotState,
  TeamDerived,
  TeamState,
} from "@/lib/derive/types";
import {
  CHECKOUT_DIFF_THRESHOLD_MS,
  ENDING_SOON_MS,
  STATION_NOT_STARTED_MS,
  TEAM_CHECK_IN_GRACE_MS,
  TEAM_CHECK_OUT_GRACE_MS,
  TEAM_OUT_STATION_NOT_OUT_GRACE_MS,
  TRANSITION_WARNING_MS,
} from "@/lib/constants";
import { PREV_NOT_CHECKED_IN_LABEL, SECONDARY_TAG_LABEL } from "@/lib/labels";
import { formatDurationText } from "@/lib/time";
import {
  arrivalRecord,
  getIndex,
  hasTeamRecord,
  recordsOf,
  teamIdsOf,
  type GameIndex,
} from "@/lib/derive/indexes";
import { computeStationTiming, transitionDeadline } from "@/lib/derive/timing";
import { buildStationRows, computeSummary } from "@/lib/derive/rows";

export type * from "@/lib/derive/types";
export { getIndex, teamIdsOf, arrivalRecord } from "@/lib/derive/indexes";
export { computeStationTiming, transitionDeadline } from "@/lib/derive/timing";

/** 次要標籤的固定顯示順序（確定性） */
const TAG_ORDER: Record<SecondaryTagKind, number> = {
  PREV_NOT_CHECKED_OUT: 0,
  TEAM_OUT_STATION_NOT_OUT: 1,
  TEAM_CHECK_IN_MISSING: 2,
  CHECKOUT_TIME_DIFF: 3,
  TEAM_NOT_CHECKED_IN: 4,
  TEAM_NOT_CHECKED_OUT: 5,
};

// =====================================================================
// 目前時段（第十一節）
// =====================================================================

/**
 * 目前時段 k：
 * - now < 第1時段開始 → BEFORE_START，k = 1
 * - 時段進行中 → IN_SLOT
 * - 兩個時段之間 → TRANSITION（歸屬下一個時段）
 * - 最後時段結束後 → ENDED（k = 最後一個）
 */
export function computeCurrentSlot(slots: Slot[], now: number): CurrentSlotInfo {
  const ordered = [...slots].sort((a, b) => a.number - b.number);
  if (ordered.length === 0) throw new Error("本遊戲沒有任何時段資料，請先匯入排程。");
  const first = ordered[0];
  if (now < first.scheduledStart) {
    return { phase: "BEFORE_START", slotNumber: first.number, slot: first, remainingMs: first.scheduledStart - now };
  }
  for (const s of ordered) {
    if (now >= s.scheduledStart && now < s.scheduledEnd) {
      return { phase: "IN_SLOT", slotNumber: s.number, slot: s, remainingMs: s.scheduledEnd - now };
    }
  }
  for (const s of ordered) {
    if (s.scheduledStart > now) {
      return { phase: "TRANSITION", slotNumber: s.number, slot: s, remainingMs: s.scheduledStart - now };
    }
  }
  const last = ordered[ordered.length - 1];
  return { phase: "ENDED", slotNumber: last.number, slot: last, remainingMs: null };
}

// =====================================================================
// A. 關卡時段狀態
// =====================================================================

function stationSlotState(
  cancelled: boolean,
  stationCheckIn: CheckRecord | null,
  stationCheckOut: CheckRecord | null,
  anyTeamCheckIn: boolean,
  startedAt: number | null,
  officialEnd: number | null,
  now: number,
): Exclude<StationSlotState, "REST"> {
  if (cancelled) return "CANCELLED";
  if (stationCheckOut) return "CHECKED_OUT";
  if (stationCheckIn && startedAt !== null && officialEnd !== null) {
    if (now < startedAt) return "READY";
    const remaining = officialEnd - now;
    if (remaining > ENDING_SOON_MS) return "IN_PROGRESS";
    if (remaining > 0) return "ENDING_SOON";
    return "OVERTIME";
  }
  if (anyTeamCheckIn) return "READY";
  return "WAITING";
}

function makeTag(
  kind: SecondaryTagKind,
  assignmentId: string,
  teamId: string,
  triggerRecordId: string | null,
  notify: boolean,
  label?: string,
): SecondaryTag {
  return { kind, assignmentId, teamId, label: label ?? SECONDARY_TAG_LABEL[kind], triggerRecordId, notify };
}

/** 第十節 C 的次要標籤（PREV_NOT_CHECKED_OUT 除外，那個要看小隊路線，在小隊推導時加入） */
function recordTagsForTeam(
  ad: AssignmentDerived,
  side: AssignmentTeamSide,
  now: number,
): SecondaryTag[] {
  const tags: SecondaryTag[] = [];
  const aid = ad.assignment.id;
  const tid = side.teamId;
  const sci = ad.stationCheckIn;
  const sco = ad.stationCheckOut;
  const tci = side.teamCheckIn;
  const tco = side.teamCheckOut;

  // 隊輔未確認進關：計時已開始 90 秒，該隊隊輔仍未按進關
  if (sci && ad.startedAt !== null && now >= ad.startedAt + TEAM_CHECK_IN_GRACE_MS && !tci) {
    tags.push(makeTag("TEAM_NOT_CHECKED_IN", aid, tid, sci.id, true));
  }
  // 隊輔未確認出關：關主出關 90 秒後，隊輔仍未按出關
  if (sco && !sco.noShow && now >= sco.recordedAt + TEAM_CHECK_OUT_GRACE_MS && !tco) {
    tags.push(makeTag("TEAM_NOT_CHECKED_OUT", aid, tid, sco.id, true));
  }
  // 隊輔已出關，關主未出關：標籤立即顯示；通知有 15 秒寬限（自訂決策）
  if (tco && !sco) {
    tags.push(
      makeTag("TEAM_OUT_STATION_NOT_OUT", aid, tid, tco.id, now >= tco.recordedAt + TEAM_OUT_STATION_NOT_OUT_GRACE_MS),
    );
  }
  // 紀錄不一致：兩邊都有出關且時間差 > 60 秒
  if (tco && sco && Math.abs(tco.recordedAt - sco.recordedAt) > CHECKOUT_DIFF_THRESHOLD_MS) {
    const diff = Math.abs(tco.recordedAt - sco.recordedAt);
    tags.push(
      makeTag(
        "CHECKOUT_TIME_DIFF",
        aid,
        tid,
        tco.id,
        true,
        `${SECONDARY_TAG_LABEL.CHECKOUT_TIME_DIFF}（出關相差 ${formatDurationText(diff)}）`,
      ),
    );
  }
  // 隊輔漏按進關：有隊輔出關、沒有隊輔進關
  if (tco && !tci) {
    tags.push(makeTag("TEAM_CHECK_IN_MISSING", aid, tid, tco.id, true));
  }
  return tags;
}

function deriveAssignment(
  snap: GameSnapshot,
  idx: GameIndex,
  a: Assignment,
  now: number,
): AssignmentDerived {
  const slot = idx.slotById.get(a.slotId)!;
  const station = idx.stationById.get(a.stationId)!;
  const recs = recordsOf(idx, a.id);
  const cancellation = idx.cancellation.get(a.id) ?? null;
  const endOverride = idx.endOverride.get(a.id) ?? null;
  const teamIds = teamIdsOf(a);
  const sci = recs.stationCheckIn;
  const sco = recs.stationCheckOut;

  const timing = sci ? computeStationTiming(snap.game, slot, sci, endOverride) : null;
  const startedAt = timing?.startedAt ?? null;
  const officialEnd = timing?.officialEnd ?? null;

  const sides: AssignmentTeamSide[] = teamIds.map((teamId) => {
    const arrival = arrivalRecord(recs, teamId);
    return {
      teamId,
      teamCheckIn: recs.teamCheckIn.get(teamId) ?? null,
      teamCheckOut: recs.teamCheckOut.get(teamId) ?? null,
      arrivedAt: arrival ? arrival.recordedAt : null,
      // 小隊推導完成後回填
      teamState: "WAITING" as TeamState,
    };
  });
  const anyTeamCheckIn = sides.some((s) => s.teamCheckIn !== null);
  const allTeamsReported = sides.every((s) => s.teamCheckIn !== null);

  const state = stationSlotState(cancellation !== null, sci, sco, anyTeamCheckIn, startedAt, officialEnd, now);
  const running = state === "IN_PROGRESS" || state === "ENDING_SOON" || state === "OVERTIME";

  const ad: AssignmentDerived = {
    assignment: a,
    slot,
    station,
    teamIds,
    state,
    cancellation,
    endOverride,
    stationCheckIn: sci,
    stationCheckOut: sco,
    sides,
    noShow: sco?.noShow === true,
    singleTeamStart: sci?.singleTeamOverride === true,
    startedAt,
    officialEnd,
    playableMs: timing?.playableMs ?? null,
    shortenedMs: timing?.shortenedMs ?? null,
    insufficientTime: timing?.insufficientTime ?? false,
    remainingMs: running && officialEnd !== null ? officialEnd - now : null,
    untilStartMs: state === "READY" && sci && startedAt !== null && now < startedAt ? startedAt - now : null,
    deltaVsScheduledMs: startedAt !== null ? startedAt - slot.scheduledStart : null,
    prevAssignmentId: null,
    nextAssignmentId: null,
    queueBlocked: false,
    allTeamsReported,
    tags: [],
  };

  // 次要標籤：CANCELLED 與 no_show 的 assignment 不算
  if (!cancellation && !ad.noShow) {
    for (const side of sides) ad.tags.push(...recordTagsForTeam(ad, side, now));
  }
  return ad;
}

/** 同一關卡依時段的上一個／下一個 assignment（跳過休息時段與被取消的），以及 queueBlocked */
function linkNeighbors(idx: GameIndex, assignments: Map<string, AssignmentDerived>): void {
  for (const list of idx.byStation.values()) {
    let prevActive: Assignment | null = null;
    for (const a of list) {
      const ad = assignments.get(a.id)!;
      ad.prevAssignmentId = prevActive ? prevActive.id : null;
      ad.queueBlocked = prevActive !== null && recordsOf(idx, prevActive.id).stationCheckOut === null;
      if (!idx.cancellation.has(a.id)) prevActive = a;
    }
    let nextActive: Assignment | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      assignments.get(a.id)!.nextAssignmentId = nextActive ? nextActive.id : null;
      if (!idx.cancellation.has(a.id)) nextActive = a;
    }
  }
}

// =====================================================================
// B. 小隊狀態
// =====================================================================

function slotNumberOf(idx: GameIndex, a: Assignment): number {
  return idx.slotById.get(a.slotId)!.number;
}

function cancelledBetween(idx: GameIndex, cancelled: Assignment[], afterSlot: number, beforeSlot: number): string[] {
  const out: string[] = [];
  for (const c of cancelled) {
    const n = slotNumberOf(idx, c);
    if (n > afterSlot && n < beforeSlot) out.push(c.id);
  }
  return out;
}

function deriveTeam(
  snap: GameSnapshot,
  idx: GameIndex,
  teamId: string,
  assignments: Map<string, AssignmentDerived>,
  now: number,
): TeamDerived {
  const team = idx.teamById.get(teamId)!;
  const all = idx.byTeam.get(teamId) ?? [];
  // 小隊路線排除被取消的 assignment（第九節、自訂決策 7）
  const route: Assignment[] = [];
  const cancelled: Assignment[] = [];
  for (const a of all) (idx.cancellation.has(a.id) ? cancelled : route).push(a);

  const base: TeamDerived = {
    team,
    state: "COMPLETED",
    arrivedDetail: null,
    routeAssignmentIds: route.map((a) => a.id),
    cancelledAssignmentIds: cancelled.map((a) => a.id),
    lastAssignmentId: null,
    currentAssignmentId: null,
    previousCheckOut: null,
    previousAssignmentId: null,
    deadline: null,
    transitionRemainingMs: null,
    transitionWarning: false,
    overdueFirstStation: false,
    skippedCancelledAssignmentIds: [],
    arrivedAt: null,
  };

  // 未出關（隊伍已到下一關）：X 沒有有效關主出關，但 X 之後已有抵達紀錄。
  // trigger = X 之後第一個有抵達紀錄的 assignment 上最早那筆抵達紀錄。
  let laterArrival: CheckRecord | null = null;
  for (let i = route.length - 1; i >= 0; i--) {
    const x = route[i];
    const recs = recordsOf(idx, x.id);
    if (laterArrival && !recs.stationCheckOut) {
      const label = recs.stationCheckIn ? SECONDARY_TAG_LABEL.PREV_NOT_CHECKED_OUT : PREV_NOT_CHECKED_IN_LABEL;
      assignments.get(x.id)!.tags.push(makeTag("PREV_NOT_CHECKED_OUT", x.id, teamId, laterArrival.id, true, label));
    }
    const arr = arrivalRecord(recs, teamId);
    if (arr) laterArrival = arr;
  }

  if (route.length === 0) {
    // 全部被取消（或本遊戲沒有此隊的場次）：沒有要去的關卡
    return base;
  }

  // last = 路線中最後一個有「該隊有效紀錄」的 assignment
  let lastIdx = -1;
  for (let i = 0; i < route.length; i++) {
    if (hasTeamRecord(recordsOf(idx, route[i].id), teamId)) lastIdx = i;
  }

  const toTarget = (targetIdx: number, prevCheckOut: CheckRecord | null, prev: Assignment | null): TeamDerived => {
    const target = route[targetIdx];
    const targetSlot = idx.slotById.get(target.slotId)!;
    const deadline = transitionDeadline(snap.game, prevCheckOut, targetSlot);
    const remaining = deadline - now;
    const overdue = now >= deadline;
    const state: TeamState = overdue ? "TRANSITION_OVERDUE" : prevCheckOut ? "TRANSITIONING" : "WAITING";
    return {
      ...base,
      state,
      lastAssignmentId: prev ? prev.id : null,
      currentAssignmentId: target.id,
      previousCheckOut: prevCheckOut,
      previousAssignmentId: prev ? prev.id : null,
      deadline,
      transitionRemainingMs: remaining,
      transitionWarning: state === "TRANSITIONING" && remaining <= TRANSITION_WARNING_MS,
      overdueFirstStation: overdue && prevCheckOut === null,
      skippedCancelledAssignmentIds: cancelledBetween(
        idx,
        cancelled,
        prev ? slotNumberOf(idx, prev) : -Infinity,
        slotNumberOf(idx, target),
      ),
    };
  };

  if (lastIdx === -1) {
    // 沒有任何紀錄：目標 = 第一關，deadline = 第一關 scheduled_start
    return toTarget(0, null, null);
  }

  const last = route[lastIdx];
  const lastRecs = recordsOf(idx, last.id);
  if (lastRecs.stationCheckOut) {
    // 已關主出關（含 no_show）
    if (lastIdx === route.length - 1) {
      return {
        ...base,
        state: "COMPLETED",
        lastAssignmentId: last.id,
        currentAssignmentId: last.id,
        previousCheckOut: lastRecs.stationCheckOut,
        previousAssignmentId: last.id,
        arrivedAt: arrivalRecord(lastRecs, teamId)?.recordedAt ?? null,
      };
    }
    return toTarget(lastIdx + 1, lastRecs.stationCheckOut, last);
  }

  // 尚無關主出關：計時中 → AT_STATION；否則 ARRIVED
  const ad = assignments.get(last.id)!;
  const arrival = arrivalRecord(lastRecs, teamId);
  const prev = lastIdx > 0 ? route[lastIdx - 1] : null;
  const prevCheckOut = prev ? recordsOf(idx, prev.id).stationCheckOut : null;
  const common: TeamDerived = {
    ...base,
    lastAssignmentId: last.id,
    currentAssignmentId: last.id,
    previousCheckOut: prevCheckOut,
    previousAssignmentId: prev ? prev.id : null,
    arrivedAt: arrival ? arrival.recordedAt : null,
    skippedCancelledAssignmentIds: cancelledBetween(
      idx,
      cancelled,
      prev ? slotNumberOf(idx, prev) : -Infinity,
      slotNumberOf(idx, last),
    ),
  };
  if (lastRecs.stationCheckIn && ad.startedAt !== null && now >= ad.startedAt) {
    return { ...common, state: "AT_STATION" };
  }
  let detail: ArrivedDetail;
  if (lastRecs.stationCheckIn) {
    detail = "WAITING_START";
  } else if (ad.queueBlocked) {
    detail = "QUEUED";
  } else if (ad.teamIds.length > 1 && ad.teamIds.some((t) => t !== teamId && arrivalRecord(lastRecs, t) === null)) {
    detail = "WAITING_OPPONENT";
  } else {
    detail = "TEAM_REPORTED";
  }
  return { ...common, state: "ARRIVED", arrivedDetail: detail };
}

// =====================================================================
// 通知條件（第十五節；ARCHITECTURE 第 3 節第 10 點）
// =====================================================================

function buildConditions(
  idx: GameIndex,
  assignments: Map<string, AssignmentDerived>,
  teams: Map<string, TeamDerived>,
  now: number,
): NotificationCondition[] {
  const out: NotificationCondition[] = [];

  for (const a of idx.orderedAssignments) {
    const ad = assignments.get(a.id)!;
    if (ad.state === "CANCELLED") continue;

    // STATION_OVERTIME：有進關、無出關、now >= officialEnd
    if (ad.stationCheckIn && !ad.stationCheckOut && ad.officialEnd !== null && now >= ad.officialEnd) {
      out.push({
        kind: "STATION_OVERTIME",
        subkind: null,
        assignmentId: a.id,
        teamId: null,
        triggerRecordId: ad.stationCheckIn.id,
        triggerOverrideId: ad.endOverride ? ad.endOverride.id : null,
      });
    }

    // STATION_NOT_STARTED：所有隊伍都已隊輔到關、上一場已出關、
    // now >= max(最後一筆 team_check_in, scheduledStart, 上一場出關) + 3 分
    if (!ad.stationCheckIn && !ad.stationCheckOut && ad.allTeamsReported && !ad.queueBlocked) {
      let lastTci: CheckRecord | null = null;
      for (const s of ad.sides) {
        const t = s.teamCheckIn!;
        if (!lastTci || t.recordedAt > lastTci.recordedAt || (t.recordedAt === lastTci.recordedAt && t.id > lastTci.id)) {
          lastTci = t;
        }
      }
      if (lastTci) {
        const prevOut = ad.prevAssignmentId ? recordsOf(idx, ad.prevAssignmentId).stationCheckOut : null;
        const base = Math.max(lastTci.recordedAt, ad.slot.scheduledStart, prevOut ? prevOut.recordedAt : -Infinity);
        if (now >= base + STATION_NOT_STARTED_MS) {
          out.push({
            kind: "STATION_NOT_STARTED",
            subkind: null,
            assignmentId: a.id,
            teamId: null,
            triggerRecordId: lastTci.id,
            triggerOverrideId: null,
          });
        }
      }
    }

    // 次要標籤：PREV_NOT_CHECKED_OUT 與 RECORD_MISMATCH
    for (const tag of ad.tags) {
      if (!tag.notify) continue;
      if (tag.kind === "PREV_NOT_CHECKED_OUT") {
        out.push({
          kind: "PREV_NOT_CHECKED_OUT",
          subkind: null,
          assignmentId: tag.assignmentId,
          teamId: tag.teamId,
          triggerRecordId: tag.triggerRecordId,
          triggerOverrideId: null,
        });
      } else {
        out.push({
          kind: "RECORD_MISMATCH",
          subkind: tag.kind,
          assignmentId: tag.assignmentId,
          teamId: tag.teamId,
          triggerRecordId: tag.triggerRecordId,
          triggerOverrideId: null,
        });
      }
    }
  }

  // TRANSITION_OVERDUE：每隊一筆；assignmentId = 目標，trigger = 上一關出關（第一關 null）
  for (const td of teams.values()) {
    if (td.state !== "TRANSITION_OVERDUE" || !td.currentAssignmentId) continue;
    out.push({
      kind: "TRANSITION_OVERDUE",
      subkind: null,
      assignmentId: td.currentAssignmentId,
      teamId: td.team.id,
      triggerRecordId: td.previousCheckOut ? td.previousCheckOut.id : null,
      triggerOverrideId: null,
    });
  }
  return out;
}

// =====================================================================
// 整場調整標籤（第十一、二十四節）
// =====================================================================

export function adjustmentLabel(snap: GameSnapshot): string | null {
  const active = snap.adjustments.filter((x) => x.voidedAt === null);
  if (active.length === 0) return null;
  let from = Infinity;
  for (const x of active) if (x.fromSlotNumber < from) from = x.fromSlotNumber;
  const slot = snap.slots.find((s) => s.number === from);
  const total = slot
    ? slot.totalOffsetMs
    : active.filter((x) => x.fromSlotNumber <= from).reduce((sum, x) => sum + x.offsetMs, 0);
  if (total > 0) return `第${from}時段起已延後 ${formatDurationText(total)}`;
  if (total < 0) return `第${from}時段起已提前 ${formatDurationText(total)}`;
  return `第${from}時段起有排程調整（合計未變動）`;
}

// =====================================================================
// 主函式
// =====================================================================

export function deriveGame(snap: GameSnapshot, now: number): DerivedGame {
  const idx = getIndex(snap);
  const current = computeCurrentSlot(snap.slots, now);

  const assignments = new Map<string, AssignmentDerived>();
  for (const a of idx.orderedAssignments) assignments.set(a.id, deriveAssignment(snap, idx, a, now));
  linkNeighbors(idx, assignments);

  const teams = new Map<string, TeamDerived>();
  for (const t of snap.teams) {
    if (!idx.teamById.has(t.id)) continue;
    teams.set(t.id, deriveTeam(snap, idx, t.id, assignments, now));
  }
  // 回填各 assignment 上兩隊的小隊狀態；標籤排序
  for (const ad of assignments.values()) {
    for (const side of ad.sides) {
      const td = teams.get(side.teamId);
      if (td) side.teamState = td.state;
    }
    if (ad.tags.length > 1) {
      const order = new Map(ad.teamIds.map((t, i) => [t, i] as const));
      ad.tags.sort(
        (x, y) =>
          (order.get(x.teamId) ?? 99) - (order.get(y.teamId) ?? 99) || TAG_ORDER[x.kind] - TAG_ORDER[y.kind],
      );
    }
  }

  const grid: GridCell[][] = idx.orderedSlots.map((slot) =>
    snap.stations.map((station) => {
      const a = idx.assignmentBySlotStation.get(`${slot.id}|${station.id}`) ?? null;
      return {
        slotId: slot.id,
        stationId: station.id,
        assignmentId: a ? a.id : null,
        state: a ? assignments.get(a.id)!.state : ("REST" as StationSlotState),
      };
    }),
  );

  const conditions = buildConditions(idx, assignments, teams, now);

  const d: DerivedGame = {
    now,
    current,
    assignments,
    teams,
    grid,
    conditions,
    summary: { inProgress: 0, endingSoon: 0, overtime: 0, waitingStart: 0, transitioning: 0, transitionOverdue: 0, anomalies: 0 },
    activeAdjustmentLabel: adjustmentLabel(snap),
  };
  d.summary = computeSummary(d, buildStationRows(snap, idx, d, current.slotNumber));
  return d;
}

// =====================================================================
// 其他查詢
// =====================================================================

/** Dashboard 某時段的關卡列（第十一節「每一個關卡列顯示哪個 assignment」） */
export function stationRowsForSlot(snap: GameSnapshot, d: DerivedGame, slotNumber: number): StationRowView[] {
  return buildStationRows(snap, getIndex(snap), d, slotNumber);
}

/** 關主頁主卡片：該關「最早一個尚未關主出關、且未取消」的 assignment；全部完成 → null（第十七節） */
export function stationFocusAssignment(snap: GameSnapshot, d: DerivedGame, stationId: string): AssignmentDerived | null {
  const list = getIndex(snap).byStation.get(stationId) ?? [];
  for (const a of list) {
    const ad = d.assignments.get(a.id);
    if (!ad) continue;
    if (ad.state === "CANCELLED") continue;
    if (!ad.stationCheckOut) return ad;
  }
  return null;
}

/** 該關所有 assignment（依時段），含取消的 */
export function stationAssignments(snap: GameSnapshot, d: DerivedGame, stationId: string): AssignmentDerived[] {
  const list = getIndex(snap).byStation.get(stationId) ?? [];
  const out: AssignmentDerived[] = [];
  for (const a of list) {
    const ad = d.assignments.get(a.id);
    if (ad) out.push(ad);
  }
  return out;
}

/** 該隊在本遊戲的所有 assignment（依時段，含取消的；隊輔頁路線表用） */
export function teamAssignments(snap: GameSnapshot, d: DerivedGame, teamId: string): AssignmentDerived[] {
  const list = getIndex(snap).byTeam.get(teamId) ?? [];
  const out: AssignmentDerived[] = [];
  for (const a of list) {
    const ad = d.assignments.get(a.id);
    if (ad) out.push(ad);
  }
  return out;
}

/** 某隊在某 assignment 的一側資料 */
export function sideOf(ad: AssignmentDerived, teamId: string): AssignmentTeamSide | null {
  for (const s of ad.sides) if (s.teamId === teamId) return s;
  return null;
}

/** 通知 dedupe key：kind|subkind|assignmentId|teamId|triggerRecordId|triggerOverrideId（null 寫成空字串） */
export function conditionKey(c: NotificationCondition | AppNotification): string {
  return [c.kind, c.subkind ?? "", c.assignmentId ?? "", c.teamId ?? "", c.triggerRecordId ?? "", c.triggerOverrideId ?? ""].join(
    "|",
  );
}

/** server 用：從目前成立的條件中找出 (kind, subkind, assignmentId, teamId) 相符的那一個 */
export function findCondition(
  d: DerivedGame,
  req: { kind: NotificationKind; subkind: string | null; assignmentId: string | null; teamId: string | null },
): NotificationCondition | null {
  for (const c of d.conditions) {
    if (
      c.kind === req.kind &&
      (c.subkind ?? null) === (req.subkind ?? null) &&
      (c.assignmentId ?? null) === (req.assignmentId ?? null) &&
      (c.teamId ?? null) === (req.teamId ?? null)
    ) {
      return c;
    }
  }
  return null;
}
