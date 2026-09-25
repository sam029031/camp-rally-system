import type { NextRequest } from "next/server";
import { adminRpc, requireActiveEvent } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { isDemoAllowed } from "@/lib/server/env";
import { ApiHttpError, badRequest } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { getServiceClient } from "@/lib/server/supabase";
import { resolveJumpTo } from "@/lib/server/time-input";
import { parseAdminClock } from "@/lib/server/validate";

/**
 * POST /api/admin/clock：Demo 面板（第三十一節）。
 * - APP_ENV 不是 development / demo（含未設定）時拒絕「開啟」Demo（含跳時間）；「關閉」一律允許。
 * - 跳到指定時刻：'HH:mm'（活動日 +08:00）或 ISO；早於現有有效紀錄 → RPC 回 CLOCK_JUMP_BEFORE_RECORDS。
 * - anchor 重設由 set_clock RPC 處理（改倍速或開關時時間不跳動）。
 */
export const POST = apiRoute("POST /api/admin/clock", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminClock(await readJsonBody(req));
  if (body.enabled && !isDemoAllowed()) throw new ApiHttpError(403, "DEMO_NOT_ALLOWED");

  const client = getServiceClient();
  const event = await requireActiveEvent(client);

  let jumpTo: string | null = null;
  if (body.enabled && body.jumpTo) {
    try {
      jumpTo = resolveJumpTo(event.event_date, body.jumpTo);
    } catch {
      throw badRequest("要跳到的時間格式不正確。");
    }
  }

  await adminRpc(client, "set_clock", {
    p_event_id: event.id,
    p_enabled: body.enabled,
    p_speed: body.speed,
    p_jump_to: jumpTo,
    p_identity_id: session.identityId,
  });
  return jsonOk({});
});
