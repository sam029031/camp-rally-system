import type { NextRequest } from "next/server";
import { adminRpc, requireActiveEvent } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getGamesOfEvent } from "@/lib/server/db";
import { isDemoAllowed } from "@/lib/server/env";
import { ApiHttpError, notFound } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminReset } from "@/lib/server/validate";

/**
 * POST /api/admin/reset：Reset Demo Data（第二十五節）。
 * - 只在 APP_ENV = development / demo 允許（server 端檢查，不能只靠前端隱藏按鈕）。
 * - 確認字必須完全是 RESET。
 * - 清除執行期資料（打卡、通知、延後、取消、延長）；不清排程與 PIN；audit_logs 保留並新增 RESET。
 * - 不關閉 Demo 時鐘（彩排流程：Reset 後再把 Demo 時間跳回 09:08）。
 */
export const POST = apiRoute("POST /api/admin/reset", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  if (!isDemoAllowed()) throw new ApiHttpError(403, "RESET_NOT_ALLOWED");
  const body = parseAdminReset(await readJsonBody(req));

  const client = getServiceClient();
  const event = await requireActiveEvent(client);
  const games = (await getGamesOfEvent(client, event.id)).filter(
    (g) => body.gameCode === "all" || g.code === body.gameCode,
  );
  if (games.length === 0) throw notFound("找不到要重設的遊戲。");

  for (const game of games) {
    await adminRpc(client, "reset_game_records", {
      p_game_id: game.id,
      p_identity_id: session.identityId,
      p_reason: "Reset Demo Data",
      p_disable_sim: false,
    });
  }
  return jsonOk({});
});
