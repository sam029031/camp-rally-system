import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";
import { buildSessionInfo, requireSession } from "@/lib/server/auth";
import { getAppEnv } from "@/lib/server/env";
import { ApiHttpError } from "@/lib/server/errors";
import { apiRoute, jsonOk } from "@/lib/server/http";
import { clearSessionCookie } from "@/lib/server/session";
import { getServiceClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me：目前登入的身分；未登入回 { ok:true, session:null }。
 * cookie 已失效（PIN 已換、身分停用、簽章不符）時也回 session:null 並清掉 cookie。
 */
export const GET = apiRoute("GET /api/auth/me", async (req: NextRequest) => {
  const appEnv = getAppEnv();
  if (!req.cookies.has(SESSION_COOKIE)) return jsonOk({ session: null, appEnv });
  try {
    const { identity } = await requireSession(req);
    const session = await buildSessionInfo(getServiceClient(), identity);
    return jsonOk({ session, appEnv });
  } catch (e) {
    if (e instanceof ApiHttpError && e.status === 401) {
      const res = jsonOk({ session: null, appEnv });
      clearSessionCookie(res, req);
      return res;
    }
    throw e;
  }
});
