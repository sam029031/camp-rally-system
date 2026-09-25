import type { NextRequest } from "next/server";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { DbFailure } from "@/lib/server/db";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminVoidEndOverride } from "@/lib/server/validate";

/** POST /api/admin/end-override/void：撤銷延長（回到依 end_policy 計算的結束時間） */
export const POST = apiRoute("POST /api/admin/end-override/void", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminVoidEndOverride(await readJsonBody(req));
  const client = getServiceClient();

  const { data, error } = await client
    .from("v_assignment_end_overrides")
    .select("id, game_id")
    .eq("id", body.overrideId)
    .maybeSingle();
  if (error) throw new DbFailure("v_assignment_end_overrides", error);
  const row = data as { id: string; game_id: string } | null;
  if (!row) throw new ApiHttpError(409, "OVERRIDE_NOT_FOUND");

  await adminRpc(client, "void_end_override", {
    p_override_id: body.overrideId,
    p_identity_id: session.identityId,
    p_reason: body.reason,
  });

  scheduleReconcile([row.game_id]);
  return jsonOk({ overrideId: row.id });
});
