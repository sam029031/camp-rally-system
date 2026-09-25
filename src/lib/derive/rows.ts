/**
 * Dashboard 關卡列與摘要列（第十一節）。
 *
 * 每一個關卡列顯示哪個 assignment（瀏覽目前時段或更早的時段時）：
 * - 該關上一個 assignment 仍是 READY / IN_PROGRESS / ENDING_SOON / OVERTIME → 繼續顯示上一隊（showingPrevious）
 * - 上一個 assignment 仍是 WAITING 且其時段已結束 → 不佔住，顯示本時段；另標「上一時段 第N小隊 未到，待按本隊未到」
 * - 否則顯示本時段的 assignment；沒有 assignment → 本時段休息（附下一組）
 * 瀏覽未來時段時只顯示該時段自己的 assignment（切換瀏覽不影響狀態）。
 */

import type { Assignment, GameSnapshot } from "@/lib/types";
import type { DerivedGame, GameSummary, StationRowView, StationSlotState } from "@/lib/derive/types";
import type { GameIndex } from "@/lib/derive/indexes";

const OCCUPYING: ReadonlySet<StationSlotState> = new Set<StationSlotState>([
  "READY",
  "IN_PROGRESS",
  "ENDING_SOON",
  "OVERTIME",
]);

function isAssignmentAnomalous(d: DerivedGame, assignmentId: string | null): boolean {
  if (!assignmentId) return false;
  const ad = d.assignments.get(assignmentId);
  if (!ad || ad.state === "CANCELLED") return false;
  if (ad.state === "OVERTIME") return true; // 超時
  if (ad.noShow) return true; // 未到
  if (ad.tags.length > 0) return true; // 未出關、第十節 C 的次要標籤
  for (const tid of ad.teamIds) {
    const td = d.teams.get(tid);
    // 跑關逾期（含未到第一關）：目標是這一場
    if (td && td.state === "TRANSITION_OVERDUE" && td.currentAssignmentId === ad.assignment.id) return true;
  }
  return false;
}

export function buildStationRows(
  snap: GameSnapshot,
  idx: GameIndex,
  d: DerivedGame,
  slotNumber: number,
): StationRowView[] {
  const slot = idx.slotByNumber.get(slotNumber);
  if (!slot) return [];
  const applyCarryOver = slotNumber <= d.current.slotNumber;

  return snap.stations.map((station) => {
    const own = idx.assignmentBySlotStation.get(`${slot.id}|${station.id}`) ?? null;
    const list = idx.byStation.get(station.id) ?? [];

    // 同一關卡、本時段之前／之後最近一個「未取消」的 assignment（跳過休息時段）
    let prev: Assignment | null = null;
    let next: Assignment | null = null;
    for (const a of list) {
      if (idx.cancellation.has(a.id)) continue;
      const n = idx.slotById.get(a.slotId)!.number;
      if (n < slotNumber) prev = a;
      else if (n > slotNumber && next === null) next = a;
    }

    let primaryAssignmentId: string | null = own ? own.id : null;
    let showingPrevious = false;
    let previousNoShowPendingAssignmentId: string | null = null;

    if (applyCarryOver && prev) {
      const pd = d.assignments.get(prev.id);
      if (pd && OCCUPYING.has(pd.state)) {
        primaryAssignmentId = prev.id;
        showingPrevious = true;
      } else if (pd && pd.state === "WAITING" && pd.slot.scheduledEnd <= d.now) {
        previousNoShowPendingAssignmentId = prev.id;
      }
    }

    const isAnomaly =
      previousNoShowPendingAssignmentId !== null ||
      isAssignmentAnomalous(d, primaryAssignmentId) ||
      (own !== null && own.id !== primaryAssignmentId && isAssignmentAnomalous(d, own.id));

    return {
      station,
      primaryAssignmentId,
      showingPrevious,
      slotAssignmentId: own ? own.id : null,
      previousNoShowPendingAssignmentId,
      nextAssignmentIdWhenRest: own === null && next ? next.id : null,
      isAnomaly,
    };
  });
}

/** 摘要列：以目前時段的關卡列計算；跑關中／跑關逾期數隊伍 */
export function computeSummary(d: DerivedGame, rows: StationRowView[]): GameSummary {
  const s: GameSummary = {
    inProgress: 0,
    endingSoon: 0,
    overtime: 0,
    waitingStart: 0,
    transitioning: 0,
    transitionOverdue: 0,
    anomalies: 0,
  };
  for (const row of rows) {
    if (row.isAnomaly) s.anomalies++;
    if (!row.primaryAssignmentId) continue;
    const ad = d.assignments.get(row.primaryAssignmentId);
    if (!ad) continue;
    switch (ad.state) {
      case "IN_PROGRESS":
        s.inProgress++;
        break;
      case "ENDING_SOON":
        s.endingSoon++;
        break;
      case "OVERTIME":
        s.overtime++;
        break;
      case "READY":
      case "WAITING":
        s.waitingStart++;
        break;
      default:
        break;
    }
  }
  for (const td of d.teams.values()) {
    if (td.state === "TRANSITIONING") s.transitioning++;
    else if (td.state === "TRANSITION_OVERDUE") s.transitionOverdue++;
  }
  return s;
}
