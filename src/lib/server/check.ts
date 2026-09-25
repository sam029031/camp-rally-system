import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckStatus, ClientInfo } from "@/lib/api/contract";
import type { CheckAction, CheckRecordRow, RecordSource } from "@/lib/types";
import { asStatusResult, callRpc, RpcFailure, throwIfRejected } from "@/lib/server/rpc";

/**
 * record_check RPC 的唯一入口（第二十一節：所有打卡只走一個 Postgres function）。
 * 規則拒絕 → ApiHttpError（409 / 403）；成功回 created / existing / already_recorded + 紀錄。
 */
export interface RecordCheckArgs {
  clientRequestId: string;
  assignmentId: string;
  action: CheckAction;
  teamId: string | null;
  identityId: string;
  source: RecordSource;
  /** 只有 admin_correction 使用 */
  recordedAt?: string | null;
  noShow?: boolean;
  confirmedTeamIds?: string[] | null;
  singleTeamOverride?: boolean;
  reason?: string | null;
  clientInfo?: ClientInfo | null;
}

const OK_STATUSES: readonly CheckStatus[] = ["created", "existing", "already_recorded"];

export async function recordCheck(
  client: SupabaseClient,
  a: RecordCheckArgs,
): Promise<{ status: CheckStatus; record: CheckRecordRow }> {
  const data = await callRpc<unknown>(client, "record_check", {
    p_client_request_id: a.clientRequestId,
    p_assignment_id: a.assignmentId,
    p_action: a.action,
    p_team_id: a.teamId,
    p_identity_id: a.identityId,
    p_source: a.source,
    p_recorded_at: a.recordedAt ?? null,
    p_no_show: a.noShow ?? false,
    p_confirmed_team_ids: a.confirmedTeamIds && a.confirmedTeamIds.length > 0 ? a.confirmedTeamIds : null,
    p_single_team_override: a.singleTeamOverride ?? false,
    p_reason: a.reason ?? null,
    p_client_info: a.clientInfo && Object.keys(a.clientInfo).length > 0 ? a.clientInfo : null,
  });
  const r = asStatusResult("record_check", data);
  throwIfRejected("record_check", r);
  const status = r.status as CheckStatus;
  if (!OK_STATUSES.includes(status) || !r.record) {
    throw new RpcFailure("record_check", `未預期的回傳：${JSON.stringify(data)}`);
  }
  return { status, record: r.record };
}
