/**
 * 通知失效判斷（第十五節「撤銷或修正紀錄後，若某則通知的條件不再成立，把它標記 invalidated_at」）。
 *
 * 撤銷／修正／補登／強制結束／取消／撤銷取消／延長／撤銷延長／延後／撤銷延後 成功後，
 * server 以目前的有效紀錄重算「這則推導型通知的條件是否曾經成立」，沒有成立過的回傳 id 讓 server 標記失效。
 *
 * 規則（ARCHITECTURE 第 3 節）：
 * - trigger record 已撤銷（或不存在）→ 失效
 * - STATION_OVERTIME 的 triggerOverrideId 與目前有效 override 不同 → 失效（延長後再超時 = 新事件）
 * - 用目前有效紀錄重算（例如修正出關時間到 officialEnd 之前 → 失效；
 *   TRANSITION_OVERDUE：抵達時間 <= deadline → 失效；目標被取消 → 失效）
 * - SCHEDULE_ADJUSTED / SELF_UNDO 不在這裡處理；STATION_SHORTENED：trigger 撤銷 → 失效
 *
 * 反過來，已失效的推導型通知若依目前有效紀錄條件又成立（撤銷延長、撤銷取消、改回原時間），
 * notificationsToRevalidate 回傳 id 讓 server 清掉 invalidated_at。
 */

import type { AppNotification, CheckRecord, GameSnapshot } from "@/lib/types";
import type { RecordMismatchSubkind } from "@/lib/types";
import {
  CHECKOUT_DIFF_THRESHOLD_MS,
  STATION_NOT_STARTED_MS,
  TEAM_CHECK_IN_GRACE_MS,
  TEAM_CHECK_OUT_GRACE_MS,
  TEAM_OUT_STATION_NOT_OUT_GRACE_MS,
} from "@/lib/constants";
import {
  arrivalRecord,
  getIndex,
  recordsOf,
  teamIdsOf,
  type GameIndex,
} from "@/lib/derive/indexes";
import { computeStationTiming, transitionDeadline } from "@/lib/derive/timing";

/** 取得有效（未撤銷）的 trigger record；沒有 trigger 或已撤銷 → null */
function validTrigger(idx: GameIndex, n: AppNotification): CheckRecord | null {
  if (!n.triggerRecordId) return null;
  const r = idx.recordById.get(n.triggerRecordId);
  if (!r || r.voidedAt !== null) return null;
  return r;
}

/** 同一關卡上一個未取消的 assignment */
function prevActiveOnStation(idx: GameIndex, assignmentId: string): string | null {
  const a = idx.assignmentById.get(assignmentId);
  if (!a) return null;
  const list = idx.byStation.get(a.stationId) ?? [];
  let prev: string | null = null;
  for (const x of list) {
    if (x.id === assignmentId) return prev;
    if (!idx.cancellation.has(x.id)) prev = x.id;
  }
  return null;
}

/** 這則通知的條件（依目前有效紀錄）是否曾經成立 */
function conditionHeld(snap: GameSnapshot, idx: GameIndex, n: AppNotification, now: number): boolean {
  const aid = n.assignmentId;
  if (!aid) return false;
  const a = idx.assignmentById.get(aid);
  if (!a) return false;
  // 被取消的場次不再推導任何條件（小隊路線也排除它）→ 解除。
  // 例外：已發生的關卡超時（進行中的場次不能取消，能取消時它必定已出關，超時是真實發生過的事件）。
  if (idx.cancellation.has(aid) && n.kind !== "STATION_OVERTIME") return false;
  const slot = idx.slotById.get(a.slotId)!;
  const recs = recordsOf(idx, aid);

  switch (n.kind) {
    case "STATION_OVERTIME": {
      const trig = validTrigger(idx, n);
      if (!trig || trig.action !== "station_check_in" || trig.assignmentId !== aid) return false;
      const override = idx.endOverride.get(aid) ?? null;
      if ((override ? override.id : null) !== (n.triggerOverrideId ?? null)) return false;
      const { officialEnd } = computeStationTiming(snap.game, slot, trig, override);
      const sco = recs.stationCheckOut;
      if (sco) return sco.recordedAt >= officialEnd;
      return now >= officialEnd;
    }

    case "TRANSITION_OVERDUE": {
      const teamId = n.teamId;
      if (!teamId) return false;
      const route = (idx.byTeam.get(teamId) ?? []).filter((x) => !idx.cancellation.has(x.id));
      const pos = route.findIndex((x) => x.id === aid);
      if (pos === -1) return false;
      const prev = pos > 0 ? route[pos - 1] : null;
      let prevCheckOut: CheckRecord | null = null;
      if (n.triggerRecordId) {
        const trig = validTrigger(idx, n);
        if (!trig || !prev) return false;
        const prevOut = recordsOf(idx, prev.id).stationCheckOut;
        if (!prevOut || prevOut.id !== trig.id) return false;
        prevCheckOut = trig;
      } else if (prev) {
        // 原本是「未到第一關」，但目前路線上它前面還有場次 → 條件不同，不成立
        return false;
      }
      const deadline = transitionDeadline(snap.game, prevCheckOut, slot);
      const arrival = arrivalRecord(recs, teamId);
      if (arrival) return arrival.recordedAt > deadline;
      return now >= deadline;
    }

    case "STATION_NOT_STARTED": {
      const trig = validTrigger(idx, n);
      if (!trig || trig.action !== "team_check_in" || trig.assignmentId !== aid) return false;
      const teamIds = teamIdsOf(a);
      let lastTci: CheckRecord | null = null;
      for (const t of teamIds) {
        const tci = recs.teamCheckIn.get(t);
        if (!tci) return false; // 目前並非所有隊伍都已到
        if (!lastTci || tci.recordedAt > lastTci.recordedAt || (tci.recordedAt === lastTci.recordedAt && tci.id > lastTci.id)) {
          lastTci = tci;
        }
      }
      if (!lastTci || lastTci.id !== trig.id) return false;
      const prevId = prevActiveOnStation(idx, aid);
      let prevOutAt = -Infinity;
      if (prevId) {
        const prevOut = recordsOf(idx, prevId).stationCheckOut;
        if (!prevOut) return false; // 上一場尚未出關（排隊中）時條件不成立
        prevOutAt = prevOut.recordedAt;
      }
      const threshold = Math.max(lastTci.recordedAt, slot.scheduledStart, prevOutAt) + STATION_NOT_STARTED_MS;
      // 關主在 threshold 之後才進關（或按本隊未到）→ 條件曾成立
      const firstStationAction = [recs.stationCheckIn, recs.stationCheckOut]
        .filter((r): r is CheckRecord => r !== null)
        .reduce<number | null>((min, r) => (min === null || r.recordedAt < min ? r.recordedAt : min), null);
      if (firstStationAction !== null) return firstStationAction > threshold;
      return now >= threshold;
    }

    case "PREV_NOT_CHECKED_OUT": {
      const teamId = n.teamId;
      if (!teamId) return false;
      const trig = validTrigger(idx, n);
      if (!trig) return false;
      const isArrival =
        trig.action === "station_check_in" || (trig.action === "team_check_in" && trig.teamId === teamId);
      if (!isArrival) return false;
      const route = (idx.byTeam.get(teamId) ?? []).filter((x) => !idx.cancellation.has(x.id));
      const xPos = route.findIndex((x) => x.id === aid);
      const tPos = route.findIndex((x) => x.id === trig.assignmentId);
      if (xPos === -1 || tPos === -1 || tPos <= xPos) return false;
      const sco = recs.stationCheckOut;
      // 出關（含補登／修正）早於隊伍抵達下一關 → 條件沒有成立過
      if (sco) return sco.recordedAt > trig.recordedAt;
      return true;
    }

    case "RECORD_MISMATCH": {
      const teamId = n.teamId;
      if (!teamId || !teamIdsOf(a).includes(teamId)) return false;
      const trig = validTrigger(idx, n);
      if (!trig) return false;
      const sci = recs.stationCheckIn;
      const sco = recs.stationCheckOut;
      const tci = recs.teamCheckIn.get(teamId) ?? null;
      const tco = recs.teamCheckOut.get(teamId) ?? null;
      if (sco?.noShow) return false;
      switch (n.subkind as RecordMismatchSubkind | null) {
        case "TEAM_NOT_CHECKED_IN": {
          if (!sci || sci.id !== trig.id) return false;
          const startedAt = Math.max(sci.recordedAt, slot.scheduledStart);
          const due = startedAt + TEAM_CHECK_IN_GRACE_MS;
          if (tci) return tci.recordedAt > due;
          return now >= due;
        }
        case "TEAM_NOT_CHECKED_OUT": {
          if (!sco || sco.id !== trig.id) return false;
          const due = sco.recordedAt + TEAM_CHECK_OUT_GRACE_MS;
          if (tco) return tco.recordedAt > due;
          return now >= due;
        }
        case "TEAM_OUT_STATION_NOT_OUT": {
          if (!tco || tco.id !== trig.id) return false;
          const due = tco.recordedAt + TEAM_OUT_STATION_NOT_OUT_GRACE_MS;
          if (sco) return sco.recordedAt > due;
          return now >= due;
        }
        case "CHECKOUT_TIME_DIFF": {
          if (!tco || tco.id !== trig.id || !sco) return false;
          return Math.abs(tco.recordedAt - sco.recordedAt) > CHECKOUT_DIFF_THRESHOLD_MS;
        }
        case "TEAM_CHECK_IN_MISSING": {
          if (!tco || tco.id !== trig.id) return false;
          if (tci) return tci.recordedAt > tco.recordedAt;
          return true;
        }
        default:
          // 未知的 subkind：不判斷（保留）
          return true;
      }
    }

    default:
      return true;
  }
}

/** 不做推導重算的種類：SCHEDULE_ADJUSTED / SELF_UNDO 由 RPC 直接建立；STATION_SHORTENED 只看 trigger */
const NON_DERIVED_KINDS: ReadonlySet<AppNotification["kind"]> = new Set(["SCHEDULE_ADJUSTED", "SELF_UNDO", "STATION_SHORTENED"]);

const KNOWN_MISMATCH_SUBKINDS: ReadonlySet<string> = new Set<RecordMismatchSubkind>([
  "TEAM_NOT_CHECKED_IN",
  "TEAM_NOT_CHECKED_OUT",
  "TEAM_OUT_STATION_NOT_OUT",
  "CHECKOUT_TIME_DIFF",
  "TEAM_CHECK_IN_MISSING",
]);

/**
 * 推導型通知依目前有效紀錄是否「有效」：trigger（若有）未撤銷，且條件曾成立。
 * notificationsToInvalidate 與 notificationsToRevalidate 共用同一個判斷，
 * 所以兩者結論永遠互補（某則通知不會這次被解除、下次又被恢復地來回跳）。
 */
function derivedStillValid(snap: GameSnapshot, idx: GameIndex, n: AppNotification, now: number): boolean {
  // 推導型：trigger 已撤銷 → 失效（第一關的 TRANSITION_OVERDUE 沒有 trigger）
  if (n.triggerRecordId && !validTrigger(idx, n)) return false;
  return conditionHeld(snap, idx, n, now);
}

/**
 * 回傳目前應標記 invalidated 的通知 id（只看尚未失效的）。
 * STATION_SHORTENED 只看 trigger 是否撤銷；SCHEDULE_ADJUSTED / SELF_UNDO 不處理。
 */
export function notificationsToInvalidate(snap: GameSnapshot, now: number): string[] {
  const idx = getIndex(snap);
  const out: string[] = [];
  for (const n of snap.notifications) {
    if (n.invalidatedAt !== null) continue;
    switch (n.kind) {
      case "SCHEDULE_ADJUSTED":
      case "SELF_UNDO":
        continue;
      case "STATION_SHORTENED": {
        if (n.triggerRecordId && !validTrigger(idx, n)) out.push(n.id);
        continue;
      }
      default: {
        if (!derivedStillValid(snap, idx, n, now)) out.push(n.id);
      }
    }
  }
  return out;
}

/**
 * 回傳目前應「恢復」（清掉 invalidated_at）的通知 id（第十五節：通知中心的「已解除」要反映目前的有效紀錄）。
 *
 * 例：延長後舊的超時通知被解除，之後撤銷延長 → 原本的超時條件又成立；
 *     取消場次解除了跑關逾期，之後撤銷取消 → 逾期又成立；修正時間後又改回來。
 * 由於 notifications_once 唯一索引，同一個條件不會再建立新的一筆，所以必須把舊的那筆恢復。
 *
 * - 只看已失效的推導型通知；SCHEDULE_ADJUSTED / SELF_UNDO / STATION_SHORTENED 不恢復
 *   （它們的 trigger 一旦撤銷就不會再有效）。
 * - trigger record（若有）必須仍有效；條件以 notificationsToInvalidate 相同的邏輯判斷。
 * - RECORD_MISMATCH 未知的 subkind 無法判斷 → 不恢復（保守）。
 * - 與 notificationsToInvalidate 互斥：一個只看 invalidatedAt === null、一個只看 !== null。
 * - 恢復的通知 id 不變，前端 watcher 的 seen 集合早已包含它，不會重新跳 Toast／聲音。
 */
export function notificationsToRevalidate(snap: GameSnapshot, now: number): string[] {
  const idx = getIndex(snap);
  const out: string[] = [];
  for (const n of snap.notifications) {
    if (n.invalidatedAt === null) continue;
    if (NON_DERIVED_KINDS.has(n.kind)) continue;
    if (n.kind === "RECORD_MISMATCH" && (n.subkind === null || !KNOWN_MISMATCH_SUBKINDS.has(n.subkind))) continue;
    if (derivedStillValid(snap, idx, n, now)) out.push(n.id);
  }
  return out;
}
