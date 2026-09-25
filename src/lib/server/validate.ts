/**
 * Request body 驗證（純函式，單元測試見 tests/unit/server-validate.test.ts）。
 *
 * 規則：
 * - 形狀或型別不對 → 400 INVALID_REQUEST；原因空白（trim 後） → 400 REASON_REQUIRED。
 * - 只驗合約（src/lib/api/contract.ts）列出的欄位；其他欄位忽略。
 * - 這裡只做格式檢查；權限與業務規則在 route（session 比對）與 RPC（第二十一節）。
 */
import type {
  AdminAddRecordRequest,
  AdminAdjustRequest,
  AdminCancelRequest,
  AdminClockRequest,
  AdminCorrectRecordRequest,
  AdminEndOverrideRequest,
  AdminEventSettingsRequest,
  AdminForceEndRequest,
  AdminGameSettingsRequest,
  AdminResetPinsRequest,
  AdminResetRequest,
  AdminVoidCancellationRequest,
  AdminVoidEndOverrideRequest,
  AdminVoidLastAdjustmentRequest,
  AdminVoidRecordRequest,
  CheckRequest,
  ClientInfo,
  LoginRequest,
  NotificationCheckRequest,
  UndoRequest,
} from "@/lib/api/contract";
import { PIN_LENGTH } from "@/lib/constants";
import { DERIVED_KINDS, type CheckAction, type EndPolicy, type GameCode, type NotificationKind } from "@/lib/types";
import { ApiHttpError, badRequest, reasonRequired } from "@/lib/server/errors";
import { isValidDateString, parseTimeOfDay } from "@/lib/server/time-input";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PIN_RE = new RegExp(`^\\d{${PIN_LENGTH}}$`);
/** ISO 8601，必須帶時區（Z 或 ±HH:mm），避免被 server 時區（Vercel = UTC）解讀 */
const ISO_WITH_ZONE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

export const MAX_REASON_LENGTH = 500;
const MAX_LABEL_LENGTH = 40;
const CHECK_ACTIONS: readonly CheckAction[] = [
  "station_check_in",
  "station_check_out",
  "team_check_in",
  "team_check_out",
];
const END_POLICIES: readonly EndPolicy[] = ["FULL_DURATION", "FIXED_END"];
/** 延後／提前單次上限（分鐘）：一天活動不可能超過 6 小時 */
export const MAX_ADJUST_MINUTES = 360;
/** 延長單次上限（分鐘） */
export const MAX_EXTEND_MINUTES = 180;

// ---------------------------------------------------------------------
// 基本欄位
// ---------------------------------------------------------------------

export type Obj = Record<string, unknown>;

export function asObject(body: unknown): Obj {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest();
  }
  return body as Obj;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function fieldError(field: string): ApiHttpError {
  return badRequest(`送出的資料不正確（${field}）。`);
}

export function uuidField(o: Obj, key: string): string {
  const v = o[key];
  if (!isUuid(v)) throw fieldError(key);
  return v.toLowerCase();
}

export function optionalUuidField(o: Obj, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!isUuid(v)) throw fieldError(key);
  return v.toLowerCase();
}

export function nullableUuidField(o: Obj, key: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (!isUuid(v)) throw fieldError(key);
  return v.toLowerCase();
}

function optionalBoolean(o: Obj, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw fieldError(key);
  return v;
}

function requiredBoolean(o: Obj, key: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw fieldError(key);
  return v;
}

function integerField(o: Obj, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw fieldError(key);
  return v;
}

/** 原因：trim 後不可為空（第二十二、二十四節「原因必填」） */
export function reasonField(o: Obj, key = "reason"): string {
  const v = o[key];
  if (v !== undefined && v !== null && typeof v !== "string") throw fieldError(key);
  const trimmed = typeof v === "string" ? v.trim() : "";
  if (trimmed === "") throw reasonRequired();
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw badRequest(`原因太長（最多 ${MAX_REASON_LENGTH} 字）。`);
  }
  return trimmed;
}

/** ISO 時間字串 → 正規化 ISO（UTC）；必須帶時區 */
export function isoField(o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || !ISO_WITH_ZONE_RE.test(v.trim())) throw fieldError(key);
  const ms = Date.parse(v.trim());
  if (!Number.isFinite(ms)) throw fieldError(key);
  return new Date(ms).toISOString();
}

export function isIsoWithZone(v: string): boolean {
  return ISO_WITH_ZONE_RE.test(v.trim()) && Number.isFinite(Date.parse(v.trim()));
}

function checkActionField(o: Obj, key = "action"): CheckAction {
  const v = o[key];
  if (typeof v !== "string" || !(CHECK_ACTIONS as readonly string[]).includes(v)) throw fieldError(key);
  return v as CheckAction;
}

export function isStationAction(a: CheckAction): boolean {
  return a === "station_check_in" || a === "station_check_out";
}

export function isTeamAction(a: CheckAction): boolean {
  return a === "team_check_in" || a === "team_check_out";
}

export function isGameCode(v: unknown): v is GameCode {
  return v === "gold" || v === "land";
}

// ---------------------------------------------------------------------
// client_info（第六節：簡短裝置資訊，不存 IP）
// ---------------------------------------------------------------------

const CLIENT_INFO_KEYS = ["ua", "platform", "deviceTime", "screen"] as const;
const CLIENT_INFO_MAX = { ua: 300, platform: 60, deviceTime: 40, screen: 30 } as const;

/** 只保留合約欄位並截斷長度；格式不對就丟掉（client_info 只供參考，不因此拒絕打卡） */
export function sanitizeClientInfo(raw: unknown, fallbackUa?: string | null): ClientInfo {
  const out: ClientInfo = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const r = raw as Obj;
    for (const k of CLIENT_INFO_KEYS) {
      const v = r[k];
      if (typeof v === "string" && v.trim() !== "") out[k] = v.trim().slice(0, CLIENT_INFO_MAX[k]);
    }
  }
  if (!out.ua && fallbackUa) out.ua = fallbackUa.slice(0, CLIENT_INFO_MAX.ua);
  return out;
}

// ---------------------------------------------------------------------
// 登入 / 打卡 / 撤銷 / 通知
// ---------------------------------------------------------------------

export function parseLoginRequest(body: unknown): LoginRequest {
  const o = asObject(body);
  const identityId = uuidField(o, "identityId");
  const pin = o.pin;
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    throw badRequest(`請輸入 ${PIN_LENGTH} 位數字 PIN。`);
  }
  return { identityId, pin };
}

/** POST /api/check（第二十一節）。權限（STATION/TEAM/ADMIN）另外在 route 用 session 比對。 */
export function parseCheckRequest(body: unknown): CheckRequest {
  const o = asObject(body);
  const clientRequestId = uuidField(o, "clientRequestId");
  const assignmentId = uuidField(o, "assignmentId");
  const action = checkActionField(o);
  const teamId = nullableUuidField(o, "teamId");
  const noShow = optionalBoolean(o, "noShow") ?? false;
  const singleTeamOverride = optionalBoolean(o, "singleTeamOverride") ?? false;

  if (isStationAction(action) && teamId !== null) {
    throw badRequest("關主側動作不可指定隊伍（teamId 必須為 null）。");
  }
  if (isTeamAction(action) && teamId === null) {
    throw badRequest("隊輔側動作必須指定隊伍（teamId）。");
  }
  if (noShow && action !== "station_check_out") {
    throw badRequest("「本隊未到」只能用在確認出關。");
  }

  let confirmedTeamIds: string[] | undefined;
  if (o.confirmedTeamIds !== undefined && o.confirmedTeamIds !== null) {
    if (action !== "station_check_in") throw fieldError("confirmedTeamIds");
    const arr = o.confirmedTeamIds;
    if (!Array.isArray(arr) || arr.length > 2 || !arr.every(isUuid)) throw fieldError("confirmedTeamIds");
    const lowered = (arr as string[]).map((s) => s.toLowerCase());
    if (new Set(lowered).size !== lowered.length) throw fieldError("confirmedTeamIds");
    confirmedTeamIds = lowered;
  }

  let reason: string | undefined;
  if (singleTeamOverride) {
    if (action !== "station_check_in") throw badRequest("單隊開始只能用在開始（確認進關）。");
    reason = reasonField(o);
  } else if (typeof o.reason === "string" && o.reason.trim() !== "") {
    reason = o.reason.trim().slice(0, MAX_REASON_LENGTH);
  }

  return {
    clientRequestId: clientRequestId,
    assignmentId,
    action,
    teamId,
    noShow,
    confirmedTeamIds,
    singleTeamOverride,
    reason,
    clientInfo: sanitizeClientInfo(o.clientInfo),
  };
}

export function parseUndoRequest(body: unknown): UndoRequest {
  const o = asObject(body);
  return { recordId: uuidField(o, "recordId"), clientInfo: sanitizeClientInfo(o.clientInfo) };
}

export function parseNotificationCheckRequest(body: unknown): NotificationCheckRequest {
  const o = asObject(body);
  const kind = o.kind;
  if (typeof kind !== "string" || !(DERIVED_KINDS as readonly string[]).includes(kind)) {
    throw fieldError("kind");
  }
  const subkind = o.subkind;
  if (subkind !== null && subkind !== undefined && (typeof subkind !== "string" || subkind.length > 64)) {
    throw fieldError("subkind");
  }
  const assignmentId = nullableUuidField(o, "assignmentId");
  // 推導型通知一定掛在某個 assignment 上（server 由它找出遊戲）
  if (assignmentId === null) throw fieldError("assignmentId");
  return {
    kind: kind as NotificationKind,
    subkind: typeof subkind === "string" && subkind !== "" ? subkind : null,
    assignmentId,
    teamId: nullableUuidField(o, "teamId"),
  };
}

// ---------------------------------------------------------------------
// Admin：紀錄修正（第二十二節）
// ---------------------------------------------------------------------

export function parseAdminVoidRecord(body: unknown): AdminVoidRecordRequest {
  const o = asObject(body);
  return { recordId: uuidField(o, "recordId"), reason: reasonField(o) };
}

export function parseAdminCorrectRecord(body: unknown): AdminCorrectRecordRequest {
  const o = asObject(body);
  return { recordId: uuidField(o, "recordId"), recordedAt: isoField(o, "recordedAt"), reason: reasonField(o) };
}

export function parseAdminAddRecord(body: unknown): AdminAddRecordRequest {
  const o = asObject(body);
  const assignmentId = uuidField(o, "assignmentId");
  const action = checkActionField(o);
  const teamId = nullableUuidField(o, "teamId");
  const noShow = optionalBoolean(o, "noShow") ?? false;
  if (isStationAction(action) && teamId !== null) throw badRequest("關主側紀錄不可指定隊伍。");
  if (isTeamAction(action) && teamId === null) throw badRequest("隊輔側紀錄必須指定隊伍。");
  if (noShow && action !== "station_check_out") throw badRequest("「本隊未到」只能用在確認出關。");
  return { assignmentId, action, teamId, recordedAt: isoField(o, "recordedAt"), noShow, reason: reasonField(o) };
}

export function parseAdminForceEnd(body: unknown): AdminForceEndRequest {
  const o = asObject(body);
  return { assignmentId: uuidField(o, "assignmentId"), reason: reasonField(o) };
}

// ---------------------------------------------------------------------
// Admin：延後／取消／延長（第二十四節、第二十四之二節）
// ---------------------------------------------------------------------

export function parseAdminAdjust(body: unknown): AdminAdjustRequest {
  const o = asObject(body);
  const gameId = uuidField(o, "gameId");
  const fromSlotNumber = integerField(o, "fromSlotNumber", 1, 100);
  const mode = o.mode;
  if (mode === "DELAY") {
    const offsetMinutes = integerField(o, "offsetMinutes", -MAX_ADJUST_MINUTES, MAX_ADJUST_MINUTES);
    if (offsetMinutes === 0) throw new ApiHttpError(400, "ADJUST_INVALID");
    return { gameId, fromSlotNumber, mode, offsetMinutes, reason: reasonField(o) };
  }
  if (mode === "START_AT") {
    const startAt = o.startAt;
    if (typeof startAt !== "string" || parseTimeOfDay(startAt) === null) throw fieldError("startAt");
    return { gameId, fromSlotNumber, mode, startAt: startAt.trim(), reason: reasonField(o) };
  }
  throw fieldError("mode");
}

export function parseAdminVoidLastAdjustment(body: unknown): AdminVoidLastAdjustmentRequest {
  const o = asObject(body);
  return { gameId: uuidField(o, "gameId"), reason: reasonField(o) };
}

export function parseAdminCancel(body: unknown): AdminCancelRequest {
  const o = asObject(body);
  const reason = reasonField(o);
  if (o.assignmentIds !== undefined && o.assignmentIds !== null) {
    const arr = o.assignmentIds;
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 100 || !arr.every(isUuid)) {
      throw fieldError("assignmentIds");
    }
    if (o.stationId !== undefined || o.fromSlotNumber !== undefined) {
      throw badRequest("assignmentIds 與 stationId/fromSlotNumber 只能擇一。");
    }
    const ids = Array.from(new Set((arr as string[]).map((s) => s.toLowerCase())));
    return { assignmentIds: ids, reason };
  }
  const stationId = uuidField(o, "stationId");
  const fromSlotNumber = integerField(o, "fromSlotNumber", 1, 100);
  return { stationId, fromSlotNumber, reason };
}

export function parseAdminVoidCancellation(body: unknown): AdminVoidCancellationRequest {
  const o = asObject(body);
  return { cancellationId: uuidField(o, "cancellationId"), reason: reasonField(o) };
}

export type EndOverrideMode =
  | { kind: "official_end"; officialEnd: string }
  | { kind: "extend"; extendMinutes: number }
  | { kind: "full_duration" };

export function parseAdminEndOverride(body: unknown): AdminEndOverrideRequest & { modeParsed: EndOverrideMode } {
  const o = asObject(body);
  const assignmentId = uuidField(o, "assignmentId");
  const reason = reasonField(o);
  const hasOfficial = o.officialEnd !== undefined && o.officialEnd !== null;
  const hasExtend = o.extendMinutes !== undefined && o.extendMinutes !== null;
  const hasFull = o.fullDuration === true;
  if (o.fullDuration !== undefined && o.fullDuration !== null && typeof o.fullDuration !== "boolean") {
    throw fieldError("fullDuration");
  }
  const count = Number(hasOfficial) + Number(hasExtend) + Number(hasFull);
  if (count !== 1) throw badRequest("請指定一種延長方式（結束時間、延長分鐘數或以完整關卡時間重新計）。");
  if (hasOfficial) {
    const officialEnd = isoField(o, "officialEnd");
    return { assignmentId, officialEnd, reason, modeParsed: { kind: "official_end", officialEnd } };
  }
  if (hasExtend) {
    const extendMinutes = integerField(o, "extendMinutes", 1, MAX_EXTEND_MINUTES);
    return { assignmentId, extendMinutes, reason, modeParsed: { kind: "extend", extendMinutes } };
  }
  return { assignmentId, fullDuration: true, reason, modeParsed: { kind: "full_duration" } };
}

export function parseAdminVoidEndOverride(body: unknown): AdminVoidEndOverrideRequest {
  const o = asObject(body);
  return { overrideId: uuidField(o, "overrideId"), reason: reasonField(o) };
}

// ---------------------------------------------------------------------
// Admin：設定 / Demo / Reset / PIN
// ---------------------------------------------------------------------

export function parseAdminGameSettings(body: unknown): AdminGameSettingsRequest {
  const o = asObject(body);
  const gameId = uuidField(o, "gameId");
  const endPolicy = o.endPolicy;
  if (typeof endPolicy !== "string" || !(END_POLICIES as readonly string[]).includes(endPolicy)) {
    throw fieldError("endPolicy");
  }
  const minPlaySeconds = integerField(o, "minPlaySeconds", 0, 3600);
  return { gameId, endPolicy: endPolicy as EndPolicy, minPlaySeconds };
}

function optionalLabel(o: Obj, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw fieldError(key);
  const t = v.trim();
  if (t === "" || t.length > MAX_LABEL_LENGTH) throw badRequest(`名稱不可空白，且最多 ${MAX_LABEL_LENGTH} 字。`);
  return t;
}

export function parseAdminEventSettings(body: unknown): AdminEventSettingsRequest {
  const o = asObject(body);
  let eventDate: string | undefined;
  if (o.eventDate !== undefined && o.eventDate !== null) {
    if (typeof o.eventDate !== "string" || !isValidDateString(o.eventDate)) throw fieldError("eventDate");
    eventDate = o.eventDate;
  }
  const out: AdminEventSettingsRequest = {
    eventDate,
    teamGroupLabel: optionalLabel(o, "teamGroupLabel"),
    stationGroupLabel: optionalLabel(o, "stationGroupLabel"),
    leadTitle: optionalLabel(o, "leadTitle"),
  };
  if (Object.values(out).every((v) => v === undefined)) throw badRequest("沒有要修改的設定。");
  return out;
}

export function parseAdminClock(body: unknown): AdminClockRequest {
  const o = asObject(body);
  const enabled = requiredBoolean(o, "enabled");
  const speed = o.speed;
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0 || speed > 100) {
    throw fieldError("speed");
  }
  let jumpTo: string | null = null;
  if (o.jumpTo !== undefined && o.jumpTo !== null && o.jumpTo !== "") {
    if (typeof o.jumpTo !== "string") throw fieldError("jumpTo");
    const t = o.jumpTo.trim();
    if (parseTimeOfDay(t) === null && !isIsoWithZone(t)) throw fieldError("jumpTo");
    jumpTo = t;
  }
  return { enabled, speed, jumpTo };
}

export const RESET_CONFIRM_TEXT = "RESET";

export function parseAdminReset(body: unknown): AdminResetRequest {
  const o = asObject(body);
  const gameCode = o.gameCode;
  if (gameCode !== "all" && !isGameCode(gameCode)) throw fieldError("gameCode");
  if (typeof o.confirmText !== "string") throw new ApiHttpError(400, "RESET_CONFIRM_MISMATCH");
  // 確認字必須完全相同（第二十五節）
  if (o.confirmText !== RESET_CONFIRM_TEXT) throw new ApiHttpError(400, "RESET_CONFIRM_MISMATCH");
  return { gameCode, confirmText: o.confirmText };
}

export function parseAdminResetPins(body: unknown): AdminResetPinsRequest {
  const o = asObject(body);
  const identityId = optionalUuidField(o, "identityId");
  const all = optionalBoolean(o, "all") ?? false;
  if ((identityId === undefined) === !all) {
    throw badRequest("請指定一個身分，或選擇重設全部 PIN。");
  }
  let pin: string | undefined;
  if (o.pin !== undefined && o.pin !== null && o.pin !== "") {
    if (typeof o.pin !== "string" || !PIN_RE.test(o.pin)) throw badRequest(`PIN 必須是 ${PIN_LENGTH} 位數字。`);
    if (all) throw badRequest("重設全部 PIN 時不能指定同一組 PIN。");
    pin = o.pin;
  }
  return all ? { all: true } : { identityId, pin };
}

/** GET query：正整數，超出範圍則夾住 */
export function clampIntParam(raw: string | null, def: number, min: number, max: number): number {
  if (raw === null || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
