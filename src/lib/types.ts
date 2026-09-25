/**
 * 共用型別（合約檔）。
 *
 * - `*Row`：Supabase 回傳的原始列（snake_case，timestamptz 為 ISO 字串）。
 * - 其餘（camelCase）：正規化後給推導 function 使用的型別，時間一律為 epoch 毫秒（number）。
 *
 * 轉換在 src/lib/data/snapshot.ts（normalizeSnapshot）。
 * 推導輸出型別在 src/lib/derive/types.ts。
 */

export type GameCode = "gold" | "land";
export type Role = "ADMIN" | "STATION" | "TEAM" | "VIEWER";
export type CheckAction =
  | "station_check_in"
  | "station_check_out"
  | "team_check_in"
  | "team_check_out";
export type RecordSource = "ui" | "admin_correction" | "admin_force";
export type EndPolicy = "FULL_DURATION" | "FIXED_END";
export type AdjustmentInputMode = "DELAY" | "START_AT";
export type TriggerPhase = "CREATE" | "VOID";

export type NotificationKind =
  | "STATION_OVERTIME"
  | "TRANSITION_OVERDUE"
  | "STATION_NOT_STARTED"
  | "PREV_NOT_CHECKED_OUT"
  | "STATION_SHORTENED"
  | "SCHEDULE_ADJUSTED"
  | "SELF_UNDO"
  | "RECORD_MISMATCH";

/** RECORD_MISMATCH 的 subkind（第十節 C） */
export type RecordMismatchSubkind =
  /** 計時已開始 90 秒，該隊隊輔仍未按進關。trigger = station_check_in */
  | "TEAM_NOT_CHECKED_IN"
  /** 關主出關 90 秒後，該隊隊輔仍未按出關。trigger = station_check_out */
  | "TEAM_NOT_CHECKED_OUT"
  /** 隊輔已出關，關主未出關（最危險）。trigger = team_check_out */
  | "TEAM_OUT_STATION_NOT_OUT"
  /** 同一隊隊輔出關與關主出關時間差超過 60 秒。trigger = team_check_out */
  | "CHECKOUT_TIME_DIFF"
  /** 隊輔完全沒有進關紀錄就出關。trigger = team_check_out */
  | "TEAM_CHECK_IN_MISSING";

/** 會跳 Toast／聲音的 A 類通知（RECORD_MISMATCH 只有 TEAM_OUT_STATION_NOT_OUT 對該關關主頁跳） */
export const A_CLASS_KINDS: readonly NotificationKind[] = [
  "STATION_OVERTIME",
  "TRANSITION_OVERDUE",
  "STATION_NOT_STARTED",
  "PREV_NOT_CHECKED_OUT",
  "STATION_SHORTENED",
  "SCHEDULE_ADJUSTED",
] as const;

/** 由前端偵測、走 POST /api/notifications/check 的推導型通知 */
export const DERIVED_KINDS: readonly NotificationKind[] = [
  "STATION_OVERTIME",
  "TRANSITION_OVERDUE",
  "STATION_NOT_STARTED",
  "PREV_NOT_CHECKED_OUT",
  "RECORD_MISMATCH",
] as const;

// =====================================================================
// 原始列（DB rows）
// =====================================================================

export interface EventRow {
  id: string;
  name: string;
  event_date: string; // 'YYYY-MM-DD'
  timezone: string;
  is_active: boolean;
  sim_enabled: boolean;
  sim_speed: number;
  sim_anchor_real: string | null;
  sim_anchor_virtual: string | null;
  team_group_label: string;
  station_group_label: string;
  lead_title: string;
  created_at: string;
  updated_at: string;
}

export interface GameRow {
  id: string;
  event_id: string;
  code: GameCode;
  name: string;
  station_duration_seconds: number;
  transition_duration_seconds: number;
  teams_per_station: 1 | 2;
  end_policy: EndPolicy;
  min_play_seconds: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** v_slot_times 的一列 */
export interface SlotTimeRow {
  slot_id: string;
  game_id: string;
  event_id: string;
  game_code: GameCode;
  slot_number: number;
  start_local: string; // 'HH:MM:SS'
  end_local: string;
  original_start: string;
  original_end: string;
  total_offset_seconds: number;
  scheduled_start: string;
  scheduled_end: string;
}

export interface StationRow {
  id: string;
  game_id: string;
  code: string;
  name: string;
  source_name: string;
  sort_order: number;
}

export interface TeamRow {
  id: string;
  code: string;
  name: string;
  is_staff_team: boolean;
  sort_order: number;
}

export interface AssignmentRow {
  id: string;
  game_id: string;
  slot_id: string;
  station_id: string;
  team_a_id: string;
  team_b_id: string | null;
}

/** v_check_records 的一列（check_records + game_id/slot_id/station_id） */
export interface CheckRecordRow {
  id: string;
  client_request_id: string;
  assignment_id: string;
  action: CheckAction;
  team_id: string | null;
  no_show: boolean;
  single_team_override: boolean;
  confirmed_team_ids: string[] | null;
  recorded_at: string;
  real_created_at: string;
  identity_id: string | null;
  source: RecordSource;
  reason: string | null;
  client_info: Record<string, unknown> | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  replaces_record_id: string | null;
  game_id: string;
  slot_id: string;
  station_id: string;
}

export interface ScheduleAdjustmentRow {
  id: string;
  game_id: string;
  from_slot_number: number;
  offset_seconds: number;
  input_mode: AdjustmentInputMode;
  reason: string;
  identity_id: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

/** v_assignment_cancellations 的一列 */
export interface CancellationRow {
  id: string;
  assignment_id: string;
  reason: string;
  identity_id: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  game_id: string;
}

/** v_assignment_end_overrides 的一列 */
export interface EndOverrideRow {
  id: string;
  assignment_id: string;
  official_end: string;
  reason: string;
  identity_id: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  game_id: string;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  game_id: string;
  subkind: string | null;
  assignment_id: string | null;
  team_id: string | null;
  trigger_record_id: string | null;
  trigger_adjustment_id: string | null;
  trigger_cancellation_id: string | null;
  trigger_override_id: string | null;
  trigger_phase: TriggerPhase;
  message: string;
  invalidated_at: string | null;
  created_at: string;
  real_created_at: string;
}

export interface IdentityRow {
  id: string;
  role: Role;
  station_id: string | null;
  team_id: string | null;
  label: string;
  pin_hash: string;
  pin_version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: number;
  actor_identity_id: string | null;
  game_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  client_info: unknown;
  created_at: string;
}

/** get_clock() RPC 回傳 */
export interface ClockRpcResult {
  server_now: string;
  event_id: string | null;
  app_now: string;
  sim_enabled: boolean;
  sim_speed: number;
  sim_anchor_real: string | null;
  sim_anchor_virtual: string | null;
}

// =====================================================================
// 正規化後（推導用，時間 = epoch ms）
// =====================================================================

export interface ClockSettings {
  simEnabled: boolean;
  simSpeed: number;
  simAnchorReal: number | null;
  simAnchorVirtual: number | null;
}

export interface EventInfo {
  id: string;
  name: string;
  eventDate: string; // 'YYYY-MM-DD'
  timezone: string;
  isActive: boolean;
  clock: ClockSettings;
  teamGroupLabel: string;
  stationGroupLabel: string;
  leadTitle: string;
}

export interface GameInfo {
  id: string;
  eventId: string;
  code: GameCode;
  name: string;
  stationDurationMs: number;
  transitionDurationMs: number;
  teamsPerStation: 1 | 2;
  endPolicy: EndPolicy;
  minPlayMs: number;
  updatedAt: string;
}

export interface Slot {
  id: string;
  number: number;
  /** 有效時間（含整場延後） */
  scheduledStart: number;
  scheduledEnd: number;
  /** 原定時間（未加延後） */
  originalStart: number;
  originalEnd: number;
  totalOffsetMs: number;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  sourceName: string;
  sortOrder: number;
}

export interface Team {
  id: string;
  code: string;
  name: string;
  isStaffTeam: boolean;
  sortOrder: number;
}

export interface Assignment {
  id: string;
  slotId: string;
  stationId: string;
  teamAId: string;
  teamBId: string | null;
}

export interface CheckRecord {
  id: string;
  clientRequestId: string;
  assignmentId: string;
  action: CheckAction;
  teamId: string | null;
  noShow: boolean;
  singleTeamOverride: boolean;
  confirmedTeamIds: string[] | null;
  recordedAt: number;
  realCreatedAt: number;
  identityId: string | null;
  source: RecordSource;
  reason: string | null;
  voidedAt: number | null;
  voidedBy: string | null;
  voidReason: string | null;
  replacesRecordId: string | null;
}

export interface Adjustment {
  id: string;
  fromSlotNumber: number;
  offsetMs: number;
  inputMode: AdjustmentInputMode;
  reason: string;
  identityId: string | null;
  createdAt: number;
  voidedAt: number | null;
  voidReason: string | null;
}

export interface Cancellation {
  id: string;
  assignmentId: string;
  reason: string;
  identityId: string | null;
  createdAt: number;
  voidedAt: number | null;
  voidReason: string | null;
}

export interface EndOverride {
  id: string;
  assignmentId: string;
  officialEnd: number;
  reason: string;
  identityId: string | null;
  createdAt: number;
  voidedAt: number | null;
  voidReason: string | null;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  subkind: string | null;
  assignmentId: string | null;
  teamId: string | null;
  triggerRecordId: string | null;
  triggerAdjustmentId: string | null;
  triggerCancellationId: string | null;
  triggerOverrideId: string | null;
  triggerPhase: TriggerPhase;
  message: string;
  invalidatedAt: number | null;
  createdAt: number;
}

/**
 * 一個遊戲的完整狀態快照：推導 function 的唯一輸入（加上 now）。
 * 包含已撤銷的紀錄（管理頁要顯示）；推導時自行過濾 voidedAt === null。
 */
export interface GameSnapshot {
  event: EventInfo;
  game: GameInfo;
  /** 依 number 排序 */
  slots: Slot[];
  /** 依 sortOrder 排序 */
  stations: Station[];
  /** 本遊戲的參與隊伍（由 assignments 決定；黃金不含幹部隊），依 sortOrder 排序 */
  teams: Team[];
  assignments: Assignment[];
  records: CheckRecord[];
  cancellations: Cancellation[];
  endOverrides: EndOverride[];
  adjustments: Adjustment[];
  /** 依 createdAt 排序 */
  notifications: AppNotification[];
  /** 載入時間（real ms，前端判斷「資料可能過期」用） */
  fetchedAt: number;
}

/** 已登入的 session（cookie 內容，見 src/lib/server/session.ts） */
export interface SessionPayload {
  identityId: string;
  role: Role;
  stationId: string | null;
  teamId: string | null;
  pinVersion: number;
  /** epoch 秒 */
  exp: number;
}

/** GET /api/auth/me 回傳給前端的 session 資訊 */
export interface SessionInfo {
  identityId: string;
  role: Role;
  label: string;
  station: { id: string; code: string; name: string; gameCode: GameCode; gameId: string } | null;
  team: { id: string; code: string; name: string; isStaffTeam: boolean } | null;
}
