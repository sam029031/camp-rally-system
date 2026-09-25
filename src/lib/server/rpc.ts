import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMessage, isErrorCode, type ErrorCode } from "@/lib/errors";
import type { CheckRecordRow } from "@/lib/types";
import { ApiHttpError } from "@/lib/server/errors";
import { parseDbTimestamp } from "@/lib/server/time-input";

/**
 * RPC 呼叫與結果解析（ARCHITECTURE 第 4 節）。
 * 規則拒絕一律是 return { status:'rejected', code }（不 raise）；真正的 SQL 錯誤才會是 error → 500。
 */

export class RpcFailure extends Error {
  constructor(
    readonly fn: string,
    readonly detail: unknown,
  ) {
    super(`RPC ${fn} 失敗：${describe(detail)}`);
    this.name = "RpcFailure";
  }
}

function describe(detail: unknown): string {
  if (detail && typeof detail === "object") {
    const d = detail as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    return [d.code, d.message, d.details, d.hint].filter((x) => typeof x === "string" && x !== "").join(" | ");
  }
  return String(detail);
}

export async function callRpc<T = unknown>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new RpcFailure(fn, error);
  return data as T;
}

/** 大部分寫入 RPC 的回傳形狀 */
export interface RpcStatusResult {
  status?: string;
  code?: string | null;
  record?: CheckRecordRow | null;
  [key: string]: unknown;
}

export function asStatusResult(fn: string, data: unknown): RpcStatusResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new RpcFailure(fn, `回傳格式不正確：${JSON.stringify(data)}`);
  }
  return data as RpcStatusResult;
}

/** RPC 回傳的 code → HTTP status（規則拒絕 409；權限 403） */
export function statusForRejectedCode(code: ErrorCode): number {
  switch (code) {
    case "FORBIDDEN":
      return 403;
    case "REASON_REQUIRED":
    case "INVALID_REQUEST":
    case "INVALID_ACTION":
      return 400;
    default:
      return 409;
  }
}

/** status = 'rejected' → 丟 ApiHttpError（message 用中文提示；可覆寫） */
export function throwIfRejected(
  fn: string,
  r: RpcStatusResult,
  messageFor?: (code: ErrorCode) => string | undefined,
): void {
  if (r.status !== "rejected") return;
  const raw = typeof r.code === "string" ? r.code : null;
  if (!raw || !isErrorCode(raw)) {
    console.error(`[rpc] ${fn} 回傳未知的拒絕代碼`, r.code);
    throw new ApiHttpError(409, "INTERNAL_ERROR", errorMessage(raw));
  }
  throw new ApiHttpError(statusForRejectedCode(raw), raw, messageFor?.(raw) ?? errorMessage(raw), {
    record: r.record ?? undefined,
  });
}

/** 從 RPC 回傳中取出 id：先找頂層 key，再找巢狀物件的 id */
export function pickId(r: RpcStatusResult, keys: string[], nested: string[] = []): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v !== "") return v;
  }
  for (const n of nested) {
    const obj = r[n];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const id = (obj as Record<string, unknown>).id;
      if (typeof id === "string" && id !== "") return id;
    }
  }
  return null;
}

/** 從 RPC 回傳中取出 id 陣列（例如 cancellation_ids 或 cancellations[].id） */
export function pickIds(r: RpcStatusResult, keys: string[], nested: string[] = []): string[] {
  for (const k of keys) {
    const v = r[k];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  }
  for (const n of nested) {
    const arr = r[n];
    if (Array.isArray(arr)) {
      const ids = arr
        .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>).id : null))
        .filter((x): x is string => typeof x === "string");
      if (ids.length > 0) return ids;
    }
  }
  return [];
}

/** 呼叫 get_clock(p_event_id) 取 app 時間（ARCHITECTURE 第 2 節：server 不可用 Date.now() 當 app 時間） */
export async function getAppNow(client: SupabaseClient, eventId: string | null): Promise<number> {
  const data = await callRpc<unknown>(client, "get_clock", { p_event_id: eventId });
  const row = Array.isArray(data) ? data[0] : data;
  const appNow =
    row && typeof row === "object" ? parseDbTimestamp((row as Record<string, unknown>).app_now) : null;
  if (appNow === null) throw new RpcFailure("get_clock", `回傳沒有 app_now：${JSON.stringify(data)}`);
  return appNow;
}
