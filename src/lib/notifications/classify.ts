/**
 * 通知對象與 Toast 分類（第十五節；ARCHITECTURE 第 3 節）。
 *
 * 通知對象：
 * - STATION_OVERTIME / STATION_NOT_STARTED → 所有 Dashboard、該關關主頁、相關隊伍隊輔頁
 * - TRANSITION_OVERDUE → Dashboard、該隊隊輔頁、目標關卡關主頁
 * - PREV_NOT_CHECKED_OUT → Dashboard、X（未出關那一場）的關主頁、該隊隊輔頁
 * - STATION_SHORTENED → Dashboard、admin
 * - SCHEDULE_ADJUSTED → 全部頁面
 * - SELF_UNDO、其他 RECORD_MISMATCH → 只進通知中心（B 類，不跳 Toast）
 * - RECORD_MISMATCH / TEAM_OUT_STATION_NOT_OUT → 只對該關關主頁跳 Toast，其他頁面只列在通知中心
 *
 * admin 與 Dashboard 的通知中心列出全部通知。
 */

import type { AppNotification, GameSnapshot, NotificationKind } from "@/lib/types";
import { A_CLASS_KINDS } from "@/lib/types";
import type { NotificationCondition } from "@/lib/derive/types";
import { getIndex, teamIdsOf } from "@/lib/derive/indexes";

export interface PageContext {
  page: "dashboard" | "station" | "team" | "admin";
  stationId?: string | null;
  teamId?: string | null;
}

interface Target {
  kind: NotificationKind;
  subkind: string | null;
  assignmentId: string | null;
  teamId: string | null;
  triggerRecordId: string | null;
}

function assignmentStation(snap: GameSnapshot, assignmentId: string | null): string | null {
  if (!assignmentId) return null;
  return getIndex(snap).assignmentById.get(assignmentId)?.stationId ?? null;
}

function assignmentHasTeam(snap: GameSnapshot, assignmentId: string | null, teamId: string): boolean {
  if (!assignmentId) return false;
  const a = getIndex(snap).assignmentById.get(assignmentId);
  return a ? teamIdsOf(a).includes(teamId) : false;
}

/** 關主頁：這則通知／條件是不是本關的事 */
function relevantToStation(t: Target, snap: GameSnapshot, stationId: string): boolean {
  switch (t.kind) {
    case "SCHEDULE_ADJUSTED":
      return true;
    case "STATION_SHORTENED":
      return false;
    // 其餘都以 assignment 的關卡判斷：
    // STATION_OVERTIME / STATION_NOT_STARTED = 該關；TRANSITION_OVERDUE = 目標關卡；
    // PREV_NOT_CHECKED_OUT = X 的關卡；RECORD_MISMATCH / SELF_UNDO = 該場的關卡
    default:
      return assignmentStation(snap, t.assignmentId) === stationId;
  }
}

/** 隊輔頁：這則通知／條件是不是本隊的事 */
function relevantToTeam(t: Target, snap: GameSnapshot, teamId: string): boolean {
  switch (t.kind) {
    case "SCHEDULE_ADJUSTED":
      return true;
    case "STATION_SHORTENED":
      return false;
    case "STATION_OVERTIME":
    case "STATION_NOT_STARTED":
      return assignmentHasTeam(snap, t.assignmentId, teamId);
    case "TRANSITION_OVERDUE":
    case "PREV_NOT_CHECKED_OUT":
    case "RECORD_MISMATCH":
      return t.teamId === teamId;
    case "SELF_UNDO": {
      // 被撤銷的紀錄是本隊隊輔的，或是本隊所在場次的關主側紀錄
      if (t.teamId) return t.teamId === teamId;
      if (t.triggerRecordId) {
        const r = getIndex(snap).recordById.get(t.triggerRecordId);
        if (r && r.teamId) return r.teamId === teamId;
      }
      return assignmentHasTeam(snap, t.assignmentId, teamId);
    }
  }
}

function isRelevant(t: Target, snap: GameSnapshot, ctx: PageContext): boolean {
  // SCHEDULE_ADJUSTED → 全部頁面（第十五節 6）：
  // 包含還沒選隊伍的 /team（teamId null）與還沒選關卡的 /station（stationId null）
  if (t.kind === "SCHEDULE_ADJUSTED") return true;
  switch (ctx.page) {
    case "dashboard":
    case "admin":
      return true;
    case "station":
      return ctx.stationId ? relevantToStation(t, snap, ctx.stationId) : false;
    case "team":
      return ctx.teamId ? relevantToTeam(t, snap, ctx.teamId) : false;
  }
}

/** 這則通知要不要出現在本頁的通知中心 */
export function isRelevantNotification(n: AppNotification, snap: GameSnapshot, ctx: PageContext): boolean {
  return isRelevant(n, snap, ctx);
}

/**
 * 這則通知在本頁要不要跳 Toast／聲音（A 類且相關；已解除的不跳）。
 * RECORD_MISMATCH 只有 TEAM_OUT_STATION_NOT_OUT 在該關關主頁跳；SELF_UNDO 一律不跳。
 */
export function isToastNotification(n: AppNotification, snap: GameSnapshot, ctx: PageContext): boolean {
  if (n.invalidatedAt !== null) return false;
  if (!isRelevant(n, snap, ctx)) return false;
  if (n.kind === "RECORD_MISMATCH") {
    return (
      n.subkind === "TEAM_OUT_STATION_NOT_OUT" &&
      ctx.page === "station" &&
      !!ctx.stationId &&
      assignmentStation(snap, n.assignmentId) === ctx.stationId
    );
  }
  return A_CLASS_KINDS.includes(n.kind);
}

/** 頁面只偵測自己已載入／相關的推導條件（Dashboard / admin 偵測全部） */
export function isConditionRelevant(c: NotificationCondition, snap: GameSnapshot, ctx: PageContext): boolean {
  return isRelevant(c, snap, ctx);
}
