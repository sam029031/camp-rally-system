/**
 * [admin-b] 管理頁（打卡紀錄／異常／PIN／Audit／匯出）共用的純函式。
 * 不含 React；時間一律 Asia/Taipei（src/lib/time.ts）。
 */

import type { AdminAuditLogsResponse, ApiError } from "@/lib/api/contract";
import { errorMessage } from "@/lib/errors";
import { actionLabelWithSide, recordActionLabel, slotLabel, teamName } from "@/lib/labels";
import { formatHms, msToTaipeiDate, taipeiLocalToMs } from "@/lib/time";
import type {
  Assignment,
  CheckAction,
  CheckRecord,
  GameCode,
  GameSnapshot,
  Slot,
  Station,
  Team,
} from "@/lib/types";

// ---------------------------------------------------------------------
// 快照索引
// ---------------------------------------------------------------------

export interface SnapIndex {
  slotById: Map<string, Slot>;
  stationById: Map<string, Station>;
  teamById: Map<string, Team>;
  assignmentById: Map<string, Assignment>;
  recordById: Map<string, CheckRecord>;
  /** 原紀錄 id → 取代它的修正紀錄（replaces_record_id） */
  replacedBy: Map<string, CheckRecord>;
  /** `${slotId}|${stationId}` → assignment */
  assignmentBySlotStation: Map<string, Assignment>;
  isPk: boolean;
}

export function buildSnapIndex(snap: GameSnapshot): SnapIndex {
  const replacedBy = new Map<string, CheckRecord>();
  for (const r of snap.records) if (r.replacesRecordId) replacedBy.set(r.replacesRecordId, r);
  return {
    slotById: new Map(snap.slots.map((s) => [s.id, s])),
    stationById: new Map(snap.stations.map((s) => [s.id, s])),
    teamById: new Map(snap.teams.map((t) => [t.id, t])),
    assignmentById: new Map(snap.assignments.map((a) => [a.id, a])),
    recordById: new Map(snap.records.map((r) => [r.id, r])),
    replacedBy,
    assignmentBySlotStation: new Map(snap.assignments.map((a) => [`${a.slotId}|${a.stationId}`, a])),
    isPk: snap.game.teamsPerStation === 2,
  };
}

/** 隊名（找不到時回傳空字串） */
export function teamText(ix: SnapIndex, teamId: string | null | undefined, short = false): string {
  if (!teamId) return "";
  const t = ix.teamById.get(teamId);
  return t ? teamName(t, { short }) : "";
}

/** 一個場次的隊伍文字：黃金「第2小隊」、大地「第2隊 vs 第4隊」 */
export function assignmentTeamsText(ix: SnapIndex, a: Assignment | null | undefined): string {
  if (!a) return "";
  if (!a.teamBId) return teamText(ix, a.teamAId);
  return `${teamText(ix, a.teamAId, true)} vs ${teamText(ix, a.teamBId, true)}`;
}

/** 場次的完整描述：「第3時段 九九乘法 第2小隊」 */
export function assignmentText(ix: SnapIndex, a: Assignment | null | undefined): string {
  if (!a) return "（找不到場次）";
  const slot = ix.slotById.get(a.slotId);
  const station = ix.stationById.get(a.stationId);
  return [slot ? slotLabel(slot.number) : "", station?.name ?? "", assignmentTeamsText(ix, a)].filter(Boolean).join(" ");
}

/** 動作文字：關主確認進關／關主確認出關／隊輔確認進關／隊輔確認出關／本隊未到（大地：本場未進行） */
export function recordActionText(r: Pick<CheckRecord, "action" | "noShow" | "source">, isPk: boolean): string {
  if (r.action === "station_check_out" && r.noShow) return recordActionLabel(r, { pk: isPk });
  return actionLabelWithSide(r.action);
}

/** 是否為關主側動作 */
export function isStationAction(action: CheckAction): boolean {
  return action === "station_check_in" || action === "station_check_out";
}

/** 撤銷原因文字（現場撤銷存成 SELF_UNDO） */
export function voidReasonText(reason: string | null): string {
  if (reason === "SELF_UNDO") return "現場撤銷（本人 1 分鐘內撤銷）";
  return reason ?? "";
}

// ---------------------------------------------------------------------
// 時間輸入（管理員指定 HH:mm:ss，Asia/Taipei）
// ---------------------------------------------------------------------

const HMS_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** <input type="time" step="1"> 的值（'HH:mm' 或 'HH:mm:ss'）→ 'HH:mm:ss'；格式錯誤回 null */
export function normalizeHms(value: string): string | null {
  const m = HMS_RE.exec(value.trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

/**
 * 以某個參考時刻（原紀錄時間或時段開始）的 Asia/Taipei 日期 + 管理員輸入的 HH:mm:ss 組成 epoch ms。
 * 用參考時刻的日期（而不是瀏覽器的日期），活動日跨時區、Demo 時鐘都不會算錯。
 */
export function hmsOnSameTaipeiDate(referenceMs: number, hms: string): number | null {
  const norm = normalizeHms(hms);
  if (!norm) return null;
  try {
    return taipeiLocalToMs(msToTaipeiDate(referenceMs), norm);
  } catch {
    return null;
  }
}

/** 'YYYY-MM-DD HH:mm:ss'（Asia/Taipei） */
export function formatDateTime(ms: number): string {
  return `${msToTaipeiDate(ms)} ${formatHms(ms)}`;
}

/** DB timestamptz 字串 → epoch ms（無效回 null） */
export function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------
// 連結
// ---------------------------------------------------------------------

export function stationHref(gameCode: GameCode, stationCode: string): string {
  return `/station/${gameCode}/${encodeURIComponent(stationCode)}`;
}

export function teamHref(teamCode: string): string {
  return `/team?team=${encodeURIComponent(teamCode)}`;
}

// ---------------------------------------------------------------------
// API 錯誤
// ---------------------------------------------------------------------

/** server 回傳的中文訊息（沒有就用 error code 對應的提示） */
export function apiErrorText(err: Pick<ApiError, "code" | "message">): string {
  return err.message && err.message.trim() ? err.message : errorMessage(err.code);
}

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------

/** GET /api/admin/audit-logs 的一筆 */
export type AuditLogItem = Extract<AdminAuditLogsResponse, { ok: true }>["logs"][number];

/** Audit action 的中文名稱（docs/ARCHITECTURE.md 第 4 節的固定名稱） */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  CHECK_RECORDED: "打卡",
  REJECTED_CHECK: "被拒絕的打卡",
  DUPLICATE_ATTEMPT: "重複打卡嘗試",
  SELF_UNDO: "現場撤銷",
  ADMIN_VOID: "總召撤銷紀錄",
  ADMIN_CORRECT: "總召修正時間",
  ADMIN_ADD: "總召補登",
  ADMIN_FORCE_END: "強制結束",
  NO_SHOW: "本隊未到",
  SINGLE_TEAM_START: "大地單隊開始",
  LOGIN_FAILED: "登入失敗",
  PIN_CHANGED: "PIN 修改",
  SCHEDULE_ADJUSTED: "延後／提前排程",
  SCHEDULE_ADJUSTMENT_VOIDED: "撤銷排程調整",
  ASSIGNMENT_CANCELLED: "關卡取消",
  CANCELLATION_VOIDED: "撤銷關卡取消",
  END_OVERRIDE_SET: "延長時間",
  END_OVERRIDE_VOIDED: "撤銷延長",
  GAME_SETTINGS: "遊戲設定",
  EVENT_SETTINGS: "活動設定",
  DEMO_SETTINGS: "Demo 設定",
  RESET: "Reset Demo Data",
  IMPORT: "匯入排程",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

const CHECK_ACTIONS: readonly CheckAction[] = ["station_check_in", "station_check_out", "team_check_in", "team_check_out"];

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(x: unknown): string | null {
  return typeof x === "string" && x !== "" ? x : null;
}

/** audit before/after 內與打卡有關的欄位（REJECTED_CHECK、DUPLICATE_ATTEMPT、SELF_UNDO、ADMIN_* 等） */
export interface AuditCheckInfo {
  assignmentId: string | null;
  action: CheckAction | null;
  teamId: string | null;
  noShow: boolean;
  /** REJECTED_CHECK 的 error code */
  code: string | null;
  recordedAt: number | null;
}

export function auditCheckInfo(before: unknown, after: unknown, targetTable: string | null, targetId: string | null): AuditCheckInfo {
  const a = asRecord(after);
  const b = asRecord(before);
  const pick = (k: string): unknown => (a && a[k] !== undefined && a[k] !== null ? a[k] : b ? b[k] : undefined);
  const actionRaw = str(pick("action"));
  const action = actionRaw && (CHECK_ACTIONS as readonly string[]).includes(actionRaw) ? (actionRaw as CheckAction) : null;
  let assignmentId = str(pick("assignment_id"));
  if (!assignmentId && targetTable === "assignments") assignmentId = targetId;
  return {
    assignmentId,
    action,
    teamId: str(pick("team_id")),
    noShow: pick("no_show") === true,
    code: str(a?.code),
    recordedAt: parseIso(str(pick("recorded_at"))),
  };
}

/** audit 目標的中文描述（有對應場次時：「第3時段 九九乘法 第2小隊 隊輔確認進關」） */
export function describeAuditTarget(
  ix: SnapIndex | null,
  info: AuditCheckInfo,
): string | null {
  if (!ix || !info.assignmentId) return null;
  const a = ix.assignmentById.get(info.assignmentId);
  if (!a) return null;
  const parts = [assignmentText(ix, a)];
  if (info.action) {
    const act = recordActionText({ action: info.action, noShow: info.noShow, source: "ui" }, ix.isPk);
    const who = info.teamId && a.teamBId ? `${teamText(ix, info.teamId)} ` : "";
    parts.push(`${who}${act}`);
  }
  return parts.join(" ");
}

/** JSON 顯示（before / after） */
export function prettyJson(x: unknown): string {
  if (x === null || x === undefined) return "（無）";
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}
