import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_COOKIE } from "@/lib/constants";
import type { Role, SessionInfo, SessionPayload } from "@/lib/types";
import { getGame, getIdentity, getStation, getTeam, type IdentityPublic } from "@/lib/server/db";
import { forbidden, sessionExpired, unauthorized } from "@/lib/server/errors";
import { verifySession } from "@/lib/server/session";
import { getServiceClient } from "@/lib/server/supabase";

/**
 * 身分驗證與權限（第二十節）。
 * - 每次都驗 cookie 簽章，再用 service role 讀 identity：停用或 pin_version 不符 → 401 SESSION_EXPIRED 並清 cookie。
 * - role / station_id / team_id 一律以 DB 的 identity 為準，不信任前端送來的 id。
 */

export interface AuthContext {
  /** 以 DB identity 校正後的 session */
  session: SessionPayload;
  identity: IdentityPublic;
}

/** 依 cookie token 驗證並讀 identity；失敗回傳原因（route 轉成 401，server component 當成未登入） */
async function resolveSession(
  token: string | undefined,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; reason: "missing" | "invalid" }> {
  if (!token) return { ok: false, reason: "missing" };
  const payload = await verifySession(token);
  if (!payload) return { ok: false, reason: "invalid" };
  const identity = await getIdentity(getServiceClient(), payload.identityId);
  if (!identity || !identity.is_active || identity.pin_version !== payload.pinVersion || identity.role !== payload.role) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    ctx: {
      identity,
      session: {
        identityId: identity.id,
        role: identity.role,
        stationId: identity.station_id,
        teamId: identity.team_id,
        pinVersion: identity.pin_version,
        exp: payload.exp,
      },
    },
  };
}

/**
 * Route Handler 用：沒有 cookie → 401 UNAUTHORIZED；無效／停用／PIN 已換 → 401 SESSION_EXPIRED（清 cookie）；
 * write = true 時 VIEWER → 403；roles 不符 → 403。
 */
export async function requireSession(
  req: NextRequest,
  opts: { roles?: readonly Role[]; write?: boolean } = {},
): Promise<AuthContext> {
  const r = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!r.ok) throw r.reason === "missing" ? unauthorized() : sessionExpired();
  const { role } = r.ctx.session;
  if (opts.write && role === "VIEWER") throw forbidden("唯讀身分不能操作。");
  if (opts.roles && !opts.roles.includes(role)) throw forbidden();
  return r.ctx;
}

/** ADMIN 專用 route */
export function requireAdmin(req: NextRequest): Promise<AuthContext> {
  return requireSession(req, { roles: ["ADMIN"], write: true });
}

/** identity → SessionInfo（附關卡／隊伍／遊戲名稱） */
export async function buildSessionInfo(
  client: SupabaseClient,
  identity: Pick<IdentityPublic, "id" | "role" | "label" | "station_id" | "team_id">,
): Promise<SessionInfo> {
  let station: SessionInfo["station"] = null;
  let team: SessionInfo["team"] = null;
  if (identity.station_id) {
    const s = await getStation(client, identity.station_id);
    if (s) {
      const g = await getGame(client, s.game_id);
      if (g) station = { id: s.id, code: s.code, name: s.name, gameCode: g.code, gameId: g.id };
    }
  }
  if (identity.team_id) {
    const t = await getTeam(client, identity.team_id);
    if (t) team = { id: t.id, code: t.code, name: t.name, isStaffTeam: t.is_staff_team };
  }
  return { identityId: identity.id, role: identity.role, label: identity.label, station, team };
}

/**
 * Server Component 用：讀 cookie、驗證、讀 identity 與關卡／隊伍名稱；未登入或已失效回 null。
 * （server component 不能改 cookie；失效的 cookie 會在下一次呼叫 API 時被清掉。）
 */
export async function getSessionInfo(): Promise<SessionInfo | null> {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  return buildSessionInfo(getServiceClient(), ctx.identity);
}

/** Server Component 用：回傳校正後的 session 與 identity（不含 PIN hash）；未登入回 null */
export async function getSessionContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const r = await resolveSession(store.get(SESSION_COOKIE)?.value);
  return r.ok ? r.ctx : null;
}
