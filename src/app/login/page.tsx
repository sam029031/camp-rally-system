import type { Metadata } from "next";
import { getSessionInfo } from "@/lib/server/auth";
import { homePathForSession } from "@/lib/server/session-info";
import { LoginClient } from "./_components/login-client";

export const metadata: Metadata = { title: "登入" };

/**
 * /login（第二十節）：身分類型 → 關主選遊戲與關卡／隊輔選隊伍／總召／唯讀 → 6 位數 PIN。
 * - 已登入：顯示「目前登入」，可前往自己的頁面或登出，也可以改用其他身分登入。
 * - `?identity=<id>`：PIN 總表的 QR code 連到這裡，預先選好身分並直接跳到輸入 PIN。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [session, params] = await Promise.all([getSessionInfo(), searchParams]);
  const raw = params.identity;
  const identityParam = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;

  return (
    <LoginClient
      currentSession={session ? { label: session.label, role: session.role, homePath: homePathForSession(session) } : null}
      identityParam={identityParam}
    />
  );
}
