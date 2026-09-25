import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { ApiError } from "@/lib/api/contract";
import { errorMessage } from "@/lib/errors";
import { ApiHttpError, badRequest } from "@/lib/server/errors";
import { clearSessionCookie } from "@/lib/server/session";

/**
 * Route Handler 共用外殼：
 * - 每個回應加 Cache-Control: no-store（ARCHITECTURE 第 5 節）。
 * - ApiHttpError → { ok:false, code, message }（401 時清 cookie）。
 * - 其他例外 → 500 INTERNAL_ERROR，server 端 log 完整錯誤。
 */

export const NO_STORE = "no-store";

export function withNoStore<R extends Response>(res: R): R {
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

/** { ok: true, ...data } */
export function jsonOk<T extends object>(data: T, init?: { status?: number }): NextResponse {
  return withNoStore(NextResponse.json({ ok: true, ...data }, { status: init?.status ?? 200 }));
}

export function jsonError(err: ApiHttpError, req?: NextRequest): NextResponse {
  const body: ApiError = { ok: false, code: err.code, message: err.message };
  if (err.record !== undefined) body.record = err.record;
  const res = NextResponse.json(body, { status: err.status });
  if (err.clearSession) clearSessionCookie(res, req);
  return withNoStore(res);
}

export function apiRoute(
  name: string,
  handler: (req: NextRequest) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    try {
      return withNoStore(await handler(req));
    } catch (e) {
      if (e instanceof ApiHttpError) return jsonError(e, req);
      console.error(`[api] ${name} 發生未預期錯誤`, e);
      const body: ApiError = { ok: false, code: "INTERNAL_ERROR", message: errorMessage("INTERNAL_ERROR") };
      return withNoStore(NextResponse.json(body, { status: 500 }));
    }
  };
}

/** 讀 JSON body；不是合法 JSON → 400 */
export async function readJsonBody(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") throw badRequest();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest();
  }
}

/** 對外網址的 origin（登入 QR code 用）：優先使用反向代理帶的 x-forwarded-*（Vercel） */
export function requestOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host && /^[a-z0-9.\-:[\]]+$/i.test(host)) {
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }
  return req.nextUrl.origin;
}
