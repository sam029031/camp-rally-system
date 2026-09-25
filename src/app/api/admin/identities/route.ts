import type { NextRequest } from "next/server";
import type { AdminIdentity } from "@/lib/api/contract";
import { requireAdmin } from "@/lib/server/auth";
import { apiRoute, jsonOk, requestOrigin } from "@/lib/server/http";
import { listIdentityEntries } from "@/lib/server/identity-list";
import { getServiceClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/identities：PIN 總表（第二十五節）。
 * DB 只存 bcrypt hash，這裡只列身分與登入網址（QR code 用，不含 PIN）。
 */
export const GET = apiRoute("GET /api/admin/identities", async (req: NextRequest) => {
  await requireAdmin(req);
  const origin = requestOrigin(req);
  const entries = await listIdentityEntries(getServiceClient(), { includeInactive: true });
  const identities: AdminIdentity[] = entries.map((e) => ({
    id: e.identity.id,
    role: e.identity.role,
    label: e.identity.label,
    isActive: e.identity.is_active,
    pinVersion: e.identity.pin_version,
    gameCode: e.gameCode,
    stationCode: e.stationCode,
    stationName: e.stationName,
    teamCode: e.teamCode,
    teamName: e.teamName,
    loginUrl: `${origin}/login?identity=${encodeURIComponent(e.identity.id)}`,
  }));
  return jsonOk({ identities });
});
