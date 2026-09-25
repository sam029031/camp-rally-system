import type { NextRequest } from "next/server";
import { loadGameSnapshot } from "@/lib/data/snapshot";
import { deriveGame, findCondition } from "@/lib/derive";
import { buildConditionMessage } from "@/lib/notifications/messages";
import type { NotificationRow } from "@/lib/types";
import { requireSession } from "@/lib/server/auth";
import { getAssignment } from "@/lib/server/db";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { callRpc, getAppNow, RpcFailure } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { parseNotificationCheckRequest } from "@/lib/server/validate";

/**
 * POST /api/notifications/check（第十五節）
 * 前端只帶 key（kind / subkind / assignmentId / teamId），不帶時間；
 * server 重抓快照、用 get_clock 的 app 時間與同一組 deriveGame 確認條件真的成立，才 create_notification
 * （ON CONFLICT DO NOTHING：多台同時偵測也只有一筆）。not_yet 不是錯誤。
 * 任一有效 session 都可以呼叫（含 VIEWER）。
 */
export const POST = apiRoute("POST /api/notifications/check", async (req: NextRequest) => {
  await requireSession(req);
  const body = parseNotificationCheckRequest(await readJsonBody(req));
  const client = getServiceClient();

  // assignmentId 由 validate 保證非 null（推導型通知一律掛在 assignment 上）
  const assignment = await getAssignment(client, body.assignmentId as string);
  if (!assignment) throw new ApiHttpError(409, "ASSIGNMENT_NOT_FOUND");

  const snap = await loadGameSnapshot(client, { gameId: assignment.game_id });
  const now = await getAppNow(client, snap.event.id);
  const derived = deriveGame(snap, now);
  const condition = findCondition(derived, {
    kind: body.kind,
    subkind: body.subkind,
    assignmentId: body.assignmentId,
    teamId: body.teamId,
  });
  if (!condition) return jsonOk({ result: "not_yet", notification: null });

  const data = await callRpc<unknown>(client, "create_notification", {
    p_kind: condition.kind,
    p_subkind: condition.subkind,
    p_game_id: assignment.game_id,
    p_assignment_id: condition.assignmentId,
    p_team_id: condition.teamId,
    p_trigger_record_id: condition.triggerRecordId,
    p_trigger_override_id: condition.triggerOverrideId,
    p_message: buildConditionMessage(condition, snap, derived),
  });
  const r = (data ?? {}) as { result?: unknown; notification?: unknown };
  if (r.result !== "created" && r.result !== "exists") {
    throw new RpcFailure("create_notification", `未預期的回傳：${JSON.stringify(data)}`);
  }
  return jsonOk({
    result: r.result,
    notification: (r.notification as NotificationRow | null | undefined) ?? null,
  });
});
