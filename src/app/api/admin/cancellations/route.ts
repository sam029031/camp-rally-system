import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { DbFailure, getAssignments, getStation } from "@/lib/server/db";
import { ApiHttpError, badRequest, notFound } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { pickIds } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminCancel } from "@/lib/server/validate";

/**
 * POST /api/admin/cancellations：關卡取消（第二十四之二節）。
 * - assignmentIds：取消指定場次。
 * - stationId + fromSlotNumber：該關從第 k 時段起「接下來所有時段」——未取消、且尚未由關主出關的場次。
 * 全部成功或全部失敗（cancel_assignments RPC）；進行中 → CANCEL_IN_PROGRESS。
 */
export const POST = apiRoute("POST /api/admin/cancellations", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminCancel(await readJsonBody(req));
  const client = getServiceClient();

  let assignmentIds: string[];
  let gameIds: string[];
  if (body.assignmentIds) {
    const rows = await getAssignments(client, body.assignmentIds);
    if (rows.length !== body.assignmentIds.length) throw new ApiHttpError(409, "ASSIGNMENT_NOT_FOUND");
    assignmentIds = body.assignmentIds;
    gameIds = rows.map((a) => a.game_id);
  } else {
    const station = await getStation(client, body.stationId as string);
    if (!station) throw notFound("找不到這個關卡。");
    const fromSlot = body.fromSlotNumber as number;
    assignmentIds = await stationAssignmentsFrom(client, station.id, station.game_id, fromSlot);
    if (assignmentIds.length === 0) {
      throw badRequest(`該關第${fromSlot}時段起沒有可以取消的場次。`);
    }
    gameIds = [station.game_id];
  }

  const r = await adminRpc(client, "cancel_assignments", {
    p_assignment_ids: assignmentIds,
    p_reason: body.reason,
    p_identity_id: session.identityId,
  });

  let cancellationIds = pickIds(r, ["cancellation_ids", "ids"], ["cancellations"]);
  if (cancellationIds.length === 0) {
    // RPC 已成功但沒回 id：改讀剛建立的有效取消（不可回 5xx，否則前端重試會重複送出）
    const { data, error } = await client
      .from("assignment_cancellations")
      .select("id")
      .in("assignment_id", assignmentIds)
      .is("voided_at", null);
    if (error) console.error("[api] 讀取取消紀錄 id 失敗", error);
    cancellationIds = ((data as Array<{ id: string }> | null) ?? []).map((x) => x.id);
  }

  scheduleReconcile(gameIds);
  return jsonOk({ cancellationIds });
});

/** 該關第 k 時段（含）之後：未被取消、且還沒有有效關主出關的 assignment（依時段） */
async function stationAssignmentsFrom(
  client: SupabaseClient,
  stationId: string,
  gameId: string,
  fromSlotNumber: number,
): Promise<string[]> {
  const slotsRes = await client
    .from("time_slots")
    .select("id, slot_number")
    .eq("game_id", gameId)
    .gte("slot_number", fromSlotNumber);
  if (slotsRes.error) throw new DbFailure("time_slots", slotsRes.error);
  const slots = (slotsRes.data as Array<{ id: string; slot_number: number }> | null) ?? [];
  if (slots.length === 0) return [];
  const slotNumber = new Map(slots.map((s) => [s.id, s.slot_number]));

  const asgRes = await client
    .from("assignments")
    .select("id, slot_id")
    .eq("station_id", stationId)
    .in(
      "slot_id",
      slots.map((s) => s.id),
    );
  if (asgRes.error) throw new DbFailure("assignments", asgRes.error);
  const assignments = (asgRes.data as Array<{ id: string; slot_id: string }> | null) ?? [];
  if (assignments.length === 0) return [];
  const ids = assignments.map((a) => a.id);

  const [cancelRes, outRes] = await Promise.all([
    client.from("assignment_cancellations").select("assignment_id").in("assignment_id", ids).is("voided_at", null),
    client
      .from("check_records")
      .select("assignment_id")
      .in("assignment_id", ids)
      .eq("action", "station_check_out")
      .is("voided_at", null),
  ]);
  if (cancelRes.error) throw new DbFailure("assignment_cancellations", cancelRes.error);
  if (outRes.error) throw new DbFailure("check_records", outRes.error);
  const excluded = new Set([
    ...((cancelRes.data as Array<{ assignment_id: string }> | null) ?? []).map((x) => x.assignment_id),
    ...((outRes.data as Array<{ assignment_id: string }> | null) ?? []).map((x) => x.assignment_id),
  ]);

  return assignments
    .filter((a) => !excluded.has(a.id))
    .sort((a, b) => (slotNumber.get(a.slot_id) ?? 0) - (slotNumber.get(b.slot_id) ?? 0))
    .map((a) => a.id);
}
