/**
 * 通知文字（第十五節）。建立通知時把文字直接存進 notifications.message。
 *
 * 例：
 * - 「九九乘法－第2小隊已超時」（大地列出兩隊：「歐北共－第2小隊、第4小隊已超時」）
 * - 「第2小隊 跑關逾期（前往 3的倍數）」「第8小隊 未到第一關（ㄇㄉㄈㄎ）」
 * - 「歐北共：第2小隊、第4小隊都已到關超過 3 分鐘，關主尚未開始」
 * - 「第2小隊已到下一關，鐵頭功尚未按出關」
 * - 「第2小隊隊輔已於 09:25:10 回報出關，九九乘法關主尚未確認出關」
 */

import type { AppNotification, GameSnapshot, NotificationKind, RecordMismatchSubkind, Team } from "@/lib/types";
import type { DerivedGame, NotificationCondition } from "@/lib/derive/types";
import { getIndex, recordsOf, teamIdsOf } from "@/lib/derive/indexes";
import { teamName } from "@/lib/labels";
import { formatDurationText, formatHm, formatHms } from "@/lib/time";
import { STATION_NOT_STARTED_MS } from "@/lib/constants";

function nameOfTeam(snap: GameSnapshot, teamId: string | null): string {
  if (!teamId) return "";
  const idx = getIndex(snap);
  const t: Team | undefined = idx.teamById.get(teamId);
  return t ? teamName(t) : "未知隊伍";
}

function teamsText(snap: GameSnapshot, teamIds: string[]): string {
  return teamIds.map((t) => nameOfTeam(snap, t)).join("、");
}

/** 由推導條件產生通知文字（server 在 create_notification 前呼叫） */
export function buildConditionMessage(c: NotificationCondition, snap: GameSnapshot, d: DerivedGame): string {
  const idx = getIndex(snap);
  const a = c.assignmentId ? idx.assignmentById.get(c.assignmentId) ?? null : null;
  const station = a ? idx.stationById.get(a.stationId) ?? null : null;
  const stationName = station ? station.name : "未知關卡";
  const teamIds = a ? teamIdsOf(a) : [];
  const team = nameOfTeam(snap, c.teamId);

  switch (c.kind) {
    case "STATION_OVERTIME": {
      const ad = a ? d.assignments.get(a.id) ?? null : null;
      const extended = ad?.endOverride ? `（已延長至 ${formatHm(ad.endOverride.officialEnd)}）` : "";
      return `${stationName}－${teamsText(snap, teamIds)}已超時${extended}`;
    }

    case "TRANSITION_OVERDUE": {
      if (!c.triggerRecordId) return `${team} 未到第一關（${stationName}）`;
      return `${team} 跑關逾期（前往 ${stationName}）`;
    }

    case "STATION_NOT_STARTED": {
      const minutes = formatDurationText(STATION_NOT_STARTED_MS);
      if (teamIds.length > 1) {
        return `${stationName}：${teamsText(snap, teamIds)}都已到關超過 ${minutes}，關主尚未開始`;
      }
      return `${stationName}：${teamsText(snap, teamIds)}已到關超過 ${minutes}，關主尚未開始`;
    }

    case "PREV_NOT_CHECKED_OUT": {
      const recs = a ? recordsOf(idx, a.id) : null;
      if (recs && !recs.stationCheckIn) {
        return `${team}已在下一關，${stationName}尚未進關也未按本隊未到`;
      }
      return `${team}已到下一關，${stationName}尚未按出關`;
    }

    case "RECORD_MISMATCH": {
      const recs = a ? recordsOf(idx, a.id) : null;
      const tco = recs && c.teamId ? recs.teamCheckOut.get(c.teamId) ?? null : null;
      switch (c.subkind as RecordMismatchSubkind | null) {
        case "TEAM_OUT_STATION_NOT_OUT":
          return tco
            ? `${team}隊輔已於 ${formatHms(tco.recordedAt)} 回報出關，${stationName}關主尚未確認出關`
            : `${team}隊輔已回報出關，${stationName}關主尚未確認出關`;
        case "TEAM_NOT_CHECKED_IN":
          return `${stationName} ${team}：計時已開始 90 秒，隊輔尚未確認進關`;
        case "TEAM_NOT_CHECKED_OUT":
          return `${stationName} ${team}：關主已出關 90 秒，隊輔尚未確認出關`;
        case "CHECKOUT_TIME_DIFF": {
          const sco = recs?.stationCheckOut ?? null;
          if (sco && tco) {
            return `${stationName} ${team}：紀錄不一致（關主出關 ${formatHms(sco.recordedAt)}、隊輔出關 ${formatHms(tco.recordedAt)}）`;
          }
          return `${stationName} ${team}：紀錄不一致（出關時間差超過 60 秒）`;
        }
        case "TEAM_CHECK_IN_MISSING":
          return `${stationName} ${team}：隊輔漏按進關（沒有進關紀錄就出關）`;
        default:
          return `${stationName} ${team}：紀錄異常`;
      }
    }

    case "STATION_SHORTENED":
      return `${stationName} ${teamsText(snap, teamIds)}：本場可玩時間不足`;
    case "SCHEDULE_ADJUSTED":
      return "排程已調整";
    case "SELF_UNDO":
      return `${stationName}：有一筆紀錄已被現場撤銷`;
  }
}

/** 合併 Toast 用的類別詞 */
const TOAST_GROUP_TEXT: Record<NotificationKind, (count: number) => string> = {
  STATION_OVERTIME: (n) => `${n} 關超時`,
  TRANSITION_OVERDUE: (n) => `${n} 隊跑關逾期`,
  STATION_NOT_STARTED: (n) => `${n} 關關主未開始`,
  PREV_NOT_CHECKED_OUT: (n) => `${n} 關漏按出關`,
  STATION_SHORTENED: (n) => `${n} 關可玩時間不足`,
  SCHEDULE_ADJUSTED: (n) => `${n} 則排程調整`,
  SELF_UNDO: (n) => `${n} 筆現場撤銷`,
  RECORD_MISMATCH: (n) => `${n} 筆紀錄異常`,
};

const TOAST_KIND_ORDER: NotificationKind[] = [
  "STATION_OVERTIME",
  "TRANSITION_OVERDUE",
  "PREV_NOT_CHECKED_OUT",
  "STATION_NOT_STARTED",
  "RECORD_MISMATCH",
  "STATION_SHORTENED",
  "SCHEDULE_ADJUSTED",
  "SELF_UNDO",
];

/**
 * 同時多筆時合併成一則 Toast（第十五節「例如「3 關超時」」）。
 * 只有一筆 → 直接用該筆 message；多筆 → 「3 關超時、2 隊跑關逾期」。
 */
export function buildToastSummary(list: Pick<AppNotification, "kind" | "message">[]): string {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0].message;
  const counts = new Map<NotificationKind, number>();
  for (const n of list) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const k of TOAST_KIND_ORDER) {
    const c = counts.get(k);
    if (!c) continue;
    if (c === 1) {
      const only = list.find((n) => n.kind === k);
      parts.push(only ? only.message : TOAST_GROUP_TEXT[k](1));
    } else {
      parts.push(TOAST_GROUP_TEXT[k](c));
    }
  }
  return parts.join("；");
}
