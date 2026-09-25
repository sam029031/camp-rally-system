import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { recordCheck } from "@/lib/server/check";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminAddRecord, sanitizeClientInfo } from "@/lib/server/validate";

/**
 * POST /api/admin/records/add：補登（第二十二節「只新增一筆 admin_correction」）。
 * recorded_at 由總召指定（ADMIN session 驗過才傳入 RPC）；已有有效紀錄 → 409 ALREADY_RECORDED（請改用修正時間）。
 */
export const POST = apiRoute("POST /api/admin/records/add", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminAddRecord(await readJsonBody(req));
  const client = getServiceClient();
  const { status, record } = await recordCheck(client, {
    clientRequestId: crypto.randomUUID(),
    assignmentId: body.assignmentId,
    action: body.action,
    teamId: body.teamId,
    identityId: session.identityId,
    source: "admin_correction",
    recordedAt: body.recordedAt,
    noShow: body.noShow ?? false,
    reason: body.reason,
    clientInfo: sanitizeClientInfo(null, req.headers.get("user-agent")),
  });
  if (status === "already_recorded") {
    throw new ApiHttpError(409, "ALREADY_RECORDED", "已經有一筆有效紀錄，請改用「修正時間」。", { record });
  }
  scheduleReconcile([record.game_id]);
  return jsonOk({ record });
});
