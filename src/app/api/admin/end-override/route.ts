import type { NextRequest } from "next/server";
import { loadGameSnapshot } from "@/lib/data/snapshot";
import { deriveGame } from "@/lib/derive";
import { adminRpc } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getAssignment } from "@/lib/server/db";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getAppNow, pickId } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminEndOverride } from "@/lib/server/validate";

/**
 * POST /api/admin/end-override：延長／改結束時間（第八節 end override）。
 * - officialEnd：直接指定（ISO）。
 * - extendMinutes：以目前 official_end 為基準延長；尚未開始計時（沒有 official_end）則以 app_now 為基準。
 * - fullDuration：以完整關卡時間重新計 = max(app_now, started_at) + 關卡時間。
 * 同一 transaction 撤銷舊 override 再新增（set_end_override RPC）。
 */
export const POST = apiRoute("POST /api/admin/end-override", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminEndOverride(await readJsonBody(req));
  const client = getServiceClient();

  const assignment = await getAssignment(client, body.assignmentId);
  if (!assignment) throw new ApiHttpError(409, "ASSIGNMENT_NOT_FOUND");

  let officialEndIso: string;
  const mode = body.modeParsed;
  if (mode.kind === "official_end") {
    officialEndIso = mode.officialEnd;
  } else {
    // 以 server 的快照與 app 時間計算基準（不信任前端時間）
    const snap = await loadGameSnapshot(client, { gameId: assignment.game_id });
    const now = await getAppNow(client, snap.event.id);
    const derived = deriveGame(snap, now);
    const ad = derived.assignments.get(assignment.id);
    if (!ad) throw new ApiHttpError(409, "ASSIGNMENT_NOT_FOUND");
    const endMs =
      mode.kind === "extend"
        ? (ad.officialEnd ?? now) + mode.extendMinutes * 60_000
        : Math.max(now, ad.startedAt ?? now) + snap.game.stationDurationMs;
    officialEndIso = new Date(endMs).toISOString();
  }

  const r = await adminRpc(client, "set_end_override", {
    p_assignment_id: assignment.id,
    p_official_end: officialEndIso,
    p_reason: body.reason,
    p_identity_id: session.identityId,
  });

  let overrideId = pickId(r, ["override_id", "id"], ["override"]);
  if (!overrideId) {
    const { data } = await client
      .from("assignment_end_overrides")
      .select("id")
      .eq("assignment_id", assignment.id)
      .is("voided_at", null)
      .maybeSingle();
    overrideId = (data as { id?: string } | null)?.id ?? null;
  }

  scheduleReconcile([assignment.game_id]);
  return jsonOk({ overrideId });
});
