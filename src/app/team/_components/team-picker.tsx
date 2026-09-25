"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Eye, SearchX, UserRound } from "lucide-react";
import { GAME_NAMES } from "@/lib/constants";
import { teamName, teamStatusText } from "@/lib/labels";
import type { GameCode, Slot } from "@/lib/types";
import { useLiveGame } from "@/lib/client/use-live-game";
import { useNotificationWatcher } from "@/lib/client/use-notification-watcher";
import { LiveTopBar, type GameSwitchLink } from "@/components/live-top-bar";
import { NotificationCenter } from "@/components/notification-center";
import { TeamStateBadge } from "@/components/state-badges";
import type { TeamProp, ViewerProp } from "./helpers";
import { teamPageHref } from "./href";
import { useFollowAutoGame } from "./use-auto-game";

export interface TeamPickerProps {
  /** 所有隊伍（依 sort_order；含幹部隊） */
  teams: TeamProp[];
  viewer: ViewerProp;
  explicitGame: GameCode | null;
  initialAutoGame: GameCode;
  goldSlots: Slot[];
  /** 網址上的 ?team 找不到對應隊伍時的代碼 */
  notFoundCode: string | null;
}

const GAME_CODES: readonly GameCode[] = ["gold", "land"];

/**
 * 隊輔頁的隊伍選單：ADMIN／關主／唯讀身分打開 /team（沒有 ?team）時先選要看的隊伍。
 * 每隊顯示目前狀態（同一組推導 function），點進去是 /team?team=<代碼>。
 */
export function TeamPicker({ teams, viewer, explicitGame, initialAutoGame, goldSlots, notFoundCode }: TeamPickerProps) {
  const [autoGame, setAutoGame] = React.useState<GameCode>(initialAutoGame);
  const gameCode = explicitGame ?? autoGame;
  const live = useLiveGame(gameCode);
  const { snapshot, derived } = live;
  useFollowAutoGame({ explicitGame, gameCode, live, serverGoldSlots: goldSlots, setAutoGame });

  const [centerOpen, setCenterOpen] = React.useState(false);
  const openCenter = React.useCallback(() => setCenterOpen(true), []);
  const watcher = useNotificationWatcher({
    snapshot,
    derived,
    context: { page: "team", teamId: null },
    realNow: live.realNow,
    online: live.status.online,
    refetch: live.refetch,
    onOpenCenter: openCenter,
  });
  const { markAllRead } = watcher;
  React.useEffect(() => {
    if (centerOpen) markAllRead();
  }, [centerOpen, markAllRead]);

  const gameLinks: GameSwitchLink[] = GAME_CODES.map((code) => ({
    code,
    label: GAME_NAMES[code],
    href: teamPageHref({ game: code, team: null }),
    active: code === gameCode,
  }));

  const canOperateAny = viewer.role === "ADMIN";
  const gameName = GAME_NAMES[gameCode];

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <LiveTopBar
        title="隊輔頁"
        subtitle={`選擇隊伍・${gameName}`}
        gameLinks={gameLinks}
        live={live}
        unreadCount={watcher.unreadCount}
        onOpenNotifications={openCenter}
      >
        {explicitGame && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-200 px-4 py-1.5 text-base font-bold text-slate-800">
            <span>已手動切換到{GAME_NAMES[explicitGame]}</span>
            <Link href={teamPageHref({ game: null, team: null })} className="inline-flex h-10 items-center underline underline-offset-4">
              改回依時間自動
            </Link>
          </div>
        )}
      </LiveTopBar>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-4">
        {notFoundCode && (
          <p className="flex items-center gap-2 rounded-2xl border-2 border-red-600 bg-red-50 px-4 py-3 text-xl font-black text-red-800">
            <SearchX className="size-6 shrink-0" aria-hidden />
            找不到隊伍「{notFoundCode}」，請從下面選擇。
          </p>
        )}

        {viewer.role === "TEAM" && viewer.ownTeam && (
          <Link
            href={teamPageHref({ game: explicitGame, team: null })}
            className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-blue-700 px-4 text-xl font-black text-white shadow-sm"
          >
            <UserRound className="size-6" aria-hidden />
            前往我的隊伍（{teamName(viewer.ownTeam)}）
          </Link>
        )}

        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-black text-slate-950">選擇要查看的隊伍</h2>
          <p className="flex items-center gap-2 text-lg font-bold text-slate-700">
            {canOperateAny ? (
              "總召可以代替隊輔操作（頁面會標示「以總召身分操作」）。"
            ) : (
              <>
                <Eye className="size-5 shrink-0" aria-hidden />
                唯讀檢視：只能查看，不能操作。
              </>
            )}
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-3">
          {teams.map((team) => {
            const td = derived?.teams.get(team.id) ?? null;
            const cur = td?.currentAssignmentId ? (derived?.assignments.get(td.currentAssignmentId) ?? null) : null;
            let status: React.ReactNode;
            if (!derived) {
              status = <span className="text-base font-bold text-slate-500">讀取中…</span>;
            } else if (!td) {
              status = <span className="text-base font-bold text-slate-600">沒有參加{gameName}</span>;
            } else {
              status = (
                <>
                  <TeamStateBadge
                    state={td.state}
                    arrivedDetail={td.arrivedDetail}
                    overdueFirstStation={td.overdueFirstStation}
                    transitionWarning={td.transitionWarning}
                    stationState={cur?.state ?? null}
                    size="sm"
                    solid
                  />
                  {cur && td.state !== "COMPLETED" && (
                    <span className="block truncate text-base font-bold text-slate-800">{cur.station.name}</span>
                  )}
                  {(td.state === "TRANSITIONING" || td.state === "TRANSITION_OVERDUE") && (
                    <span className="timer-digits block text-base font-bold text-slate-700">{teamStatusText(td)}</span>
                  )}
                </>
              );
            }
            return (
              <li key={team.id}>
                <Link
                  href={teamPageHref({ game: explicitGame, team: team.code })}
                  className="flex min-h-20 items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 shadow-sm hover:border-slate-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="text-2xl font-black text-slate-950">{teamName(team)}</span>
                    {status}
                  </span>
                  <ChevronRight className="size-7 shrink-0 text-slate-500" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </main>

      <NotificationCenter open={centerOpen} onClose={() => setCenterOpen(false)} notifications={watcher.notifications} />
    </div>
  );
}
