import type { AssignmentDerived, DerivedGame, StationRowView } from "@/lib/derive/types";

/** 一個關卡列要顯示的所有 assignment（由 stationRowsForSlot 的結果展開） */
export interface RowModel {
  row: StationRowView;
  /** 主要顯示的 assignment（可能是上一時段仍佔住的那一場）；undefined = 本時段休息 */
  primary: AssignmentDerived | undefined;
  /** 本時段自己的 assignment（primary 是上一場時另外用小字顯示） */
  own: AssignmentDerived | undefined;
  /** 上一時段仍是 WAITING（待按本隊未到）的那一場 */
  prevNoShow: AssignmentDerived | undefined;
  /** 休息時的下一組 */
  nextRest: AssignmentDerived | undefined;
}

function get(d: DerivedGame, id: string | null): AssignmentDerived | undefined {
  return id ? d.assignments.get(id) : undefined;
}

export function toRowModels(d: DerivedGame, rows: StationRowView[]): RowModel[] {
  return rows.map((row) => ({
    row,
    primary: get(d, row.primaryAssignmentId),
    own: get(d, row.slotAssignmentId),
    prevNoShow: get(d, row.previousNoShowPendingAssignmentId),
    nextRest: get(d, row.nextAssignmentIdWhenRest),
  }));
}
