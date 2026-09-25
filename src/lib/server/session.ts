import "server-only";
import type { NextResponse } from "next/server";
import { DEVICE_COOKIE, SESSION_COOKIE } from "@/lib/constants";
import type { SessionPayload } from "@/lib/types";
import { getSessionSecret, isProduction } from "@/lib/server/env";
import { signSessionToken, verifySessionToken } from "@/lib/server/session-token";

/**
 * Cookie session（第二十節）：camp_session = jose HS256 signed JWT（httpOnly、sameSite lax、path /）。
 * Secure 依這次 request 的實際協定決定（isSecureRequest）：Vercel 一律 https → Secure；
 * 本機或區網用 http 測 `next start` 時不加 Secure，否則瀏覽器（localhost 以外）會拒收 cookie、永遠登不進去。
 * 內容見 SessionPayload；到期 = max(活動日 23:59:59 +08:00, now + 24h)（computeSessionExp）。
 */

export { computeSessionExp } from "@/lib/server/session-token";

export async function signSession(payload: SessionPayload): Promise<string> {
  return signSessionToken(payload, getSessionSecret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  return verifySessionToken(token, getSessionSecret());
}

/** 帶 headers / nextUrl 的 request（NextRequest 符合） */
export interface RequestLike {
  headers: Headers;
  nextUrl?: { protocol: string };
}

/** 這次 request 是否為 https（反向代理看 x-forwarded-proto）；沒有 request 時退回「production 才 secure」 */
export function isSecureRequest(req?: RequestLike | null): boolean {
  if (!req) return isProduction();
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]!.trim().toLowerCase() === "https";
  return req.nextUrl?.protocol === "https:";
}

export function sessionCookieOptions(expEpochSeconds: number, req?: RequestLike | null) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(req),
    path: "/",
    expires: new Date(expEpochSeconds * 1000),
  };
}

export function setSessionCookie(
  res: NextResponse,
  token: string,
  expEpochSeconds: number,
  req?: RequestLike | null,
): void {
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expEpochSeconds, req));
}

export function clearSessionCookie(res: NextResponse, req?: RequestLike | null): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: 0,
  });
}

/** 裝置 cookie：登入鎖定用的 device_id（第二十節），1 年 */
export const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function deviceCookieOptions(req?: RequestLike | null) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(req),
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  };
}

export function setDeviceCookie(res: NextResponse, deviceId: string, req?: RequestLike | null): void {
  res.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions(req));
}
