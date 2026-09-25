import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { recordCheck } from "@/lib/server/check";
import { getAssignment } from "@/lib/server/db";
import { ApiHttpError, forbidden } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { getServiceClient } from "@/lib/server/supabase";
import { isStationAction, isTeamAction, parseCheckRequest, sanitizeClientInfo } from "@/lib/server/validate";

/**
 * POST /api/check：關主／隊輔打卡（第七、二十、二十一節）。
 * - 權限以 session 為準：STATION 只能對自己的關卡做關主側動作；TEAM 只能對自己的隊做隊輔側動作；
 *   ADMIN 可以代按任何按鈕（source 仍是 'ui'，identity 是這位 ADMIN）；VIEWER 不能寫。
 * - 大地單隊開始（singleTeamOverride）只有 ADMIN，且必須填原因。
 * - 冪等／重複／競態全部交給 record_check RPC（client_request_id、partial unique index）。
 */
export const POST = apiRoute("POST /api/check", async (req: NextRequest) => {
  const { session } = await requireSession(req, { roles: ["ADMIN", "STATION", "TEAM"], write: true });
  const body = parseCheckRequest(await readJsonBody(req));
  const client = getServiceClient();

  if (body.singleTeamOverride && session.role !== "ADMIN") {
    throw forbidden("只有總召可以「單隊開始」。");
  }

  if (session.role === "STATION") {
    if (!isStationAction(body.action)) throw forbidden("關主只能操作關主側的進關／出關。");
    const assignment = await getAssignment(client, body.assignmentId);
    if (!assignment) throw new ApiHttpError(409, "ASSIGNMENT_NOT_FOUND");
    if (!session.stationId || assignment.station_id !== session.stationId) throw forbidden();
  } else if (session.role === "TEAM") {
    if (!isTeamAction(body.action)) throw forbidden("隊輔只能操作隊輔側的進關／出關。");
    if (!session.teamId || body.teamId !== session.teamId) throw forbidden();
  }

  const { status, record } = await recordCheck(client, {
    clientRequestId: body.clientRequestId,
    assignmentId: body.assignmentId,
    action: body.action,
    teamId: body.teamId,
    identityId: session.identityId,
    source: "ui",
    noShow: body.noShow ?? false,
    confirmedTeamIds: body.confirmedTeamIds ?? null,
    singleTeamOverride: body.singleTeamOverride ?? false,
    reason: body.reason ?? null,
    clientInfo: sanitizeClientInfo(body.clientInfo, req.headers.get("user-agent")),
  });

  // already_recorded：別支手機先按了 → 視為完成（第二十一節），前端顯示「已由另一裝置於 HH:mm:ss 記錄」
  return jsonOk({ status, record });
});
