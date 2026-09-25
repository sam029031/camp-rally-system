import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { GAME_NAMES } from "@/lib/constants";
import { teamName } from "@/lib/labels";
import type { GameCode, SessionInfo } from "@/lib/types";
import { getSessionInfo } from "@/lib/server/auth";
import { getActiveEvent } from "@/lib/server/db";
import { homePathForSession } from "@/lib/server/session-info";
import { getServiceClient } from "@/lib/server/supabase";
import { StationClient, type ReadOnlyNotice } from "./_components/station-client";

interface StationRouteParams {
  game: string;
  code: string;
}

interface StationPageProps {
  params: Promise<StationRouteParams>;
}

interface StationLookup {
  gameCode: GameCode;
  gameName: string;
  stationId: string;
  stationCode: string;
  stationName: string;
}

function isGameCode(x: string): x is GameCode {
  return x === "gold" || x === "land";
}

function normalizeCode(raw: string): string {
  let s = raw;
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // 不合法的編碼：原樣比對（找不到就 404）
    }
  }
  return s.trim().toUpperCase();
}

/** 目前活動（is_active）中，該遊戲的該關卡；不存在回 null（同一個 request 內 generateMetadata 與 page 共用） */
const lookupStation = cache(async (gameCode: GameCode, code: string): Promise<StationLookup | null> => {
  const client = getServiceClient();
  const event = await getActiveEvent(client);
  if (!event) return null;
  const { data: game, error: gameError } = await client
    .from("games")
    .select("id, code, name")
    .eq("event_id", event.id)
    .eq("code", gameCode)
    .maybeSingle<{ id: string; code: GameCode; name: string }>();
  if (gameError) throw new Error(`讀取遊戲失敗：${gameError.message}`);
  if (!game) return null;
  const { data: station, error: stationError } = await client
    .from("stations")
    .select("id, code, name")
    .eq("game_id", game.id)
    .eq("code", code)
    .maybeSingle<{ id: string; code: string; name: string }>();
  if (stationError) throw new Error(`讀取關卡失敗：${stationError.message}`);
  if (!station) return null;
  return {
    gameCode,
    gameName: game.name || GAME_NAMES[gameCode],
    stationId: station.id,
    stationCode: station.code,
    stationName: station.name,
  };
});

/** 非本關身分的唯讀提示（第十七節：「你登入的是 A 關，前往我的關卡」） */
function readOnlyNoticeFor(session: SessionInfo, target: StationLookup): ReadOnlyNotice {
  const href = homePathForSession(session);
  switch (session.role) {
    case "STATION": {
      const st = session.station;
      if (!st) return { text: "你登入的關主身分沒有對應的關卡，本頁只能查看", href: "/dashboard", linkLabel: "前往 Dashboard" };
      const gamePrefix = st.gameCode !== target.gameCode ? `${GAME_NAMES[st.gameCode]} ` : "";
      return { text: `你登入的是 ${gamePrefix}${st.code} 關（${st.name}）`, href, linkLabel: "前往我的關卡" };
    }
    case "TEAM": {
      const who = session.team ? `${teamName(session.team)}隊輔` : "隊輔";
      return { text: `你登入的是 ${who}，本頁只能查看`, href, linkLabel: "前往我的隊伍" };
    }
    case "VIEWER":
    default:
      return { text: "你登入的是唯讀身分，本頁只能查看", href, linkLabel: "前往 Dashboard" };
  }
}

export async function generateMetadata({ params }: StationPageProps): Promise<Metadata> {
  const { game, code } = await params;
  if (!isGameCode(game)) return { title: "找不到關卡" };
  const found = await lookupStation(game, normalizeCode(code));
  if (!found) return { title: "找不到關卡" };
  return { title: `${found.stationCode} ${found.stationName}｜${found.gameName}` };
}

/**
 * /station/[game]/[code]：關主頁（第十七、十八節）。
 * - 需要登入；本關 STATION 或 ADMIN 才有按鈕（ADMIN 顯示「以總召身分操作」），其他身分唯讀並提示前往自己的頁面。
 * - 資料一律在 client 端由 useLiveGame 即時讀取與推導（refresh 後狀態不會消失）。
 */
export default async function StationPage({ params }: StationPageProps) {
  const { game, code } = await params;
  if (!isGameCode(game)) notFound();

  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const normalized = normalizeCode(code);
  const found = await lookupStation(game, normalized);
  if (!found) notFound();
  if (code !== found.stationCode) redirect(`/station/${game}/${encodeURIComponent(found.stationCode)}`);

  const isAdmin = session.role === "ADMIN";
  const isOwnStation = session.role === "STATION" && session.station?.id === found.stationId;
  const canOperate = isAdmin || isOwnStation;

  return (
    <StationClient
      gameCode={found.gameCode}
      gameName={found.gameName}
      stationId={found.stationId}
      stationCode={found.stationCode}
      stationName={found.stationName}
      identityId={session.identityId}
      canOperate={canOperate}
      actingAsAdmin={isAdmin}
      readOnlyNotice={canOperate ? null : readOnlyNoticeFor(session, found)}
    />
  );
}
