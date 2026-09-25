import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssignmentRow,
  EventRow,
  GameRow,
  IdentityRow,
  StationRow,
  TeamRow,
} from "@/lib/types";

/**
 * Service role 的小查詢（Route Handler 權限判斷與組字用）。
 * 狀態推導一律走 loadGameSnapshot + deriveGame，不在這裡算。
 */

export class DbFailure extends Error {
  constructor(what: string, detail: unknown) {
    super(`讀取 ${what} 失敗：${detail && typeof detail === "object" && "message" in detail ? String((detail as { message: unknown }).message) : String(detail)}`);
    this.name = "DbFailure";
  }
}

async function single<T>(
  what: string,
  q: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new DbFailure(what, error);
  return (data as T | null) ?? null;
}

async function many<T>(what: string, q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new DbFailure(what, error);
  return (data as T[] | null) ?? [];
}

export function getActiveEvent(client: SupabaseClient): Promise<EventRow | null> {
  return single<EventRow>("events", client.from("events").select("*").eq("is_active", true).maybeSingle());
}

export function getEvent(client: SupabaseClient, id: string): Promise<EventRow | null> {
  return single<EventRow>("events", client.from("events").select("*").eq("id", id).maybeSingle());
}

export function getGame(client: SupabaseClient, id: string): Promise<GameRow | null> {
  return single<GameRow>("games", client.from("games").select("*").eq("id", id).maybeSingle());
}

export function getGamesOfEvent(client: SupabaseClient, eventId: string): Promise<GameRow[]> {
  return many<GameRow>(
    "games",
    client.from("games").select("*").eq("event_id", eventId).order("sort_order", { ascending: true }),
  );
}

export function getAllGames(client: SupabaseClient): Promise<GameRow[]> {
  return many<GameRow>("games", client.from("games").select("*"));
}

export function getAssignment(client: SupabaseClient, id: string): Promise<AssignmentRow | null> {
  return single<AssignmentRow>(
    "assignments",
    client.from("assignments").select("id, game_id, slot_id, station_id, team_a_id, team_b_id").eq("id", id).maybeSingle(),
  );
}

export function getAssignments(client: SupabaseClient, ids: string[]): Promise<AssignmentRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return many<AssignmentRow>(
    "assignments",
    client.from("assignments").select("id, game_id, slot_id, station_id, team_a_id, team_b_id").in("id", ids),
  );
}

export function getStation(client: SupabaseClient, id: string): Promise<StationRow | null> {
  return single<StationRow>("stations", client.from("stations").select("*").eq("id", id).maybeSingle());
}

export function getAllStations(client: SupabaseClient): Promise<StationRow[]> {
  return many<StationRow>("stations", client.from("stations").select("*"));
}

export function getTeam(client: SupabaseClient, id: string): Promise<TeamRow | null> {
  return single<TeamRow>("teams", client.from("teams").select("*").eq("id", id).maybeSingle());
}

export function getTeams(client: SupabaseClient, ids?: string[]): Promise<TeamRow[]> {
  const q = client.from("teams").select("*").order("sort_order", { ascending: true });
  return many<TeamRow>("teams", ids ? q.in("id", ids) : q);
}

/** 身分（不含 pin_hash） */
export type IdentityPublic = Omit<IdentityRow, "pin_hash">;
const IDENTITY_PUBLIC_COLUMNS = "id, role, station_id, team_id, label, pin_version, is_active, created_at, updated_at";

export function getIdentity(client: SupabaseClient, id: string): Promise<IdentityPublic | null> {
  return single<IdentityPublic>(
    "identities",
    client.from("identities").select(IDENTITY_PUBLIC_COLUMNS).eq("id", id).maybeSingle(),
  );
}

/** 登入比對用：只在 /api/auth/login 使用，hash 不可以回傳給前端 */
export function getIdentityWithHash(client: SupabaseClient, id: string): Promise<IdentityRow | null> {
  return single<IdentityRow>("identities", client.from("identities").select("*").eq("id", id).maybeSingle());
}

export function getAllIdentities(client: SupabaseClient): Promise<IdentityPublic[]> {
  return many<IdentityPublic>("identities", client.from("identities").select(IDENTITY_PUBLIC_COLUMNS));
}
