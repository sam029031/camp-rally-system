import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameCode, Role } from "@/lib/types";
import {
  getActiveEvent,
  getAllGames,
  getAllIdentities,
  getAllStations,
  getTeams,
  type IdentityPublic,
} from "@/lib/server/db";

/**
 * 身分清單（登入頁選單、PIN 總表共用；不含 PIN hash）。
 * 排序：總召 → 關主（遊戲、關卡順序）→ 隊輔（隊伍順序）→ 唯讀。
 * 關主只列目前活動（is_active event）的關卡，避免測試或舊活動的身分混進來。
 */
export interface IdentityEntry {
  identity: IdentityPublic;
  gameCode: GameCode | null;
  gameName: string | null;
  stationCode: string | null;
  stationName: string | null;
  teamCode: string | null;
  teamName: string | null;
}

const ROLE_ORDER: Record<Role, number> = { ADMIN: 0, STATION: 1, TEAM: 2, VIEWER: 3 };

export async function listIdentityEntries(
  client: SupabaseClient,
  opts: { includeInactive: boolean },
): Promise<IdentityEntry[]> {
  const [identities, stations, games, teams, activeEvent] = await Promise.all([
    getAllIdentities(client),
    getAllStations(client),
    getAllGames(client),
    getTeams(client),
    getActiveEvent(client),
  ]);
  const gameById = new Map(games.map((g) => [g.id, g]));
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const rows: Array<{ entry: IdentityEntry; k: [number, number, number, string] }> = [];
  for (const identity of identities) {
    if (!opts.includeInactive && !identity.is_active) continue;
    const entry: IdentityEntry = {
      identity,
      gameCode: null,
      gameName: null,
      stationCode: null,
      stationName: null,
      teamCode: null,
      teamName: null,
    };
    let k: [number, number, number, string] = [ROLE_ORDER[identity.role], 0, 0, identity.label];

    if (identity.role === "STATION") {
      const st = identity.station_id ? stationById.get(identity.station_id) : undefined;
      const game = st ? gameById.get(st.game_id) : undefined;
      if (!st || !game) continue;
      if (activeEvent && game.event_id !== activeEvent.id) continue;
      entry.gameCode = game.code;
      entry.gameName = game.name;
      entry.stationCode = st.code;
      entry.stationName = st.name;
      k = [ROLE_ORDER.STATION, game.sort_order, st.sort_order, st.code];
    } else if (identity.role === "TEAM") {
      const team = identity.team_id ? teamById.get(identity.team_id) : undefined;
      if (!team) continue;
      entry.teamCode = team.code;
      entry.teamName = team.name;
      k = [ROLE_ORDER.TEAM, team.sort_order, 0, team.code];
    }
    rows.push({ entry, k });
  }

  rows.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const d = (a.k[i] as number) - (b.k[i] as number);
      if (d !== 0) return d;
    }
    return a.k[3].localeCompare(b.k[3], "zh-Hant");
  });
  return rows.map((r) => r.entry);
}
