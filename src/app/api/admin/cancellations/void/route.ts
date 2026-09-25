import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { DbFailure } from "@/lib/server/db";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminVoidCancellation } from "@/lib/server/validate";

/** POST /api/admin/cancellations/void：撤銷取消（第二十四之二節；RPC 建立 SCHEDULE_ADJUSTED VOID 通知） */
export const POST = apiRoute("POST /api/admin/cancellations/void", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminVoidCancellation(await readJsonBody(req));
  const client = getServiceClient();

  const { data, error } = await client
    .from("v_assignment_cancellations")
    .select("id, game_id")
    .eq("id", body.cancellationId)
    .maybeSingle();
  if (error) throw new DbFailure("v_assignment_cancellations", error);
  const row = data as { id: string; game_id: string } | null;
  if (!row) throw new ApiHttpError(409, "CANCELLATION_NOT_FOUND");

  await adminRpc(client, "void_cancellation", {
    p_cancellation_id: body.cancellationId,
    p_identity_id: session.identityId,
    p_reason: body.reason,
  });

  scheduleReconcile([row.game_id]);
  return jsonOk({});
});
