import type { NextRequest } from "next/server";
import { adminRpc, requireActiveEvent } from "@/lib/server/admin";
import { requireAdmin } from "@/lib/server/auth";
import { getGamesOfEvent } from "@/lib/server/db";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { scheduleReconcile } from "@/lib/server/notifications";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminEventSettings } from "@/lib/server/validate";

/**
 * POST /api/admin/event-settings：活動日期（第二十四節）與撤銷提醒的群組名稱／活動長稱呼（第二十二節）。
 * 沒給的欄位不改（RPC 參數傳 null）。改活動日期會移動所有排程時間，之後重新判斷通知。
 */
export const POST = apiRoute("POST /api/admin/event-settings", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminEventSettings(await readJsonBody(req));
  const client = getServiceClient();
  const event = await requireActiveEvent(client);

  await adminRpc(client, "update_event_settings", {
    p_event_id: event.id,
    p_event_date: body.eventDate ?? null,
    p_team_group_label: body.teamGroupLabel ?? null,
    p_station_group_label: body.stationGroupLabel ?? null,
    p_lead_title: body.leadTitle ?? null,
    p_identity_id: session.identityId,
  });

  if (body.eventDate && body.eventDate !== event.event_date) {
    const games = await getGamesOfEvent(client, event.id);
    scheduleReconcile(games.map((g) => g.id));
  }
  return jsonOk({});
});
