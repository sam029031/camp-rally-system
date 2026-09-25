/**
 * 狀態推導輸出型別（合約檔，第十節）。
 *
 * 狀態 = f(有效打卡紀錄, 排程時間（含延後）, 有效取消, 有效 end override, now)
 * Dashboard、關主頁、隊輔頁、小隊視角、server（/api/notifications/check、通知失效判斷）
 * 全部呼叫 src/lib/derive/index.ts 的 deriveGame()，不得各自計算。
 */

import type {
  Assignment,
  CheckRecord,
  EndOverride,
  Cancellation,
  NotificationKind,
  RecordMismatchSubkind,
  Slot,
  Station,
  Team,
} from "@/lib/types";

// ---------------------------------------------------------------------
// A. 關卡時段狀態（每個 assignment 一個；REST 只出現在 grid cell）
// ---------------------------------------------------------------------
export type StationSlotState =
  | "REST"
  | "CANCELLED"
  | "WAITING"
  | "READY"
  | "IN_PROGRESS"
  | "ENDING_SOON"
  | "OVERTIME"
  | "CHECKED_OUT";

// ---------------------------------------------------------------------
// B. 小隊狀態（每隊每個遊戲一個）
// ---------------------------------------------------------------------
export type TeamState =
  | "WAITING"
  | "TRANSITIONING"
  | "TRANSITION_OVERDUE"
  | "ARRIVED"
  | "AT_STATION"
  | "COMPLETED";

/** ARRIVED 的顯示細分（仍是同一個狀態） */
export type ArrivedDetail =
  /** 「已到（隊輔回報）」：只有隊輔進關，關主尚未進關（紫色虛線框） */
  | "TEAM_REPORTED"
  /** 「已到，等待開始」：關主已進關、尚未到 scheduled_start */
  | "WAITING_START"
  /** 「已到，等待對手」：大地，本隊已到、同組另一隊還沒有任何抵達紀錄 */
  | "WAITING_OPPONENT"
  /** 「已到，排隊中」：該關上一個 assignment 尚未關主出關 */
  | "QUEUED";

// ---------------------------------------------------------------------
// C. 次要標籤（不改變主狀態與主色）
// ---------------------------------------------------------------------
export type SecondaryTagKind =
  | RecordMismatchSubkind
  /** 「未出關（隊伍已到下一關）」→ PREV_NOT_CHECKED_OUT 通知 */
  | "PREV_NOT_CHECKED_OUT";

export interface SecondaryTag {
  kind: SecondaryTagKind;
  assignmentId: string;
  teamId: string;
  /** 顯示文字，例如「隊輔未確認進關」 */
  label: string;
  /** 對應通知的 trigger record（可能為 null） */
  triggerRecordId: string | null;
  /**
   * 通知條件是否已成立（例如 TEAM_OUT_STATION_NOT_OUT 在寬限期內：標籤顯示，但 notify=false）。
   * 標籤本身（顯示）一律依條件立即顯示。
   */
  notify: boolean;
}

// ---------------------------------------------------------------------
// 每個 assignment 的推導結果
// ---------------------------------------------------------------------
export interface AssignmentTeamSide {
  teamId: string;
  /** 該隊隊輔的有效進關／出關紀錄 */
  teamCheckIn: CheckRecord | null;
  teamCheckOut: CheckRecord | null;
  /** 該隊在本 assignment 最早的抵達時間（team_check_in 或 station_check_in 取最早） */
  arrivedAt: number | null;
  /** 該隊目前的小隊狀態（方便 Dashboard 在同一格顯示兩隊標籤） */
  teamState: TeamState;
}

export interface AssignmentDerived {
  assignment: Assignment;
  slot: Slot;
  station: Station;
  /** 黃金 1 隊；大地 2 隊（[team_a, team_b]） */
  teamIds: string[];
  state: Exclude<StationSlotState, "REST">;
  cancellation: Cancellation | null;
  endOverride: EndOverride | null;
  stationCheckIn: CheckRecord | null;
  stationCheckOut: CheckRecord | null;
  sides: AssignmentTeamSide[];
  /** stationCheckOut?.noShow（CHECKED_OUT 顯示為「未到」） */
  noShow: boolean;
  /** 大地單隊開始（stationCheckIn.singleTeamOverride） */
  singleTeamStart: boolean;
  /** started_at = max(station_check_in.recorded_at, slot.scheduledStart)；未進關為 null */
  startedAt: number | null;
  /** 正式結束時間（依 end_policy / override）；未進關為 null */
  officialEnd: number | null;
  /** 可玩時間 = officialEnd − startedAt */
  playableMs: number | null;
  /** 縮短量 = duration − playableMs（> 0 才有值，否則 null） */
  shortenedMs: number | null;
  /** FIXED_END 壓縮後可玩時間 < min_play（「時間不足」黃色標籤） */
  insufficientTime: boolean;
  /** 關卡剩餘 = officialEnd − now（計時中才有；OVERTIME 為負數） */
  remainingMs: number | null;
  /** 距離開始計時（關主已進關但 now < startedAt）= startedAt − now */
  untilStartMs: number | null;
  /** 較預定 = startedAt − slot.scheduledStart（正數代表延後） */
  deltaVsScheduledMs: number | null;
  /** 同一關卡上一個／下一個 assignment（跳過休息時段與被取消的 assignment） */
  prevAssignmentId: string | null;
  nextAssignmentId: string | null;
  /** 上一個 assignment 尚未關主出關（本場排隊中） */
  queueBlocked: boolean;
  /** 所有隊伍都已由隊輔確認到關 */
  allTeamsReported: boolean;
  /** 本場的次要標籤（所有隊伍） */
  tags: SecondaryTag[];
}

// ---------------------------------------------------------------------
// 每隊的推導結果
// ---------------------------------------------------------------------
export interface TeamDerived {
  team: Team;
  state: TeamState;
  arrivedDetail: ArrivedDetail | null;
  /** 該隊在本遊戲的路線（依時段，已排除被取消的 assignment） */
  routeAssignmentIds: string[];
  /** 被取消而跳過的 assignment（依時段） */
  cancelledAssignmentIds: string[];
  /** 最後一個有任何有效紀錄的 assignment */
  lastAssignmentId: string | null;
  /**
   * 狀態指向的 assignment（隊輔頁的「目前關卡」）：
   * WAITING / TRANSITIONING / TRANSITION_OVERDUE → 目標（下一關）；ARRIVED / AT_STATION → last；COMPLETED → last
   */
  currentAssignmentId: string | null;
  /** 跑關起點：上一關的關主出關紀錄（第1時段為 null） */
  previousCheckOut: CheckRecord | null;
  previousAssignmentId: string | null;
  /** 跑關期限（WAITING / TRANSITIONING / TRANSITION_OVERDUE 才有） */
  deadline: number | null;
  /** 跑關剩餘 = deadline − now（逾期為負數） */
  transitionRemainingMs: number | null;
  /** 跑關剩餘 <= 2:00（黃色） */
  transitionWarning: boolean;
  /** TRANSITION_OVERDUE 且沒有上一關（文字「未到第一關」） */
  overdueFirstStation: boolean;
  /** 目標與上一關之間被取消的 assignment（隊輔頁顯示「第3時段 XX 已取消（原因）」） */
  skippedCancelledAssignmentIds: string[];
  /** 該隊在 currentAssignment 的抵達時間 */
  arrivedAt: number | null;
}

// ---------------------------------------------------------------------
// Dashboard 格子：每關卡 × 每時段
// ---------------------------------------------------------------------
export interface GridCell {
  slotId: string;
  stationId: string;
  /** null = 大地休息（REST） */
  assignmentId: string | null;
  state: StationSlotState;
}

/** 目前時段（第十一節） */
export type CurrentSlotPhase =
  /** now < 第1時段開始：k = 1，「尚未開始，09:10 開始」 */
  | "BEFORE_START"
  /** 時段進行中：「第k時段 09:10–09:25 時段剩餘 08:23」 */
  | "IN_SLOT"
  /** 兩個時段之間：歸屬下一個時段，「跑關中，第k時段 09:32 開始，還有 04:10」 */
  | "TRANSITION"
  /** 最後時段結束後：「本遊戲已結束」 */
  | "ENDED";

export interface CurrentSlotInfo {
  phase: CurrentSlotPhase;
  /** 目前時段編號 k（ENDED 時為最後一個時段） */
  slotNumber: number;
  slot: Slot;
  /** IN_SLOT：時段剩餘（scheduledEnd − now）；BEFORE_START / TRANSITION：距離開始（scheduledStart − now）；ENDED：null */
  remainingMs: number | null;
}

/** Dashboard 某一關卡列（瀏覽某時段時）要顯示的內容（第十一節規則） */
export interface StationRowView {
  station: Station;
  /** 主要顯示的 assignment（可能是上一時段仍佔住的那一場）；null = 本時段休息 */
  primaryAssignmentId: string | null;
  /** 主要顯示的是上一時段的 assignment（超時拖到本時段等） */
  showingPrevious: boolean;
  /** 本時段的 assignment（primary 是上一場時，小字顯示「第1小隊 前往中／已到 09:30」） */
  slotAssignmentId: string | null;
  /** 上一個 assignment 仍是 WAITING（完全沒有紀錄）→「上一時段 第N小隊 未到，待按本隊未到」 */
  previousNoShowPendingAssignmentId: string | null;
  /** 休息時：下一組 assignment（小字顯示下一組時間與隊伍） */
  nextAssignmentIdWhenRest: string | null;
  /** 是否列入「只看異常」 */
  isAnomaly: boolean;
}

/** 一個推導出來、目前成立的通知條件（前端偵測後呼叫 /api/notifications/check；server 也用它確認） */
export interface NotificationCondition {
  kind: NotificationKind;
  subkind: string | null;
  assignmentId: string | null;
  teamId: string | null;
  triggerRecordId: string | null;
  triggerOverrideId: string | null;
}

/** 摘要列（總召用） */
export interface GameSummary {
  inProgress: number;
  endingSoon: number;
  overtime: number;
  /** 等待開始（READY + WAITING 且本時段） */
  waitingStart: number;
  transitioning: number;
  transitionOverdue: number;
  anomalies: number;
}

export interface DerivedGame {
  now: number;
  current: CurrentSlotInfo;
  assignments: Map<string, AssignmentDerived>;
  /** 依隊伍 sortOrder */
  teams: Map<string, TeamDerived>;
  /** grid[slotIndex][stationIndex]（依 snapshot.slots / snapshot.stations 順序） */
  grid: GridCell[][];
  /** 目前成立的推導型通知條件（STATION_OVERTIME / TRANSITION_OVERDUE / STATION_NOT_STARTED / PREV_NOT_CHECKED_OUT / RECORD_MISMATCH） */
  conditions: NotificationCondition[];
  /** 目前時段的摘要 */
  summary: GameSummary;
  /** 是否有任何未撤銷的整場調整；有的話頂端顯示「第k時段起已延後 N 分鐘」 */
  activeAdjustmentLabel: string | null;
}
