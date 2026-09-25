import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { recordCheck } from "@/lib/server/check";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminForceEnd, sanitizeClientInfo } from "@/lib/server/validate";

/**
 * POST /api/admin/force-end：強制結束（第二十二節）＝新增一筆 source='admin_force' 的 station_check_out，
 * 時間由 DB 的 app_now() 產生；需要有效 station_check_in（RPC 驗）。
 */
export const POST = apiRoute("POST /api/admin/force-end", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminForceEnd(await readJsonBody(req));
  const client = getServiceClient();
  const { status, record } = await recordCheck(client, {
    clientRequestId: crypto.randomUUID(),
    assignmentId: body.assignmentId,
    action: "station_check_out",
    teamId: null,
    identityId: session.identityId,
    source: "admin_force",
    reason: body.reason,
    clientInfo: sanitizeClientInfo(null, req.headers.get("user-agent")),
  });
  if (status === "already_recorded") {
    throw new ApiHttpError(409, "ALREADY_RECORDED", "本場已經出關。", { record });
  }
  scheduleReconcile([record.game_id]);
  return jsonOk({ record });
});
