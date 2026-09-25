import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dashboardGameForNow } from "@/lib/schedule";
import type { GameCode, SessionInfo, Slot } from "@/lib/types";
import { getSessionInfo } from "@/lib/server/auth";
import { getActiveEvent, getTeams } from "@/lib/server/db";
import { getAppNow } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import type { TeamProp, ViewerProp } from "./_components/helpers";
import { TeamLiveView } from "./_components/team-live-view";
import { TeamPicker } from "./_components/team-picker";

export const metadata: Metadata = { title: "隊輔頁" };

interface TeamPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface GoldSlotRow {
  slot_id: string;
  slot_number: number;
  scheduled_start: string;
  scheduled_end: string;
  original_start: string;
  original_end: string;
  total_offset_seconds: number | null;
}

function toSlot(r: GoldSlotRow): Slot | null {
  const scheduledStart = Date.parse(r.scheduled_start);
  const scheduledEnd = Date.parse(r.scheduled_end);
  if (Number.isNaN(scheduledStart) || Number.isNaN(scheduledEnd)) return null;
  const originalStart = Date.parse(r.original_start);
  const originalEnd = Date.parse(r.original_end);
  return {
    id: r.slot_id,
    number: r.slot_number,
    scheduledStart,
    scheduledEnd,
    originalStart: Number.isNaN(originalStart) ? scheduledStart : originalStart,
    originalEnd: Number.isNaN(originalEnd) ? scheduledEnd : originalEnd,
    totalOffsetMs: Number(r.total_offset_seconds ?? 0) * 1000,
  };
}

/**
 * 第十六節：依時間自動顯示目前的遊戲（規則同 /dashboard：黃金最後時段結束前 → 黃金，其後 → 大地）。
 * 「現在」用 app 時鐘（get_clock，Demo 模式也跟著走），時段用 v_slot_times（已含整場延後）。
 * 回傳黃金時段給 client，頁面開著跨過黃金結束時自動換到大地。
 */
async function pickAutoGame(client: SupabaseClient): Promise<{ game: GameCode; goldSlots: Slot[] }> {
  try {
    const event = await getActiveEvent(client);
    if (!event) return { game: "gold", goldSlots: [] };
    const [{ data, error }, now] = await Promise.all([
      client
        .from("v_slot_times")
        .select("slot_id,slot_number,scheduled_start,scheduled_end,original_start,original_end,total_offset_seconds")
        .eq("event_id", event.id)
        .eq("game_code", "gold")
        .order("slot_number"),
      getAppNow(client, event.id),
    ]);
    if (error) throw new Error(error.message);
    const goldSlots = ((data ?? []) as GoldSlotRow[]).map(toSlot).filter((s): s is Slot => s !== null);
    return { game: dashboardGameForNow(goldSlots, now), goldSlots };
  } catch (e) {
    console.error("[team] 無法判斷目前遊戲，預設黃金傳奇", e);
    return { game: "gold", goldSlots: [] };
  }
}

function firstParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : null;
}

function parseGame(v: string | null): GameCode | null {
  return v === "gold" || v === "land" ? v : null;
}

function viewerOf(session: SessionInfo): ViewerProp {
  return { identityId: session.identityId, role: session.role, ownTeam: session.team };
}

/**
 * /team：隊輔操作頁（第十六節）。
 * - TEAM → 自己的隊伍（可操作）；`?team=<代碼>` 看其他隊伍時唯讀。
 * - ADMIN → `?team=<代碼>` 選隊伍後可以操作（頂端顯示「以總召身分操作」）；沒帶 ?team 先顯示隊伍選單。
 * - 關主／唯讀 → 同上但只能查看。
 * - `?game=gold|land` 手動切換遊戲；不帶 = 依時間自動。
 * 資料本身由 client 端 useLiveGame 即時讀取；這裡只做 session、隊伍解析與初始遊戲判斷。
 */
export default async function TeamPage({ searchParams }: TeamPageProps) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const teamParam = firstParam(sp.team);
  const explicitGame = parseGame(firstParam(sp.game));

  const client = getServiceClient();
  const [teamRows, auto] = await Promise.all([getTeams(client), pickAutoGame(client)]);
  const teams: TeamProp[] = teamRows.map((t) => ({ id: t.id, code: t.code, name: t.name, isStaffTeam: t.is_staff_team }));
  const viewer = viewerOf(session);

  let team: TeamProp | null = null;
  let notFoundCode: string | null = null;
  if (teamParam) {
    const wanted = teamParam.toUpperCase();
    team = teams.find((t) => t.code.toUpperCase() === wanted) ?? null;
    if (!team) notFoundCode = teamParam;
  } else if (session.role === "TEAM" && session.team) {
    team = teams.find((t) => t.id === session.team?.id) ?? session.team;
  }

  if (!team) {
    return (
      <TeamPicker
        teams={teams}
        viewer={viewer}
        explicitGame={explicitGame}
        initialAutoGame={auto.game}
        goldSlots={auto.goldSlots}
        notFoundCode={notFoundCode}
      />
    );
  }

  // TEAM 用 ?team 指到自己的隊伍 → 視同沒帶（換遊戲、回到我的隊伍的連結都用 /team）
  const ownView = session.role === "TEAM" && session.team?.id === team.id;

  return (
    <TeamLiveView
      key={team.id}
      team={team}
      viewer={viewer}
      explicitGame={explicitGame}
      initialAutoGame={auto.game}
      goldSlots={auto.goldSlots}
      teamParam={ownView ? null : team.code}
    />
  );
}
