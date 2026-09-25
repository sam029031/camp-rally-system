import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminVoidRecord, sanitizeClientInfo } from "@/lib/server/validate";

/** POST /api/admin/records/void：總召撤銷紀錄（第二十二節；原因必填、順序保護由 RPC 驗） */
export const POST = apiRoute("POST /api/admin/records/void", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminVoidRecord(await readJsonBody(req));
  const client = getServiceClient();
  const r = await adminRpc(client, "admin_void_record", {
    p_record_id: body.recordId,
    p_identity_id: session.identityId,
    p_reason: body.reason,
    p_client_info: sanitizeClientInfo(null, req.headers.get("user-agent")),
  });
  const record = r.record ?? null;
  scheduleReconcile([record?.game_id]);
  return jsonOk({ record });
});
