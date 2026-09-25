import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getGame } from "@/lib/server/db";
import { notFound } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { pickId } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminVoidLastAdjustment } from "@/lib/server/validate";

/**
 * POST /api/admin/schedule/void-last：撤銷最近一次調整（第二十四節；受影響時段都必須尚未開始，RPC 驗）。
 * 回傳被撤銷那一筆的 id。
 */
export const POST = apiRoute("POST /api/admin/schedule/void-last", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminVoidLastAdjustment(await readJsonBody(req));
  const client = getServiceClient();
  const game = await getGame(client, body.gameId);
  if (!game) throw notFound("找不到這個遊戲。");

  const r = await adminRpc(client, "void_last_adjustment", {
    p_game_id: game.id,
    p_identity_id: session.identityId,
    p_reason: body.reason,
  });

  let adjustmentId = pickId(r, ["adjustment_id", "id"], ["adjustment"]);
  if (!adjustmentId) {
    const { data } = await client
      .from("schedule_adjustments")
      .select("id")
      .eq("game_id", game.id)
      .not("voided_at", "is", null)
      .order("voided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    adjustmentId = (data as { id?: string } | null)?.id ?? "";
  }

  scheduleReconcile([game.id]);
  return jsonOk({ adjustmentId });
});
