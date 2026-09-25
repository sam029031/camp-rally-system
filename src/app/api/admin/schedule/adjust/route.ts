import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getEvent, getGame } from "@/lib/server/db";
import { ApiHttpError, notFound } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { pickId } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { taipeiDateTimeToIso } from "@/lib/server/time-input";
import { parseAdminAdjust } from "@/lib/server/validate";

/**
 * POST /api/admin/schedule/adjust：整場延後／提前（第二十四節）。
 * - DELAY：「從第 k 時段起延後 N 分鐘」→ offset_seconds = N × 60（負數 = 提前）。
 * - START_AT：「第 k 時段從 HH:mm 開始」→ 活動日 +08:00 的 timestamptz，offset 由 RPC 以目前有效開始計算。
 * 「只能從尚未開始的時段起調整」等規則由 adjust_schedule RPC 驗證並建立 SCHEDULE_ADJUSTED 通知。
 */
export const POST = apiRoute("POST /api/admin/schedule/adjust", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminAdjust(await readJsonBody(req));
  const client = getServiceClient();

  const game = await getGame(client, body.gameId);
  if (!game) throw notFound("找不到這個遊戲。");
  const event = await getEvent(client, game.event_id);
  if (!event) throw notFound("找不到這個遊戲的活動。");

  let offsetSeconds: number | null = null;
  let startAt: string | null = null;
  if (body.mode === "DELAY") {
    offsetSeconds = (body.offsetMinutes as number) * 60;
  } else {
    try {
      startAt = taipeiDateTimeToIso(event.event_date, body.startAt as string);
    } catch {
      throw new ApiHttpError(400, "ADJUST_INVALID");
    }
  }

  const r = await adminRpc(client, "adjust_schedule", {
    p_game_id: game.id,
    p_from_slot_number: body.fromSlotNumber,
    p_input_mode: body.mode,
    p_offset_seconds: offsetSeconds,
    p_start_at: startAt,
    p_reason: body.reason,
    p_identity_id: session.identityId,
  });

  let adjustmentId = pickId(r, ["adjustment_id", "id"], ["adjustment"]);
  if (!adjustmentId) {
    // RPC 已成功；回傳沒有 id 時改讀最新一筆（不可因此回 5xx，否則前端重試會重複調整）
    const { data } = await client
      .from("schedule_adjustments")
      .select("id")
      .eq("game_id", game.id)
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    adjustmentId = (data as { id?: string } | null)?.id ?? "";
  }

  scheduleReconcile([game.id]);
  return jsonOk({ adjustmentId });
});
