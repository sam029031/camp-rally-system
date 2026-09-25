import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadActiveEvent } from "@/lib/data/snapshot";
import { getSessionInfo } from "@/lib/server/auth";
import { getAppNow } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";
import { dashboardGameForNow } from "@/lib/schedule";
import type { GameCode, Slot } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

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
 * 第十一節：/dashboard 自動導向 — 黃金最後時段結束前 → 黃金，其後 → 大地。
 * 「現在」用 app 時鐘（get_clock，Demo 模式也跟著走），時段用 v_slot_times（已含整場延後）。
 */
async function pickGame(): Promise<GameCode> {
  try {
    const client = getServiceClient();
    const event = await loadActiveEvent(client);
    if (!event) return "gold";
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
    const slots = ((data ?? []) as GoldSlotRow[]).map(toSlot).filter((s): s is Slot => s !== null);
    return dashboardGameForNow(slots, now);
  } catch (e) {
    console.error("[dashboard] 無法判斷目前遊戲，預設黃金傳奇", e);
    return "gold";
  }
}

export default async function DashboardIndexPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const game = await pickGame();
  redirect(`/dashboard/${game}`);
}
