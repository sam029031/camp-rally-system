/**
 * 隊輔頁（第十六節）的純函式輔助：不自行推導狀態，只從 deriveGame() 的結果與快照挑出要顯示的資料。
 */

import { EARLY_CHECK_IN_CONFIRM_MS } from "@/lib/constants";
import { getIndex, sideOf } from "@/lib/derive";
import type { AssignmentDerived, DerivedGame, TeamDerived } from "@/lib/derive/types";
import { teamName, teamStatusText } from "@/lib/labels";
import { formatHms } from "@/lib/time";
import type { CheckAction, CheckRecordRow, GameSnapshot, Slot, Station, Team } from "@/lib/types";

/** 由 server page 傳給 client 的隊伍資訊（可序列化） */
export interface TeamProp {
  id: string;
  code: string;
  name: string;
  isStaffTeam: boolean;
}

/** 觀看者（session）資訊 */
export interface ViewerProp {
  identityId: string;
  role: "ADMIN" | "STATION" | "TEAM" | "VIEWER";
  /** TEAM 身分自己的隊伍 */
  ownTeam: TeamProp | null;
}

/** 按下後、快照還沒重抓到之前，用來即時顯示「已完成」的本機紀錄 */
export interface LocalRecord {
  id: string;
  assignmentId: string;
  action: CheckAction;
  teamId: string | null;
  recordedAt: number;
  realCreatedAt: number;
  identityId: string | null;
}

export function toLocalRecord(r: CheckRecordRow): LocalRecord {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    action: r.action,
    teamId: r.team_id,
    recordedAt: Date.parse(r.recorded_at),
    realCreatedAt: Date.parse(r.real_created_at),
    identityId: r.identity_id,
  };
}

/**
 * 某隊在某場次的隊輔側紀錄時間：以快照為準；快照裡還沒有這筆（剛按下、尚未重抓）時用本機紀錄。
 * 快照裡已有那筆（不論有效或已撤銷）就完全相信快照，避免被別人撤銷後仍顯示「已完成」。
 */
export function teamRecordAt(
  ad: AssignmentDerived,
  teamId: string,
  action: "team_check_in" | "team_check_out",
  local: ReadonlyArray<LocalRecord>,
  knownIds: ReadonlySet<string>,
  undoneIds: ReadonlySet<string>,
): number | null {
  const side = sideOf(ad, teamId);
  const rec = action === "team_check_in" ? side?.teamCheckIn : side?.teamCheckOut;
  if (rec) return rec.recordedAt;
  for (const r of local) {
    if (r.assignmentId === ad.assignment.id && r.action === action && r.teamId === teamId && !knownIds.has(r.id) && !undoneIds.has(r.id)) {
      return r.recordedAt;
    }
  }
  return null;
}

/** 可以現場撤銷的「本 identity 最近一筆」本隊隊輔側紀錄（真實時間最新的一筆；60 秒判斷交給 UndoButton） */
export function latestOwnRecord(
  snapshot: GameSnapshot,
  teamId: string,
  identityId: string,
  local: ReadonlyArray<LocalRecord>,
  knownIds: ReadonlySet<string>,
  undoneIds: ReadonlySet<string>,
): { id: string; realCreatedAt: number } | null {
  let best: { id: string; realCreatedAt: number } | null = null;
  const consider = (id: string, realCreatedAt: number) => {
    if (undoneIds.has(id) || Number.isNaN(realCreatedAt)) return;
    if (!best || realCreatedAt > best.realCreatedAt) best = { id, realCreatedAt };
  };
  for (const r of snapshot.records) {
    if (r.voidedAt !== null || r.identityId !== identityId || r.teamId !== teamId) continue;
    if (r.action !== "team_check_in" && r.action !== "team_check_out") continue;
    consider(r.id, r.realCreatedAt);
  }
  for (const r of local) {
    if (knownIds.has(r.id) || r.identityId !== identityId || r.teamId !== teamId) continue;
    consider(r.id, r.realCreatedAt);
  }
  return best;
}

/** 該場次的對手（大地）；黃金回傳 null */
export function opponentOf(ad: AssignmentDerived, teamId: string): string | null {
  if (ad.teamIds.length < 2) return null;
  return ad.teamIds.find((t) => t !== teamId) ?? null;
}

export interface OpponentView {
  team: Team;
  /** 例：「對手第4小隊 前往中 剩 01:10」「對手第4小隊 已到 14:24:05」 */
  text: string;
  /** 顯示顏色用的對手小隊推導結果（已到時為 null） */
  derived: TeamDerived | null;
  arrived: boolean;
}

/** 大地同組對手與對手是否已到（第十六節） */
export function opponentView(
  snapshot: GameSnapshot,
  derived: DerivedGame,
  ad: AssignmentDerived,
  teamId: string,
): OpponentView | null {
  const oppId = opponentOf(ad, teamId);
  if (!oppId) return null;
  const idx = getIndex(snapshot);
  const opp = idx.teamById.get(oppId);
  if (!opp) return null;
  const name = teamName(opp);
  const side = sideOf(ad, oppId);
  if (side && side.arrivedAt !== null) {
    return { team: opp, text: `對手${name} 已到 ${formatHms(side.arrivedAt)}`, derived: null, arrived: true };
  }
  const od = derived.teams.get(oppId) ?? null;
  if (!od) return { team: opp, text: `對手${name}`, derived: null, arrived: false };
  if (od.currentAssignmentId && od.currentAssignmentId !== ad.assignment.id) {
    const cur = derived.assignments.get(od.currentAssignmentId);
    if (cur && (od.state === "AT_STATION" || od.state === "ARRIVED")) {
      return { team: opp, text: `對手${name} 還在上一關「${cur.station.name}」`, derived: od, arrived: false };
    }
  }
  return { team: opp, text: `對手${name} ${teamStatusText(od)}`, derived: od, arrived: false };
}

/** 某遊戲快照中某隊第一個未取消的場次（黃金完成後顯示「下午大地第一站」、幹部隊上午顯示用） */
export function firstStop(snapshot: GameSnapshot, teamId: string): { station: Station; slot: Slot } | null {
  const idx = getIndex(snapshot);
  const list = idx.byTeam.get(teamId) ?? [];
  for (const a of list) {
    if (idx.cancellation.has(a.id)) continue;
    const station = idx.stationById.get(a.stationId);
    const slot = idx.slotById.get(a.slotId);
    if (station && slot) return { station, slot };
  }
  return null;
}

/**
 * 「已離開，抵達下一關」的目標（第二十一節：該隊上一關尚未關主出關時按本關進關＝允許；第三十四節突發 2）。
 *
 * 只在小隊停在 cur（ARRIVED／AT_STATION）、cur 沒有有效關主出關，而且小隊看起來已經離開時回傳路線上的下一關：
 * - 隊輔已在 cur 按了確認出關（teamCheckedOut），或
 * - now >= cur 的正式結束時間（尚未開始計時則用時段預定結束），或
 * - now >= 下一關預定開始 − 7 分鐘（EARLY_CHECK_IN_CONFIRM_MS）。
 * 路線（routeAssignmentIds）已排除被取消的場次；cur 是最後一關時回傳 null。
 */
export function leaveToNextTarget(
  derived: DerivedGame,
  td: TeamDerived,
  cur: AssignmentDerived,
  teamCheckedOut: boolean,
  now: number,
): AssignmentDerived | null {
  if (cur.stationCheckOut !== null) return null;
  const idx = td.routeAssignmentIds.indexOf(cur.assignment.id);
  if (idx < 0) return null;
  const nextId = td.routeAssignmentIds[idx + 1];
  const next = nextId ? (derived.assignments.get(nextId) ?? null) : null;
  if (!next) return null;
  const curEnd = cur.officialEnd ?? cur.slot.scheduledEnd;
  const left = teamCheckedOut || now >= curEnd || now >= next.slot.scheduledStart - EARLY_CHECK_IN_CONFIRM_MS;
  return left ? next : null;
}
