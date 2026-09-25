/**
 * 資料庫測試共用：service role client、RPC 包裝（參數名稱與 src/lib/server/* 完全相同）、
 * 測試活動的模擬時鐘、快照＋推導、與 /api/notifications/check 相同的建立通知流程。
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadGameSnapshot } from "@/lib/data/snapshot";
import { deriveGame, findCondition } from "@/lib/derive";
import type { DerivedGame, NotificationCondition } from "@/lib/derive/types";
import { buildConditionMessage } from "@/lib/notifications/messages";
import { taipeiLocalToMs } from "@/lib/time";
import type { CheckAction, CheckRecordRow, GameSnapshot, NotificationKind, NotificationRow, RecordSource } from "@/lib/types";
import type { DbTestEnv } from "./env";

export function createServiceClient(env: DbTestEnv): SupabaseClient {
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "camp-rally-db-tests" } },
  });
}

export function createAnonClient(env: DbTestEnv): SupabaseClient | null {
  if (!env.anonKey) return null;
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** 呼叫 RPC；SQL 錯誤一律 throw（規則拒絕是正常回傳 {status:'rejected'}） */
export async function rpc<T = unknown>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`RPC ${fn} 失敗：${[error.code, error.message, error.details].filter(Boolean).join(" | ")}`);
  return data as T;
}

/** supabase-js 查詢結果：有錯誤就 throw */
export async function must<T>(what: string, q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${what} 失敗：${error.message}`);
  return data as T;
}

// =====================================================================
// record_check / undo / 其他 RPC
// =====================================================================

export type CheckStatus = "created" | "existing" | "already_recorded" | "rejected";

export interface CheckResult {
  status: CheckStatus;
  code?: string;
  record?: CheckRecordRow;
  voided?: boolean;
}

export interface CheckArgs {
  assignmentId: string;
  action: CheckAction;
  teamId?: string | null;
  identityId: string;
  /** 省略時自動產生（每次按下一個新的 client_request_id） */
  clientRequestId?: string;
  source?: RecordSource;
  recordedAt?: string | null;
  noShow?: boolean;
  confirmedTeamIds?: string[] | null;
  singleTeamOverride?: boolean;
  reason?: string | null;
}

/** 與 src/lib/server/check.ts 相同的具名參數 */
export function recordCheck(client: SupabaseClient, a: CheckArgs): Promise<CheckResult> {
  return rpc<CheckResult>(client, "record_check", {
    p_client_request_id: a.clientRequestId ?? randomUUID(),
    p_assignment_id: a.assignmentId,
    p_action: a.action,
    p_team_id: a.teamId ?? null,
    p_identity_id: a.identityId,
    p_source: a.source ?? "ui",
    p_recorded_at: a.recordedAt ?? null,
    p_no_show: a.noShow ?? false,
    p_confirmed_team_ids: a.confirmedTeamIds && a.confirmedTeamIds.length > 0 ? a.confirmedTeamIds : null,
    p_single_team_override: a.singleTeamOverride ?? false,
    p_reason: a.reason ?? null,
    p_client_info: { device: "vitest-db" },
  });
}

/** 期待 created，否則丟出含 code 的錯誤（讓失敗訊息直接看得出原因） */
export async function checkCreated(client: SupabaseClient, a: CheckArgs): Promise<CheckRecordRow> {
  const r = await recordCheck(client, a);
  if (r.status !== "created" || !r.record) {
    throw new Error(`record_check(${a.action}) 預期 created，實際 ${r.status}${r.code ? `（${r.code}）` : ""}`);
  }
  return r.record;
}

export interface StatusResult {
  status: string;
  code?: string;
  record?: CheckRecordRow;
  [key: string]: unknown;
}

export function undoCheck(client: SupabaseClient, recordId: string, identityId: string): Promise<StatusResult> {
  return rpc<StatusResult>(client, "undo_check", {
    p_record_id: recordId,
    p_identity_id: identityId,
    p_client_info: { device: "vitest-db" },
  });
}

export function adminVoidRecord(
  client: SupabaseClient,
  recordId: string,
  identityId: string,
  reason: string,
): Promise<StatusResult> {
  return rpc<StatusResult>(client, "admin_void_record", {
    p_record_id: recordId,
    p_identity_id: identityId,
    p_reason: reason,
    p_client_info: null,
  });
}

// =====================================================================
// 模擬時鐘（只改測試活動；is_active = false，不影響正式活動）
// =====================================================================

interface ClockRow {
  server_now: string;
  app_now: string;
}

export async function getClock(client: SupabaseClient, eventId: string | null): Promise<ClockRow> {
  const data = await rpc<ClockRow | ClockRow[]>(client, "get_clock", { p_event_id: eventId });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.server_now !== "string") throw new Error(`get_clock 回傳格式不正確：${JSON.stringify(data)}`);
  return row;
}

/** DB 的真實時間（clock_timestamp()） */
export async function serverNowMs(client: SupabaseClient): Promise<number> {
  return Date.parse((await getClock(client, null)).server_now);
}

/** 測試活動的 app_now_for_event（epoch ms） */
export async function appNowMs(client: SupabaseClient, eventId: string): Promise<number> {
  return Date.parse((await getClock(client, eventId)).app_now);
}

/**
 * 把測試活動的模擬時間設到 eventDate 的台北時間 time（'HH:mm' 或 'HH:mm:ss'）：
 * sim_anchor_real = DB 的 now()、sim_anchor_virtual = 目標時刻、sim_speed = speed。
 * 回傳目標時刻（epoch ms）。
 */
export async function setAppTime(
  client: SupabaseClient,
  eventId: string,
  eventDate: string,
  time: string,
  speed = 1,
): Promise<number> {
  const target = taipeiLocalToMs(eventDate, time);
  const { server_now } = await getClock(client, null);
  await must(
    "設定測試活動時鐘",
    client
      .from("events")
      .update({
        sim_enabled: true,
        sim_speed: speed,
        sim_anchor_real: server_now,
        sim_anchor_virtual: new Date(target).toISOString(),
      })
      .eq("id", eventId)
      .eq("is_active", false)
      .select("id"),
  );
  return target;
}

/** 把一筆紀錄的 real_created_at 設為「DB 現在 − seconds 秒」（測現場撤銷的真實時間視窗） */
export async function backdateRealCreatedAt(client: SupabaseClient, recordId: string, seconds: number): Promise<void> {
  const now = await serverNowMs(client);
  await must(
    "調整 real_created_at",
    client
      .from("check_records")
      .update({ real_created_at: new Date(now - seconds * 1000).toISOString() })
      .eq("id", recordId)
      .select("id"),
  );
}

// =====================================================================
// 快照與推導（和 server 一樣：service client + {gameId} + get_clock 的 app_now）
// =====================================================================

export interface Derived {
  snap: GameSnapshot;
  d: DerivedGame;
  now: number;
}

export async function derive(client: SupabaseClient, gameId: string): Promise<Derived> {
  const snap = await loadGameSnapshot(client, { gameId });
  const now = await appNowMs(client, snap.event.id);
  return { snap, d: deriveGame(snap, now), now };
}

export interface NotifyRequest {
  kind: NotificationKind;
  subkind?: string | null;
  assignmentId: string;
  teamId?: string | null;
}

export interface NotifyResult {
  result: "created" | "exists" | "not_yet";
  notification: NotificationRow | null;
  condition: NotificationCondition | null;
}

/**
 * 與 POST /api/notifications/check 相同的 server 流程：
 * 重抓快照 → get_clock → deriveGame → findCondition → buildConditionMessage → create_notification。
 */
export async function notifyLikeRoute(client: SupabaseClient, gameId: string, req: NotifyRequest): Promise<NotifyResult> {
  const { snap, d } = await derive(client, gameId);
  const condition = findCondition(d, {
    kind: req.kind,
    subkind: req.subkind ?? null,
    assignmentId: req.assignmentId,
    teamId: req.teamId ?? null,
  });
  if (!condition) return { result: "not_yet", notification: null, condition: null };
  const data = await rpc<{ result: "created" | "exists"; notification: NotificationRow | null }>(
    client,
    "create_notification",
    {
      p_kind: condition.kind,
      p_subkind: condition.subkind,
      p_game_id: gameId,
      p_assignment_id: condition.assignmentId,
      p_team_id: condition.teamId,
      p_trigger_record_id: condition.triggerRecordId,
      p_trigger_override_id: condition.triggerOverrideId,
      p_message: buildConditionMessage(condition, snap, d),
    },
  );
  if (data.result !== "created" && data.result !== "exists") {
    throw new Error(`create_notification 未預期的回傳：${JSON.stringify(data)}`);
  }
  return { result: data.result, notification: data.notification, condition };
}

// =====================================================================
// 查詢
// =====================================================================

export async function validRecords(
  client: SupabaseClient,
  assignmentId: string,
  action: CheckAction,
  teamId: string | null = null,
): Promise<CheckRecordRow[]> {
  let q = client
    .from("check_records")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("action", action)
    .is("voided_at", null);
  q = teamId === null ? q.is("team_id", null) : q.eq("team_id", teamId);
  return must<CheckRecordRow[]>("讀取 check_records", q);
}

export async function notificationsOf(client: SupabaseClient, gameId: string): Promise<NotificationRow[]> {
  return must<NotificationRow[]>(
    "讀取 notifications",
    client.from("notifications").select("*").eq("game_id", gameId).order("real_created_at"),
  );
}

/** count(*)；filter 由呼叫端加 */
export async function countRows(
  client: SupabaseClient,
  table: string,
  filter: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await filter(client.from(table).select("id", { count: "exact", head: true }));
  if (error) throw new Error(`count ${table} 失敗：${error.message}`);
  return count ?? 0;
}
