/**
 * Route Handler 的 request / response 型別（合約檔）。
 * 前端（src/lib/client/*）與 server（src/app/api/**）都 import 這裡，不得各自定義。
 *
 * 通用規則：
 * - 所有寫入 route 都是 POST + JSON；先驗 cookie session（見 src/lib/server/auth.ts）。
 * - 失敗一律回 { ok: false, code, message }；HTTP status：
 *   400 INVALID_REQUEST / REASON_REQUIRED，401 UNAUTHORIZED / SESSION_EXPIRED（並清 cookie），
 *   403 FORBIDDEN / DEMO_NOT_ALLOWED / RESET_NOT_ALLOWED，409 規則拒絕（RPC rejected），
 *   423 LOGIN_LOCKED，500 INTERNAL_ERROR。
 * - 前端：4xx 不重試；網路錯誤／逾時／5xx 用同一個 client_request_id 重試（第二十八節）。
 */

import type { ErrorCode } from "@/lib/errors";
import type {
  AdjustmentInputMode,
  CheckAction,
  CheckRecordRow,
  EndPolicy,
  GameCode,
  NotificationKind,
  NotificationRow,
  Role,
  SessionInfo,
} from "@/lib/types";

export interface ApiError {
  ok: false;
  code: ErrorCode;
  message: string;
  /** ALREADY_RECORDED 等情況附上原紀錄 */
  record?: CheckRecordRow | null;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

/** 簡短裝置資訊（不含 IP；這張表所有人讀得到） */
export interface ClientInfo {
  ua?: string;
  platform?: string;
  /** 手機本身時間（只供參考，不作為正式時間） */
  deviceTime?: string;
  screen?: string;
}

// ---------------------------------------------------------------------
// 登入
// ---------------------------------------------------------------------

/** GET /api/auth/options：登入頁選單（不含 PIN hash） */
export interface LoginOption {
  identityId: string;
  role: Role;
  label: string;
  gameCode: GameCode | null;
  gameName: string | null;
  stationCode: string | null;
  stationName: string | null;
  teamCode: string | null;
  teamName: string | null;
}
export type LoginOptionsResponse = ApiResult<{ options: LoginOption[] }>;

/** POST /api/auth/login */
export interface LoginRequest {
  identityId: string;
  pin: string;
}
export type LoginResponse = ApiResult<{ session: SessionInfo; redirectTo: string }>;

/** POST /api/auth/logout → { ok: true } */
export type LogoutResponse = ApiResult<Record<string, never>>;

/** GET /api/auth/me：未登入回 { ok: true, session: null } */
export type MeResponse = ApiResult<{ session: SessionInfo | null; appEnv: string }>;

// ---------------------------------------------------------------------
// 打卡
// ---------------------------------------------------------------------

/** POST /api/check */
export interface CheckRequest {
  clientRequestId: string;
  assignmentId: string;
  action: CheckAction;
  /** 隊輔側動作必填（server 以 session 的 team 為準並比對）；關主側必須為 null */
  teamId: string | null;
  /** 「本隊未到」：只允許 station_check_out */
  noShow?: boolean;
  /** 大地 station_check_in：關主勾選的兩隊 */
  confirmedTeamIds?: string[];
  /** 大地單隊開始（只有 ADMIN） */
  singleTeamOverride?: boolean;
  /** 單隊開始原因（singleTeamOverride 時必填） */
  reason?: string;
  clientInfo?: ClientInfo;
}

/**
 * record_check 的結果：
 * - created：新寫入
 * - existing：同一個 client_request_id 已存在（重送），回傳原紀錄（可能已撤銷，record.voided_at 有值）
 * - already_recorded：同 assignment/action/team 已有有效紀錄（別支手機先按），回傳那一筆
 */
export type CheckStatus = "created" | "existing" | "already_recorded";
export type CheckResponse = ApiResult<{ status: CheckStatus; record: CheckRecordRow }>;

/** POST /api/undo：現場撤銷（60 秒內、同一 identity） */
export interface UndoRequest {
  recordId: string;
  clientInfo?: ClientInfo;
}
export interface UndoReminder {
  /** 'TEAM' → 隊輔群；'STATION' → 活動組群；ADMIN 自己撤銷時為 null（不跳提醒視窗） */
  side: "TEAM" | "STATION";
  groupLabel: string;
  leadTitle: string;
  /** 例：「你已撤銷【第2小隊 九九乘法 確認進關】。請立即到【隊輔群】tag【活動長】說明自己按錯。」 */
  title: string;
  /** 例：「@活動長 我是九九乘法關主，我在 09:10:18 誤按了【第2小隊 確認進關】，已於 09:10:40 撤銷。」 */
  copyText: string;
}
export type UndoResponse = ApiResult<{ record: CheckRecordRow; reminder: UndoReminder | null }>;

// ---------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------

/** POST /api/notifications/check：只帶 key，不帶任何時間 */
export interface NotificationCheckRequest {
  kind: NotificationKind;
  subkind: string | null;
  assignmentId: string | null;
  teamId: string | null;
}
export type NotificationCheckResult = "created" | "exists" | "not_yet";
export type NotificationCheckResponse = ApiResult<{
  result: NotificationCheckResult;
  notification: NotificationRow | null;
}>;

// ---------------------------------------------------------------------
// Admin（全部需要 ADMIN session）
// ---------------------------------------------------------------------

/** POST /api/admin/records/void */
export interface AdminVoidRecordRequest {
  recordId: string;
  reason: string;
}
/** POST /api/admin/records/correct：同一 transaction 撤銷原紀錄 + 新增 admin_correction */
export interface AdminCorrectRecordRequest {
  recordId: string;
  /** ISO 字串（前端由 Asia/Taipei 的 HH:mm:ss 轉換） */
  recordedAt: string;
  reason: string;
}
/** POST /api/admin/records/add：補登 */
export interface AdminAddRecordRequest {
  assignmentId: string;
  action: CheckAction;
  teamId: string | null;
  recordedAt: string;
  noShow?: boolean;
  reason: string;
}
/** POST /api/admin/force-end：強制結束（admin_force 的 station_check_out，時間 = app_now()） */
export interface AdminForceEndRequest {
  assignmentId: string;
  reason: string;
}
export type AdminRecordResponse = ApiResult<{ record: CheckRecordRow | null }>;

/** POST /api/admin/schedule/adjust */
export interface AdminAdjustRequest {
  gameId: string;
  fromSlotNumber: number;
  mode: AdjustmentInputMode;
  /** DELAY：分鐘（負數 = 提前） */
  offsetMinutes?: number;
  /** START_AT：'HH:mm'（Asia/Taipei，活動日當天） */
  startAt?: string;
  reason: string;
}
/** POST /api/admin/schedule/void-last */
export interface AdminVoidLastAdjustmentRequest {
  gameId: string;
  reason: string;
}
export type AdminAdjustResponse = ApiResult<{ adjustmentId: string }>;

/** POST /api/admin/cancellations：assignmentIds 或（stationId + fromSlotNumber：該關接下來所有時段） */
export interface AdminCancelRequest {
  assignmentIds?: string[];
  stationId?: string;
  fromSlotNumber?: number;
  reason: string;
}
export type AdminCancelResponse = ApiResult<{ cancellationIds: string[] }>;
/** POST /api/admin/cancellations/void */
export interface AdminVoidCancellationRequest {
  cancellationId: string;
  reason: string;
}

/** POST /api/admin/end-override：officialEnd（ISO）或 extendMinutes（以目前 official_end 或 app_now 為基準） */
export interface AdminEndOverrideRequest {
  assignmentId: string;
  officialEnd?: string;
  extendMinutes?: number;
  /** 以完整關卡時間重新計（override = max(app_now, started_at) + duration） */
  fullDuration?: boolean;
  reason: string;
}
/** POST /api/admin/end-override/void */
export interface AdminVoidEndOverrideRequest {
  overrideId: string;
  reason: string;
}
export type AdminEndOverrideResponse = ApiResult<{ overrideId: string | null }>;

/** POST /api/admin/game-settings */
export interface AdminGameSettingsRequest {
  gameId: string;
  endPolicy: EndPolicy;
  minPlaySeconds: number;
}
/** POST /api/admin/event-settings */
export interface AdminEventSettingsRequest {
  eventDate?: string;
  teamGroupLabel?: string;
  stationGroupLabel?: string;
  leadTitle?: string;
}
/** POST /api/admin/clock：Demo 面板 */
export interface AdminClockRequest {
  enabled: boolean;
  speed: number;
  /** 跳到指定時刻：'HH:mm'（活動日當天，Asia/Taipei）或 ISO 字串 */
  jumpTo?: string | null;
}
/** POST /api/admin/reset */
export interface AdminResetRequest {
  gameCode: GameCode | "all";
  confirmText: string;
}
export type AdminSimpleResponse = ApiResult<Record<string, never>>;

/** GET /api/admin/identities */
export interface AdminIdentity {
  id: string;
  role: Role;
  label: string;
  isActive: boolean;
  pinVersion: number;
  gameCode: GameCode | null;
  stationCode: string | null;
  stationName: string | null;
  teamCode: string | null;
  teamName: string | null;
  /** 登入網址（QR code 用；不含 PIN） */
  loginUrl: string;
}
export type AdminIdentitiesResponse = ApiResult<{ identities: AdminIdentity[] }>;

/** POST /api/admin/pins/reset：identityId 或 all；新 PIN 只在這次回應出現 */
export interface AdminResetPinsRequest {
  identityId?: string;
  all?: boolean;
  /** 指定新 PIN（修改 PIN）；不給就隨機產生 */
  pin?: string;
}
export type AdminResetPinsResponse = ApiResult<{
  pins: Array<{ identityId: string; label: string; role: Role; pin: string }>;
}>;

/** GET /api/admin/audit-logs?limit=&before= */
export type AdminAuditLogsResponse = ApiResult<{
  logs: Array<{
    id: number;
    actorIdentityId: string | null;
    actorLabel: string | null;
    gameId: string | null;
    action: string;
    targetTable: string | null;
    targetId: string | null;
    before: unknown;
    after: unknown;
    reason: string | null;
    createdAt: string;
  }>;
}>;

/** GET /api/admin/export?type=records|audit|schedule|notifications&game=gold|land → text/csv */
export type AdminExportType = "records" | "audit" | "schedule" | "notifications";
