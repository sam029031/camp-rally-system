import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getGame } from "@/lib/server/db";
import { notFound } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminGameSettings } from "@/lib/server/validate";

/**
 * POST /api/admin/game-settings：每個遊戲的 end_policy 與 min_play_seconds（第八節、第二十五節）。
 * end_policy 會改變 official_end，因此之後重新判斷超時通知是否仍成立。
 */
export const POST = apiRoute("POST /api/admin/game-settings", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminGameSettings(await readJsonBody(req));
  const client = getServiceClient();
  const game = await getGame(client, body.gameId);
  if (!game) throw notFound("找不到這個遊戲。");

  await adminRpc(client, "update_game_settings", {
    p_game_id: game.id,
    p_end_policy: body.endPolicy,
    p_min_play_seconds: body.minPlaySeconds,
    p_identity_id: session.identityId,
  });

  scheduleReconcile([game.id]);
  return jsonOk({});
});
