import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE } from "@/lib/constants";

/**
 * Next.js 16 Proxy（原 middleware）：第一次開頁時發 device_id cookie（第二十節，登入鎖定用）。
 * - httpOnly、1 年、隨機 uuid。
 * - 同時寫進這次 request 的 cookie，讓後面的 Route Handler（例如 /api/auth/login）立刻讀得到。
 * - 不做登入判斷：權限一律在 Route Handler / Server Component 內驗證。
 */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]!.trim().toLowerCase() === "https";
  return request.nextUrl.protocol === "https:";
}

export function proxy(request: NextRequest) {
  if (request.cookies.has(DEVICE_COOKIE)) return NextResponse.next();

  const deviceId = crypto.randomUUID();
  request.cookies.set(DEVICE_COOKIE, deviceId);
  const response = NextResponse.next({ request: { headers: new Headers(request.headers) } });
  response.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    // 依實際協定決定（Vercel 一律 https）；本機／區網 http 測試時不加 Secure，否則瀏覽器拒收
    secure: isHttps(request),
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}

export const config = {
  matcher: [
    // 排除靜態檔、圖片最佳化、PWA 圖示與 manifest
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|js|css|map)$).*)",
  ],
};
