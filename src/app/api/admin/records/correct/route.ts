import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminCorrectRecord, sanitizeClientInfo } from "@/lib/server/validate";

/**
 * POST /api/admin/records/correct：修正時間（第二十二節）。
 * 同一 transaction 撤銷原紀錄 + 新增 source='admin_correction'（replaces_record_id = 原紀錄）；
 * 出關 >= 進關 由 RPC 驗（CHECKOUT_BEFORE_CHECKIN）。client_request_id 由 server 產生。
 */
export const POST = apiRoute("POST /api/admin/records/correct", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminCorrectRecord(await readJsonBody(req));
  const client = getServiceClient();
  const r = await adminRpc(client, "admin_correct_record", {
    p_record_id: body.recordId,
    p_new_recorded_at: body.recordedAt,
    p_identity_id: session.identityId,
    p_reason: body.reason,
    p_client_request_id: crypto.randomUUID(),
    p_client_info: sanitizeClientInfo(null, req.headers.get("user-agent")),
  });
  const record = r.record ?? null;
  scheduleReconcile([record?.game_id]);
  return jsonOk({ record });
});
