import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { GameCode } from "@/lib/types";
import { getSessionInfo } from "@/lib/server/auth";
import { getActiveEvent } from "@/lib/server/db";
import { getAppEnv, isDemoAllowed } from "@/lib/server/env";
import { getAppNow } from "@/lib/server/rpc";
import { homePathForSession } from "@/lib/server/session-info";
import { getServiceClient } from "@/lib/server/supabase";
import { parseDbTimestamp } from "@/lib/server/time-input";
import { AdminShell } from "@/app/admin/_components/admin-shell";

export const metadata: Metadata = { title: "總召管理" };

function parseGame(v: string | string[] | undefined): GameCode | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "gold" || s === "land" ? s : null;
}

/**
 * 沒有指定遊戲時的預設（與 /dashboard 相同規則）：app 時間在黃金最後時段結束前 → 黃金，其後 → 大地。
 * 讀取失敗時退回黃金（頁面仍可手動切換）。
 */
async function defaultGame(): Promise<GameCode> {
  try {
    const client = getServiceClient();
    const event = await getActiveEvent(client);
    if (!event) return "gold";
    const { data, error } = await client
      .from("v_slot_times")
      .select("scheduled_end")
      .eq("event_id", event.id)
      .eq("game_code", "gold");
    if (error || !data || data.length === 0) return "gold";
    let lastEnd = -Infinity;
    for (const row of data as Array<{ scheduled_end: string }>) {
      const ms = parseDbTimestamp(row.scheduled_end);
      if (ms !== null && ms > lastEnd) lastEnd = ms;
    }
    if (!Number.isFinite(lastEnd)) return "gold";
    const now = await getAppNow(client, event.id);
    return now < lastEnd ? "gold" : "land";
  } catch (e) {
    console.error("[admin] 判斷預設遊戲失敗", e);
    return "gold";
  }
}

/** /admin：總召管理頁（第二十五節）。只有 ADMIN；其他身分導回自己的首頁，未登入 → /login。 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect(homePathForSession(session));

  const sp = await searchParams;
  const initialGame = parseGame(sp.game) ?? (await defaultGame());

  return <AdminShell session={session} initialGame={initialGame} demoAllowed={isDemoAllowed()} appEnv={getAppEnv()} />;
}
