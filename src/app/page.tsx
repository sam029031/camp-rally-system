import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/server/auth";
import { homePathForSession } from "@/lib/server/session-info";

/**
 * 首頁「/」：只負責導向（第二十節「登入後自動導向自己的關卡頁／隊伍頁」）。
 * 未登入 → /login；STATION → /station/<game>/<code>；TEAM → /team；ADMIN → /admin；VIEWER → /dashboard。
 */
export default async function HomePage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  redirect(homePathForSession(session));
}
