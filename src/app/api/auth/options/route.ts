import type { LoginOption } from "@/lib/api/contract";
import { apiRoute, jsonOk } from "@/lib/server/http";
import { listIdentityEntries } from "@/lib/server/identity-list";
import { getServiceClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/options：登入頁選單（第二十節）。
 * 只列啟用中的身分，不含任何 PIN hash；關主只列目前活動的關卡。
 * 排序：總召 → 關主（遊戲、關卡順序）→ 隊輔（隊伍順序）→ 唯讀。
 */
export const GET = apiRoute("GET /api/auth/options", async () => {
  const entries = await listIdentityEntries(getServiceClient(), { includeInactive: false });
  const options: LoginOption[] = entries.map((e) => ({
    identityId: e.identity.id,
    role: e.identity.role,
    label: e.identity.label,
    gameCode: e.gameCode,
    gameName: e.gameName,
    stationCode: e.stationCode,
    stationName: e.stationName,
    teamCode: e.teamCode,
    teamName: e.teamName,
  }));
  return jsonOk({ options });
});
