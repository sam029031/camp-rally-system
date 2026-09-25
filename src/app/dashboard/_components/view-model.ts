/**
 * Dashboard 顯示用的純函式（不含 hook；狀態一律來自 deriveGame 的結果，這裡只組文字）。
 */

import type { GameSnapshot, Slot, Station, Team } from "@/lib/types";
import type { AssignmentDerived, DerivedGame, TeamDerived } from "@/lib/derive/types";
import { NO_SHOW_LABEL, teamName, teamStateLabel, teamStatusText } from "@/lib/labels";
import { formatCountdown, formatHm, formatHmRange } from "@/lib/time";
import type { Tone } from "@/lib/client/state-colors";

export interface Lookup {
  teamById: Map<string, Team>;
  stationById: Map<string, Station>;
  slotById: Map<string, Slot>;
}

export function buildLookup(snap: GameSnapshot): Lookup {
  return {
    teamById: new Map(snap.teams.map((t) => [t.id, t] as const)),
    stationById: new Map(snap.stations.map((s) => [s.id, s] as const)),
    slotById: new Map(snap.slots.map((s) => [s.id, s] as const)),
  };
}

export function teamLabel(lk: Lookup, teamId: string, short = false): string {
  const t = lk.teamById.get(teamId);
  return t ? teamName(t, { short }) : "（未知隊伍）";
}

/** 一場的隊伍文字：「第2小隊」或「第2小隊 VS 第4小隊」 */
export function teamsText(lk: Lookup, ad: AssignmentDerived, opts: { short?: boolean; joiner?: string } = {}): string {
  return ad.teamIds.map((id) => teamLabel(lk, id, opts.short)).join(opts.joiner ?? " VS ");
}

export function stationTitle(st: Station): string {
  return st.name;
}

/** 時段時間文字與「原定 09:54」（有整場延後時） */
export function slotTimes(slot: Slot): { range: string; original: string | null } {
  return {
    range: formatHmRange(slot.scheduledStart, slot.scheduledEnd),
    original: slot.originalStart !== slot.scheduledStart ? `原定 ${formatHm(slot.originalStart)}` : null,
  };
}

/** 某隊在某一場的狀態徽章內容 */
export type SideStatus =
  | { kind: "team"; td: TeamDerived; label?: string; suffix?: string }
  | { kind: "plain"; tone: Tone; label: string };

/**
 * 從「這一場」的角度描述某隊（大地兩隊各自一個、黃金一隊）：
 * - 小隊狀態目前指向這一場 → 小隊狀態文字（「前往中 剩 03:12」「已到 14:24:05（隊輔回報）」…）
 * - 這一場已關主出關 → 「已出關」／「未到」
 * - 小隊還在更早的關卡 → 「尚在 九九乘法（關卡中）」「前往 3的倍數 剩 03:12」
 * - 小隊已經離開（本關未出關）→ 「已離開，本關未出關」
 */
export function sideStatus(d: DerivedGame, lk: Lookup, ad: AssignmentDerived, teamId: string): SideStatus {
  if (ad.state === "CANCELLED") return { kind: "plain", tone: "gray", label: "已取消" };
  if (ad.stationCheckOut) {
    return ad.noShow ? { kind: "plain", tone: "noshow", label: NO_SHOW_LABEL } : { kind: "plain", tone: "gray", label: "已出關" };
  }
  const td = d.teams.get(teamId);
  if (!td) return { kind: "plain", tone: "gray", label: "--" };
  if (td.currentAssignmentId === ad.assignment.id) {
    if (td.state === "AT_STATION") return { kind: "team", td };
    return { kind: "team", td, label: teamStatusText(td) };
  }
  const route = td.routeAssignmentIds;
  const iThis = route.indexOf(ad.assignment.id);
  const iCur = td.currentAssignmentId ? route.indexOf(td.currentAssignmentId) : -1;
  const cur = td.currentAssignmentId ? d.assignments.get(td.currentAssignmentId) : undefined;
  const curName = cur ? stationTitle(cur.station) : "";
  if (iThis >= 0 && iCur >= 0 && iCur < iThis) {
    if (td.state === "AT_STATION" || td.state === "ARRIVED") {
      return { kind: "team", td, label: `尚在 ${curName}（${teamStateLabel(td)}）` };
    }
    if (td.state === "WAITING") {
      return { kind: "team", td, label: `尚未開始（第一關 ${curName}）` };
    }
    if (td.state === "TRANSITIONING" || td.state === "TRANSITION_OVERDUE") {
      return { kind: "team", td, label: `前往 ${curName} ${teamStatusText(td)}` };
    }
  }
  if (iThis >= 0 && iCur > iThis) return { kind: "plain", tone: "orange", label: "已離開，本關未出關" };
  return { kind: "team", td };
}

/** 關卡剩餘（第八節：official_end − now；尚未開始計時 → 「MM:SS 後開始」） */
export function remainingView(ad: AssignmentDerived): { text: string; tone: Tone } {
  if (ad.state === "CANCELLED" || ad.stationCheckOut) return { text: "--", tone: "gray" };
  if (ad.untilStartMs !== null && ad.untilStartMs > 0) {
    return { text: `${formatCountdown(ad.untilStartMs)} 後開始`, tone: "purple" };
  }
  if (ad.remainingMs !== null) {
    if (ad.remainingMs <= 0) return { text: `超時 +${formatCountdown(ad.remainingMs)}`, tone: "red" };
    return { text: formatCountdown(ad.remainingMs), tone: ad.state === "ENDING_SOON" ? "yellow" : "green" };
  }
  return { text: "--", tone: "gray" };
}

/** 狀態徽章的文字覆寫：已取消（原因）；大地 READY 且有一隊尚未抵達 →「已到，等待對手」 */
export function stationStateText(ad: AssignmentDerived): string | undefined {
  if (ad.state === "CANCELLED") return ad.cancellation ? `已取消（${ad.cancellation.reason}）` : "已取消";
  if (ad.state === "READY" && !ad.stationCheckIn && ad.teamIds.length > 1 && ad.sides.some((s) => s.arrivedAt === null)) {
    return "已到，等待對手";
  }
  return undefined;
}

/** 下一組（休息列用）：「下一組 第5時段 14:52 第2小隊 VS 第4小隊」 */
export function nextGroupText(lk: Lookup, ad: AssignmentDerived | undefined): string {
  if (!ad) return "本遊戲已無下一組";
  return `下一組 第${ad.slot.number}時段 ${formatHm(ad.slot.scheduledStart)} ${teamsText(lk, ad)}`;
}

/** 「上一時段 第N小隊 未到，待按本隊未到」 */
export function previousNoShowText(lk: Lookup, ad: AssignmentDerived | undefined): string | null {
  if (!ad) return null;
  return `上一時段 ${teamsText(lk, ad, { joiner: "、" })} 未到，待按本隊未到`;
}

/** 次要標籤文字：大地前面加隊名，黃金只有一隊不加 */
export function tagTexts(lk: Lookup, ad: AssignmentDerived): string[] {
  const multi = ad.teamIds.length > 1;
  return ad.tags.map((t) => (multi ? `${teamLabel(lk, t.teamId, true)}：${t.label}` : t.label));
}
