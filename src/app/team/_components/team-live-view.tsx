"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, Loader2, RefreshCw, Users } from "lucide-react";
import { GAME_NAMES } from "@/lib/constants";
import { undoExpiredMessage } from "@/lib/errors";
import { slotLabel, teamName } from "@/lib/labels";
import { formatHm } from "@/lib/time";
import type { CheckRecordRow, GameCode, GameSnapshot, Slot } from "@/lib/types";
import { useLiveGame, useSchedulePeek } from "@/lib/client/use-live-game";
import { useNotificationWatcher } from "@/lib/client/use-notification-watcher";
import { useUndo } from "@/lib/client/use-undo";
import { Button } from "@/components/ui/button";
import { LiveTopBar, type GameSwitchLink } from "@/components/live-top-bar";
import { NotificationCenter } from "@/components/notification-center";
import { UndoButton } from "@/components/undo-button";
import { UndoReminderDialog } from "@/components/undo-reminder-dialog";
import { WakeLockHint } from "@/components/wake-lock-hint";
import { CurrentCard } from "./current-card";
import { RouteList } from "./route-list";
import { firstStop, latestOwnRecord, toLocalRecord, type LocalRecord, type TeamProp, type ViewerProp } from "./helpers";
import { teamPageHref } from "./href";
import { useFollowAutoGame } from "./use-auto-game";

export interface TeamLiveViewProps {
  team: TeamProp;
  viewer: ViewerProp;
  /** 網址手動指定的遊戲；null = 依時間自動 */
  explicitGame: GameCode | null;
  /** server 依 app 時鐘與黃金時段算出的遊戲（dashboardGameForNow） */
  initialAutoGame: GameCode;
  /** server 讀到的黃金時段（含整場延後），頁面開著時判斷是否換到大地 */
  goldSlots: Slot[];
  /** 網址上的 ?team（ADMIN／其他身分看指定隊伍）；TEAM 看自己隊伍時為 null */
  teamParam: string | null;
}

const WAKE_STATES = new Set(["TRANSITIONING", "TRANSITION_OVERDUE", "ARRIVED", "AT_STATION"]);
const GAME_CODES: readonly GameCode[] = ["gold", "land"];

/**
 * 隊輔頁本體（第十六節）：整頁只呼叫一次 useLiveGame（顯示中的遊戲）；
 * 跨遊戲資訊（下午大地第一站）用 useSchedulePeek。
 */
export function TeamLiveView({ team, viewer, explicitGame, initialAutoGame, goldSlots, teamParam }: TeamLiveViewProps) {
  const [autoGame, setAutoGame] = React.useState<GameCode>(initialAutoGame);
  const gameCode = explicitGame ?? autoGame;
  const live = useLiveGame(gameCode);
  const { snapshot, derived } = live;
  useFollowAutoGame({ explicitGame, gameCode, live, serverGoldSlots: goldSlots, setAutoGame });

  const canOperate = viewer.role === "ADMIN" || (viewer.role === "TEAM" && viewer.ownTeam?.id === team.id);

  // ---- 通知 ----
  const [centerOpen, setCenterOpen] = React.useState(false);
  const openCenter = React.useCallback(() => setCenterOpen(true), []);
  const watcher = useNotificationWatcher({
    snapshot,
    derived,
    context: { page: "team", teamId: team.id },
    realNow: live.realNow,
    online: live.status.online,
    refetch: live.refetch,
    onOpenCenter: openCenter,
  });
  const { markAllRead } = watcher;
  React.useEffect(() => {
    if (centerOpen) markAllRead();
  }, [centerOpen, markAllRead]);

  // ---- 本機剛按下的紀錄（快照重抓前即時顯示）與撤銷 ----
  const [localRecords, setLocalRecords] = React.useState<LocalRecord[]>([]);
  const [undoneIds, setUndoneIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [undoEpoch, setUndoEpoch] = React.useState(0);

  const onRecorded = React.useCallback((record: CheckRecordRow) => {
    const lr = toLocalRecord(record);
    setLocalRecords((prev) => [...prev.filter((r) => r.id !== lr.id), lr]);
  }, []);

  const undo = useUndo({
    refetch: live.refetch,
    onUndone: (recordId) => {
      setUndoneIds((prev) => {
        const next = new Set(prev);
        next.add(recordId);
        return next;
      });
      setUndoEpoch((e) => e + 1);
    },
  });

  const knownIds = React.useMemo(() => new Set(snapshot ? snapshot.records.map((r) => r.id) : []), [snapshot]);
  const pressedIds = React.useMemo(() => new Set(localRecords.map((r) => r.id)), [localRecords]);

  const td = derived?.teams.get(team.id) ?? null;

  // 黃金完成後顯示「下午大地第一站」；幹部隊上午顯示「不參加黃金傳奇」
  const needLand = gameCode === "gold" && (team.isStaffTeam || td?.state === "COMPLETED");
  const landPeek = useSchedulePeek("land", needLand);

  const wakeActive = td !== null && WAKE_STATES.has(td.state);

  const gameLinks: GameSwitchLink[] = GAME_CODES.map((code) => ({
    code,
    label: GAME_NAMES[code],
    href: teamPageHref({ game: code, team: teamParam }),
    active: code === gameCode,
  }));

  const ownRecord =
    canOperate && snapshot ? latestOwnRecord(snapshot, team.id, viewer.identityId, localRecords, knownIds, undoneIds) : null;
  const leadTitle = snapshot?.event.leadTitle ?? "活動長";

  const gameName = snapshot?.game.name ?? GAME_NAMES[gameCode];
  const tName = teamName(team);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <LiveTopBar
        title={tName}
        subtitle={`隊輔頁・${gameName}`}
        gameLinks={gameLinks}
        live={live}
        unreadCount={watcher.unreadCount}
        onOpenNotifications={openCenter}
        actingAsAdmin={viewer.role === "ADMIN"}
      >
        <WakeLockHint active={wakeActive} />
        {explicitGame && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-200 px-4 py-1.5 text-base font-bold text-slate-800">
            <span>已手動切換到{GAME_NAMES[explicitGame]}</span>
            <Link href={teamPageHref({ game: null, team: teamParam })} className="inline-flex h-10 items-center underline underline-offset-4">
              改回依時間自動
            </Link>
          </div>
        )}
        <ViewerBanner viewer={viewer} team={team} canOperate={canOperate} explicitGame={explicitGame} />
      </LiveTopBar>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-3 py-4">
        {!snapshot || !derived ? (
          <LoadingState error={live.status.error} onRetry={live.refetch} />
        ) : !td ? (
          team.isStaffTeam && gameCode === "gold" ? (
            <StaffGoldCard team={team} landPeek={landPeek} />
          ) : (
            <section className="rounded-3xl border-4 border-slate-300 bg-white p-5">
              <p className="text-2xl font-black text-slate-950">
                {tName}沒有參加{gameName}。
              </p>
            </section>
          )
        ) : (
          <>
            <CurrentCard
              gameCode={gameCode}
              snapshot={snapshot}
              derived={derived}
              td={td}
              team={team}
              now={live.now}
              getNow={live.getNow}
              canOperate={canOperate}
              local={localRecords}
              knownIds={knownIds}
              undoneIds={undoneIds}
              undoEpoch={undoEpoch}
              landPeek={landPeek}
              refetch={live.refetch}
              onRecorded={onRecorded}
            />
            {canOperate && ownRecord && (
              <UndoButton
                key={ownRecord.id}
                record={ownRecord}
                realNow={live.realNow}
                onUndo={undo.undo}
                pending={undo.pending}
                error={undo.error}
                expiredHint={pressedIds.has(ownRecord.id) ? undoExpiredMessage(leadTitle) : null}
              />
            )}
            <RouteList snapshot={snapshot} derived={derived} teamId={team.id} td={td} />
          </>
        )}
      </main>

      <NotificationCenter open={centerOpen} onClose={() => setCenterOpen(false)} notifications={watcher.notifications} />
      <UndoReminderDialog reminder={undo.reminder} onClose={undo.dismissReminder} />
    </div>
  );
}

function ViewerBanner({
  viewer,
  team,
  canOperate,
  explicitGame,
}: {
  viewer: ViewerProp;
  team: TeamProp;
  canOperate: boolean;
  explicitGame: GameCode | null;
}) {
  if (viewer.role === "TEAM" && viewer.ownTeam && viewer.ownTeam.id !== team.id) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-2 text-lg font-bold text-amber-950">
        <Eye className="size-5 shrink-0" aria-hidden />
        <span>你登入的是{teamName(viewer.ownTeam)}，這裡只能查看</span>
        <Link href={teamPageHref({ game: explicitGame, team: null })} className="inline-flex h-11 items-center underline underline-offset-4">
          前往我的隊伍
        </Link>
      </div>
    );
  }
  if (viewer.role === "TEAM") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-200 px-4 py-1.5 text-base font-bold text-slate-800">
      {!canOperate && (
        <span className="inline-flex items-center gap-1">
          <Eye className="size-5 shrink-0" aria-hidden />
          唯讀檢視：只能查看，不能操作
        </span>
      )}
      <Link href={teamPageHref({ game: explicitGame, team: null })} className="inline-flex h-10 items-center gap-1 underline underline-offset-4">
        <Users className="size-5" aria-hidden />
        換隊伍
      </Link>
    </div>
  );
}

function LoadingState({ error, onRetry }: { error: string | null; onRetry: () => Promise<void> }) {
  if (error) {
    return (
      <section className="flex flex-col gap-4 rounded-3xl border-4 border-red-600 bg-red-50 p-5">
        <p className="text-xl font-black text-red-800">{error}</p>
        <Button variant="secondary" size="lg" block onClick={() => void onRetry()}>
          <RefreshCw className="size-6" aria-hidden />
          重新讀取
        </Button>
      </section>
    );
  }
  return (
    <section className="flex items-center justify-center gap-3 rounded-3xl border-2 border-slate-300 bg-white p-8 text-xl font-bold text-slate-700">
      <Loader2 className="size-7 animate-spin" aria-hidden />
      讀取中…
    </section>
  );
}

/** 幹部隊在黃金時段打開 /team（第十六節） */
function StaffGoldCard({
  team,
  landPeek,
}: {
  team: TeamProp;
  landPeek: { snapshot: GameSnapshot | null; loading: boolean; error: string | null };
}) {
  const stop = landPeek.snapshot ? firstStop(landPeek.snapshot, team.id) : null;
  return (
    <section className="flex flex-col gap-3 rounded-3xl border-4 border-slate-400 bg-slate-50 p-5">
      <p className="text-3xl font-black leading-snug text-slate-950">
        幹部隊不參加黃金傳奇，下午大地第一站：
        {stop ? (
          <span className="timer-digits">
            {stop.station.name} {formatHm(stop.slot.scheduledStart)}
          </span>
        ) : landPeek.loading ? (
          "讀取中…"
        ) : (
          "（無法讀取）"
        )}
      </p>
      {stop && <p className="text-xl font-bold text-slate-700">{slotLabel(stop.slot.number)}</p>}
      {!stop && landPeek.error && <p className="text-lg font-bold text-red-700">{landPeek.error}</p>}
    </section>
  );
}
