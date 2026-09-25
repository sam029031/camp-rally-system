import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UndoReminder } from "@/lib/api/contract";
import { errorMessage, undoExpiredMessage } from "@/lib/errors";
import { actionLabel } from "@/lib/labels";
import { formatHms } from "@/lib/time";
import type { CheckAction, CheckRecordRow } from "@/lib/types";
import { requireSession } from "@/lib/server/auth";
import { getAssignment, getEvent, getGame, getStation, getTeams } from "@/lib/server/db";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { asStatusResult, callRpc, RpcFailure, throwIfRejected } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { formatTaipeiDateTime, parseDbTimestamp } from "@/lib/server/time-input";
import { assignmentTeamsText, buildUndoReminder } from "@/lib/server/undo-reminder";
import { isRecentOwnSelfUndo, parseUndoRetryClock } from "@/lib/server/undo-retry";
import { parseUndoRequest, sanitizeClientInfo } from "@/lib/server/validate";

/**
 * POST /api/undo：現場撤銷（第二十二節）。
 * 同一 identity、真實時間 75 秒內、順序保護全部由 undo_check RPC 驗證；
 * 成功後回傳撤銷提醒（ADMIN 自己撤銷時為 null），並在回應後做通知失效判斷。
 * 重送（ALREADY_VOIDED 且是本人 90 秒內的 SELF_UNDO）也回成功與同樣的提醒，提醒視窗才不會漏掉。
 */
export const POST = apiRoute("POST /api/undo", async (req: NextRequest) => {
  const { session } = await requireSession(req, { roles: ["ADMIN", "STATION", "TEAM"], write: true });
  const body = parseUndoRequest(await readJsonBody(req));
  const client = getServiceClient();

  const data = await callRpc<unknown>(client, "undo_check", {
    p_record_id: body.recordId,
    p_identity_id: session.identityId,
    p_client_info: sanitizeClientInfo(body.clientInfo, req.headers.get("user-agent")),
  });
  const r = asStatusResult("undo_check", data);

  if (r.status === "rejected" && r.code === "UNDO_WINDOW_EXPIRED") {
    // 「超過 1 分鐘，請聯絡{lead_title}由總召修正」
    const leadTitle = await leadTitleForRecord(client, body.recordId);
    throw new ApiHttpError(
      409,
      "UNDO_WINDOW_EXPIRED",
      leadTitle ? undoExpiredMessage(leadTitle) : errorMessage("UNDO_WINDOW_EXPIRED"),
    );
  }
  let record: CheckRecordRow;
  if (r.status === "rejected" && r.code === "ALREADY_VOIDED") {
    // 重送：上一次其實已撤銷成功、只是回應遺失 → 仍回成功，讓必做的提醒視窗照常出現
    const retried = await ownRecentSelfUndo(client, body.recordId, session.identityId);
    if (!retried) {
      throwIfRejected("undo_check", r);
      throw new RpcFailure("undo_check", "ALREADY_VOIDED 應已被拒絕");
    }
    record = retried;
  } else {
    throwIfRejected("undo_check", r);
    if (r.status !== "voided" || !r.record) {
      throw new RpcFailure("undo_check", `未預期的回傳：${JSON.stringify(data)}`);
    }
    record = r.record;
  }

  let reminder: UndoReminder | null = null;
  if (session.role !== "ADMIN") {
    reminder = await buildReminderForRecord(client, record);
  }

  scheduleReconcile([record.game_id]);
  return jsonOk({ record, reminder });
});

/**
 * ALREADY_VOIDED 時：若這筆是本人以 SELF_UNDO 在真實時間 90 秒內撤銷的，回傳該紀錄（視為重送成功）；否則 null。
 * 查詢失敗一律回 null（維持原本的拒絕），不把重送誤判成成功。
 */
async function ownRecentSelfUndo(
  client: SupabaseClient,
  recordId: string,
  identityId: string,
): Promise<CheckRecordRow | null> {
  try {
    const { data, error } = await client.from("v_check_records").select("*").eq("id", recordId).maybeSingle();
    if (error || !data) return null;
    const row = data as CheckRecordRow;
    if (row.voided_by !== identityId || row.void_reason !== "SELF_UNDO") return null;
    const game = await getGame(client, row.game_id);
    const clock = parseUndoRetryClock(await callRpc<unknown>(client, "get_clock", { p_event_id: game?.event_id ?? null }));
    if (!clock) return null;
    return isRecentOwnSelfUndo(row, identityId, clock) ? row : null;
  } catch (e) {
    console.error("[api] POST /api/undo 判斷重送失敗", e);
    return null;
  }
}

async function leadTitleForRecord(client: SupabaseClient, recordId: string): Promise<string | null> {
  try {
    const { data } = await client.from("v_check_records").select("game_id").eq("id", recordId).maybeSingle();
    const gameId = (data as { game_id?: string } | null)?.game_id;
    if (!gameId) return null;
    const game = await getGame(client, gameId);
    const event = game ? await getEvent(client, game.event_id) : null;
    return event?.lead_title ?? null;
  } catch (e) {
    console.error("[api] POST /api/undo 讀取活動長稱呼失敗", e);
    return null;
  }
}

const FALLBACK_ACTION_TEXT: Record<CheckAction, string> = {
  station_check_in: "確認進關",
  station_check_out: "確認出關",
  team_check_in: "確認進關",
  team_check_out: "確認出關",
};

function hmsOf(value: string | null, fallbackMs: number): string {
  const ms = parseDbTimestamp(value) ?? fallbackMs;
  try {
    return formatHms(ms);
  } catch {
    return formatTaipeiDateTime(ms).slice(11);
  }
}

/** 第二十二節的提醒文字：隊輔側 → 隊輔群；關主側 → 活動組群 */
async function buildReminderForRecord(client: SupabaseClient, record: CheckRecordRow): Promise<UndoReminder> {
  const [station, assignment, game] = await Promise.all([
    getStation(client, record.station_id),
    getAssignment(client, record.assignment_id),
    getGame(client, record.game_id),
  ]);
  const event = game ? await getEvent(client, game.event_id) : null;
  const teamIds = record.team_id
    ? [record.team_id]
    : assignment
      ? [assignment.team_a_id, ...(assignment.team_b_id ? [assignment.team_b_id] : [])]
      : [];
  const teams = await getTeams(client, teamIds);
  const nameById = new Map(teams.map((t) => [t.id, t.name]));
  const teamNames = teamIds.map((id) => nameById.get(id) ?? "");

  let actionText: string;
  if (record.no_show) {
    actionText = "本隊未到";
  } else {
    try {
      actionText = actionLabel(record.action);
    } catch {
      actionText = FALLBACK_ACTION_TEXT[record.action];
    }
  }

  const voidedFallback = Date.now();
  return buildUndoReminder({
    side: record.action === "team_check_in" || record.action === "team_check_out" ? "TEAM" : "STATION",
    stationName: station?.name ?? "",
    teamText: assignmentTeamsText(teamNames.filter((n) => n !== "")),
    actionText,
    recordedAtText: hmsOf(record.recorded_at, voidedFallback),
    voidedAtText: hmsOf(record.voided_at, voidedFallback),
    teamGroupLabel: event?.team_group_label ?? "隊輔群",
    stationGroupLabel: event?.station_group_label ?? "活動組群",
    leadTitle: event?.lead_title ?? "活動長",
  });
}
