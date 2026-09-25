/**
 * 撤銷後的提醒文字（第二十二節「撤銷後的提醒（必做）」）。純函式，單元測試見 tests/unit/server-undo-reminder.test.ts。
 *
 * 隊輔：「你已撤銷【第2小隊 九九乘法 確認進關】。請立即到【隊輔群】tag【活動長】說明自己按錯。」
 * 關主：「你已撤銷【九九乘法 第2小隊 確認進關】。請立即到【活動組群】tag【活動長】說明自己按錯。」
 * 複製：「@活動長 我是九九乘法關主，我在 09:10:18 誤按了【第2小隊 確認進關】，已於 09:10:40 撤銷。」
 * ADMIN 自己撤銷時不跳提醒（由呼叫端回傳 null）。
 */
import type { UndoReminder } from "@/lib/api/contract";

export interface UndoReminderInput {
  side: "TEAM" | "STATION";
  stationName: string;
  /** 隊輔側：該隊名稱；關主側：本場隊伍（大地為「第2小隊 vs 第4小隊」） */
  teamText: string;
  /** 例如「確認進關」「確認出關」「本隊未到」 */
  actionText: string;
  /** 'HH:mm:ss'（Asia/Taipei） */
  recordedAtText: string;
  voidedAtText: string;
  teamGroupLabel: string;
  stationGroupLabel: string;
  leadTitle: string;
}

export function buildUndoReminder(i: UndoReminderInput): UndoReminder {
  if (i.side === "TEAM") {
    return {
      side: "TEAM",
      groupLabel: i.teamGroupLabel,
      leadTitle: i.leadTitle,
      title: `你已撤銷【${i.teamText} ${i.stationName} ${i.actionText}】。請立即到【${i.teamGroupLabel}】tag【${i.leadTitle}】說明自己按錯。`,
      copyText: `@${i.leadTitle} 我是${i.teamText}隊輔，我在 ${i.recordedAtText} 誤按了【${i.stationName} ${i.actionText}】，已於 ${i.voidedAtText} 撤銷。`,
    };
  }
  return {
    side: "STATION",
    groupLabel: i.stationGroupLabel,
    leadTitle: i.leadTitle,
    title: `你已撤銷【${i.stationName} ${i.teamText} ${i.actionText}】。請立即到【${i.stationGroupLabel}】tag【${i.leadTitle}】說明自己按錯。`,
    copyText: `@${i.leadTitle} 我是${i.stationName}關主，我在 ${i.recordedAtText} 誤按了【${i.teamText} ${i.actionText}】，已於 ${i.voidedAtText} 撤銷。`,
  };
}

/** 本場隊伍文字：黃金「第2小隊」、大地「第2小隊 vs 第4小隊」 */
export function assignmentTeamsText(teamNames: string[]): string {
  return teamNames.join(" vs ");
}
