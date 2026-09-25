/**
 * 關主頁的純函式（第十七、十八節）：只從快照＋推導結果＋app 時間組出畫面文字，不讀時鐘。
 */

import type { AssignmentDerived, AssignmentTeamSide, CurrentSlotInfo, DerivedGame, TeamDerived } from "@/lib/derive/types";
import type { CheckRecord, EndOverride, GameInfo, GameSnapshot, Slot, Team } from "@/lib/types";
import { SECONDARY_TAG_LABEL, stationStateLabel, teamName, teamStatusText } from "@/lib/labels";
import { formatHm, formatHmRange, formatHms } from "@/lib/time";
import { teamStateTone, type Tone } from "@/lib/client/state-colors";

/** 關主側紀錄一律 team_id NULL；「本關預期隊伍」依 assignment 的隊伍順序（team_a, team_b） */
export function teamById(snap: GameSnapshot, id: string): Team | null {
  return snap.teams.find((t) => t.id === id) ?? null;
}

export function nameOfTeam(snap: GameSnapshot, id: string, opts?: { short?: boolean }): string {
  const t = teamById(snap, id);
  return t ? teamName(t, opts) : "未知隊伍";
}

/** 「第2小隊」或「第2小隊 VS 第4小隊」 */
export function teamsTitle(snap: GameSnapshot, ad: AssignmentDerived, sep = " VS "): string {
  return ad.teamIds.map((id) => nameOfTeam(snap, id)).join(sep);
}

/** 整點分鐘顯示 HH:mm，否則 HH:mm:ss：已移到 @/lib/time（隊輔頁也用），這裡保留轉出口給關主頁既有的 import。 */
export { formatClockSmart } from "@/lib/time";

/** 「第1時段 09:10–09:25」 */
export function slotRangeText(slot: Slot): string {
  return `第${slot.number}時段 ${formatHmRange(slot.scheduledStart, slot.scheduledEnd)}`;
}

/** 有整場延後時：「原定 09:54–10:09」；沒有則 null */
export function originalRangeText(slot: Slot): string | null {
  if (slot.totalOffsetMs === 0) return null;
  return `原定 ${formatHmRange(slot.originalStart, slot.originalEnd)}`;
}

/** 頂端「目前時段」文字（第十一節） */
export function currentSlotText(cur: CurrentSlotInfo): string {
  switch (cur.phase) {
    case "BEFORE_START":
      return `尚未開始，${formatHm(cur.slot.scheduledStart)} 開始`;
    case "IN_SLOT":
      return `目前時段：${slotRangeText(cur.slot)}`;
    case "TRANSITION":
      return `跑關中，第${cur.slot.number}時段 ${formatHm(cur.slot.scheduledStart)} 開始`;
    case "ENDED":
      return "本遊戲已結束";
  }
}

/**
 * 如果現在按開始，可玩時間是多少（第八、十八節）：
 * end − max(now, scheduledStart)，end = 有效 override；否則 FIXED_END = min(start + duration, scheduledEnd)、FULL_DURATION = start + duration。
 */
export function playableIfStartNow(game: GameInfo, slot: Slot, endOverride: EndOverride | null, now: number): number {
  const startAt = Math.max(now, slot.scheduledStart);
  let end: number;
  if (endOverride) end = endOverride.officialEnd;
  else if (game.endPolicy === "FIXED_END") end = Math.min(startAt + game.stationDurationMs, slot.scheduledEnd);
  else end = startAt + game.stationDurationMs;
  return end - startAt;
}

/**
 * FIXED_END 時段已結束、且沒有「未來的有效 override」→ record_check 會以 SLOT_ALREADY_ENDED 拒絕開始（第八節），
 * 頁面改顯示「本時段已結束，請聯絡總召延長或取消本場」。
 */
export function startBlockedBySlotEnd(game: GameInfo, ad: AssignmentDerived, now: number): boolean {
  if (game.endPolicy !== "FIXED_END") return false;
  if (now < ad.slot.scheduledEnd) return false;
  return !(ad.endOverride && ad.endOverride.officialEnd > now);
}

/** 「本隊未到／本場未進行」只在時段預定結束後、沒有關主進關時出現（第十七、二十一節） */
export function noShowAvailable(ad: AssignmentDerived, now: number): boolean {
  return !ad.stationCheckIn && now >= ad.slot.scheduledEnd;
}

export interface SideStatus {
  text: string;
  tone: Tone;
  /** 「已到（隊輔回報）」用虛線框 */
  dashed: boolean;
}

/**
 * 主卡片上每一隊的一行狀態（第十八節：「第2小隊 已到 14:24（隊輔回報）」「第4小隊 前往中 剩 01:10」）。
 * - 關主已進關：顯示隊輔的進關／出關紀錄
 * - 隊輔已回報：「已到 HH:mm:ss（隊輔回報）」（等待對手／排隊中另外補充）
 * - 小隊狀態指向本場：前往中 剩 MM:SS／逾期 +MM:SS／未到第一關…
 * - 小隊還在前面的關卡或已經在後面的關卡：說明它在哪裡
 */
export function sideStatus(ad: AssignmentDerived, side: AssignmentTeamSide, d: DerivedGame): SideStatus {
  const td: TeamDerived | undefined = d.teams.get(side.teamId);

  if (ad.stationCheckIn) {
    if (side.teamCheckOut) return { text: `隊輔已回報出關 ${formatHms(side.teamCheckOut.recordedAt)}`, tone: "orange", dashed: false };
    if (side.teamCheckIn) return { text: `隊輔進關 ${formatHms(side.teamCheckIn.recordedAt)}`, tone: "gray", dashed: false };
    return { text: "隊輔尚未確認進關", tone: "gray", dashed: false };
  }

  if (side.teamCheckIn) {
    let text = `已到 ${formatHms(side.teamCheckIn.recordedAt)}（隊輔回報）`;
    if (td && td.currentAssignmentId === ad.assignment.id) {
      if (td.arrivedDetail === "WAITING_OPPONENT") text += "，等待對手";
      else if (td.arrivedDetail === "QUEUED") text += "，排隊中";
    }
    return { text, tone: "purple", dashed: true };
  }

  if (!td) return { text: "—", tone: "gray", dashed: false };

  if (td.currentAssignmentId === ad.assignment.id || td.currentAssignmentId === null) {
    return {
      text: teamStatusText(td),
      tone: teamStateTone(td.state, { transitionWarning: td.transitionWarning }),
      dashed: false,
    };
  }

  const cur = d.assignments.get(td.currentAssignmentId);
  if (cur && cur.slot.number < ad.slot.number) {
    const where = cur.station.name;
    const text =
      td.state === "TRANSITIONING" || td.state === "TRANSITION_OVERDUE" || td.state === "WAITING"
        ? `前往 ${where}（${teamStatusText(td)}）`
        : `仍在 ${where}（${stationStateLabel(cur.state, cur.noShow)}）`;
    return { text, tone: teamStateTone(td.state, { stationState: cur.state, transitionWarning: td.transitionWarning }), dashed: false };
  }
  if (cur) {
    return { text: `已在後面的關卡（${cur.station.name}）`, tone: "orange", dashed: false };
  }
  return { text: teamStatusText(td), tone: teamStateTone(td.state, { transitionWarning: td.transitionWarning }), dashed: false };
}

export interface RedBanner {
  key: string;
  text: string;
}

/**
 * 紅底醒目橫幅（第十七節，直到條件解除）：
 * - PREV_NOT_CHECKED_OUT：「第2小隊已到下一關，請立即按出關」（本場沒有關主進關時用「未到（隊伍已在下一關），待按本隊未到」）
 * - TEAM_OUT_STATION_NOT_OUT：「第2小隊隊輔已於 09:25:10 回報出關，請確認出關」（立即顯示，不等寬限）
 */
export function redBanners(snap: GameSnapshot, ad: AssignmentDerived): RedBanner[] {
  const out: RedBanner[] = [];
  for (const tag of ad.tags) {
    const name = nameOfTeam(snap, tag.teamId);
    if (tag.kind === "PREV_NOT_CHECKED_OUT") {
      out.push({
        key: `prev-${tag.teamId}`,
        text: ad.stationCheckIn ? `${name}已到下一關，請立即按出關` : `${name} ${tag.label || SECONDARY_TAG_LABEL.PREV_NOT_CHECKED_OUT}`,
      });
    } else if (tag.kind === "TEAM_OUT_STATION_NOT_OUT") {
      const side = ad.sides.find((s) => s.teamId === tag.teamId);
      const at = side?.teamCheckOut ? formatHms(side.teamCheckOut.recordedAt) : null;
      out.push({
        key: `out-${tag.teamId}`,
        text: at ? `${name}隊輔已於 ${at} 回報出關，請確認出關` : `${name}隊輔已回報出關，請確認出關`,
      });
    }
  }
  return out;
}

/** 本關目前時段的格子（休息／取消判斷用）；ENDED 或找不到時為 null */
export function currentCellAssignment(
  snap: GameSnapshot,
  d: DerivedGame,
  stationId: string,
): { kind: "rest" } | { kind: "assignment"; ad: AssignmentDerived } | null {
  if (d.current.phase === "ENDED") return null;
  const slotIdx = snap.slots.findIndex((s) => s.number === d.current.slotNumber);
  const stIdx = snap.stations.findIndex((s) => s.id === stationId);
  if (slotIdx < 0 || stIdx < 0) return null;
  const cell = d.grid[slotIdx]?.[stIdx];
  if (!cell) return null;
  if (!cell.assignmentId) return { kind: "rest" };
  const ad = d.assignments.get(cell.assignmentId);
  return ad ? { kind: "assignment", ad } : null;
}

/** 一筆紀錄（本 identity 自己按的、可以現場撤銷的候選） */
export interface OwnRecordItem {
  record: CheckRecord;
  /** 「第2小隊 確認進關」「第2小隊 VS 第4小隊 本場未進行」 */
  label: string;
}
