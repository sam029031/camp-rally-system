import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow } from "@/lib/types";
import { getActiveEvent } from "@/lib/server/db";
import { ApiHttpError } from "@/lib/server/errors";
import { asStatusResult, callRpc, throwIfRejected, type RpcStatusResult } from "@/lib/server/rpc";

/** 管理類 RPC：呼叫 → 解析 → rejected 轉 409（第二十二、二十四節） */
export async function adminRpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcStatusResult> {
  const data = await callRpc<unknown>(client, fn, args);
  const r = asStatusResult(fn, data);
  throwIfRejected(fn, r);
  return r;
}

/** 目前活動（is_active）；沒有 → 404 */
export async function requireActiveEvent(client: SupabaseClient): Promise<EventRow> {
  const event = await getActiveEvent(client);
  if (!event) throw new ApiHttpError(404, "NOT_FOUND", "找不到目前的活動，請先執行 import。");
  return event;
}
