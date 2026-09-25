/**
 * 排程輔助（第十一、二十四節）：延後預覽、預設調整時段、/dashboard 導向。
 * 所有時段時間都來自 snapshot.slots（= v_slot_times 的有效時間），不自行計算原定時間。
 */

import type { GameCode, GameSnapshot, Slot } from "@/lib/types";

export interface AdjustmentPreviewRow {
  slotNumber: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  affected: boolean;
}

export interface AdjustmentPreview {
  rows: AdjustmentPreviewRow[];
  newLastEnd: number;
  /** 提前導致某時段與前一時段重疊（預覽顯示紅字並要求再確認） */
  overlapWarning: boolean;
}

function sortedSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => a.number - b.number);
}

/**
 * 「從第 k 時段起平移 offset」的預覽（第二十四節）。
 * 受影響的時段 = slot_number >= fromSlotNumber，與 v_slot_times 的加總規則一致。
 */
export function previewAdjustment(slots: Slot[], fromSlotNumber: number, offsetMs: number): AdjustmentPreview {
  const ordered = sortedSlots(slots);
  const rows: AdjustmentPreviewRow[] = ordered.map((s) => {
    const affected = s.number >= fromSlotNumber;
    return {
      slotNumber: s.number,
      oldStart: s.scheduledStart,
      oldEnd: s.scheduledEnd,
      newStart: affected ? s.scheduledStart + offsetMs : s.scheduledStart,
      newEnd: affected ? s.scheduledEnd + offsetMs : s.scheduledEnd,
      affected,
    };
  });
  let overlapWarning = false;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].newStart < rows[i - 1].newEnd) {
      overlapWarning = true;
      break;
    }
  }
  const newLastEnd = rows.length > 0 ? rows[rows.length - 1].newEnd : 0;
  return { rows, newLastEnd, overlapWarning };
}

/**
 * 調整時段 k 的預設值（第二十四節）：
 * 有效 scheduled_start > now，且該時段及之後的時段都沒有任何有效 station_check_in 的第一個時段。
 * 沒有符合的時段 → null。
 */
export function defaultAdjustFromSlot(snap: GameSnapshot, now: number): number | null {
  const slotNumberById = new Map<string, number>();
  for (const s of snap.slots) slotNumberById.set(s.id, s.number);
  const slotNumberByAssignment = new Map<string, number>();
  for (const a of snap.assignments) {
    const n = slotNumberById.get(a.slotId);
    if (n !== undefined) slotNumberByAssignment.set(a.id, n);
  }
  let maxSlotWithCheckIn = 0;
  for (const r of snap.records) {
    if (r.voidedAt !== null || r.action !== "station_check_in") continue;
    const n = slotNumberByAssignment.get(r.assignmentId);
    if (n !== undefined && n > maxSlotWithCheckIn) maxSlotWithCheckIn = n;
  }
  for (const s of sortedSlots(snap.slots)) {
    if (s.number > maxSlotWithCheckIn && s.scheduledStart > now) return s.number;
  }
  return null;
}

/** 某時段目前的有效開始（找不到 → null） */
export function slotByNumber(slots: Slot[], slotNumber: number): Slot | null {
  for (const s of slots) if (s.number === slotNumber) return s;
  return null;
}

/**
 * /dashboard 與 /team 自動選遊戲（第十一、十六節）：黃金最後時段結束前 → gold，其後 → land。
 * 黃金沒有時段資料時 → land。
 */
export function dashboardGameForNow(goldSlots: Slot[], now: number): GameCode {
  if (goldSlots.length === 0) return "land";
  let lastEnd = -Infinity;
  for (const s of goldSlots) if (s.scheduledEnd > lastEnd) lastEnd = s.scheduledEnd;
  return now < lastEnd ? "gold" : "land";
}
