"use client";

import * as React from "react";
import Link from "next/link";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { GAME_NAMES } from "@/lib/constants";
import { stationRowsForSlot } from "@/lib/derive";
import type { AppNotification, GameCode } from "@/lib/types";
import { useLiveGame } from "@/lib/client/use-live-game";
import { useNotificationWatcher } from "@/lib/client/use-notification-watcher";
import { ExtendDialog } from "@/components/admin-actions";
import { LiveTopBar, type GameSwitchLink } from "@/components/live-top-bar";
import { NotificationCenter } from "@/components/notification-center";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { GoldStations } from "@/app/dashboard/_components/gold-stations";
import { LandStations } from "@/app/dashboard/_components/land-stations";
import { toRowModels } from "@/app/dashboard/_components/row-model";
import { SlotPanel } from "@/app/dashboard/_components/slot-panel";
import { SummaryBar } from "@/app/dashboard/_components/summary-bar";
import { TeamView } from "@/app/dashboard/_components/team-view";
import { buildLookup } from "@/app/dashboard/_components/view-model";

type TabValue = "stations" | "teams";

const DASHBOARD_CONTEXT = { page: "dashboard" } as const;

export interface DashboardClientProps {
  game: GameCode;
  isAdmin: boolean;
  /** 登入身分名稱（頂端副標題） */
  roleLabel: string;
}

/**
 * 總 Dashboard（第十一～十五、十九節）。
 * 所有狀態由 useLiveGame（deriveGame + app 時鐘）每秒推導；時段切換只改變瀏覽的時段，不影響倒數、狀態、通知。
 */
export function DashboardClient({ game, isAdmin, roleLabel }: DashboardClientProps) {
  const live = useLiveGame(game);
  const { snapshot, derived, now } = live;

  const [viewedSlot, setViewedSlot] = React.useState<number | null>(null);
  const [tab, setTab] = React.useState<TabValue>("stations");
  const [anomaliesOnly, setAnomaliesOnly] = React.useState(false);
  const [centerOpen, setCenterOpen] = React.useState(false);
  const [extendAssignmentId, setExtendAssignmentId] = React.useState<string | null>(null);

  const watcher = useNotificationWatcher({
    snapshot,
    derived,
    context: DASHBOARD_CONTEXT,
    realNow: live.realNow,
    online: live.status.online,
    refetch: live.refetch,
    onOpenCenter: () => setCenterOpen(true),
  });
  const { markAllRead, unreadCount } = watcher;

  // 通知中心開著時，新進來的通知也算已讀（Toast 的「查看」與鈴鐺都走這裡）
  React.useEffect(() => {
    if (centerOpen && unreadCount > 0) markAllRead();
  }, [centerOpen, unreadCount, markAllRead]);

  const openCenter = React.useCallback(() => setCenterOpen(true), []);

  const refetch = live.refetch;
  const onAdminDone = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  const lookup = React.useMemo(() => (snapshot ? buildLookup(snapshot) : null), [snapshot]);

  // 瀏覽的時段：沒有手動選（或選的時段已不存在）→ 目前時段
  const currentSlotNumber = derived?.current.slotNumber ?? null;
  const viewedSlotNumber =
    viewedSlot !== null && snapshot?.slots.some((s) => s.number === viewedSlot) ? viewedSlot : currentSlotNumber;

  const rows = React.useMemo(() => {
    if (!snapshot || !derived || viewedSlotNumber === null) return [];
    return toRowModels(derived, stationRowsForSlot(snapshot, derived, viewedSlotNumber));
  }, [snapshot, derived, viewedSlotNumber]);

  const anomalyCount = rows.filter((m) => m.row.isAnomaly).length;
  const visibleRows = anomaliesOnly ? rows.filter((m) => m.row.isAnomaly) : rows;

  const gameLinks: GameSwitchLink[] = (["gold", "land"] as const).map((code) => ({
    code,
    label: GAME_NAMES[code],
    href: `/dashboard/${code}`,
    active: code === game,
  }));

  const renderNotificationActions = (n: AppNotification): React.ReactNode => {
    if (!isAdmin || n.kind !== "STATION_SHORTENED" || n.invalidatedAt !== null || !n.assignmentId) return null;
    if (!derived?.assignments.has(n.assignmentId)) return null;
    const id = n.assignmentId;
    return (
      <Button
        size="md"
        variant="primary"
        onClick={() => {
          setCenterOpen(false);
          setExtendAssignmentId(id);
        }}
      >
        延長
      </Button>
    );
  };

  const extendTarget = extendAssignmentId && derived ? derived.assignments.get(extendAssignmentId) : undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <LiveTopBar
        title={snapshot?.game.name ?? GAME_NAMES[game]}
        subtitle={`總 Dashboard・${roleLabel}`}
        gameLinks={gameLinks}
        live={live}
        unreadCount={unreadCount}
        onOpenNotifications={openCenter}
      >
        {/* 只有總召看得到：回到總召管理（跟著目前看的遊戲） */}
        {isAdmin && (
          <div className="mx-auto flex w-full max-w-7xl justify-end px-3 pt-2">
            <Link
              href={`/admin?game=${game}`}
              className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-slate-900 bg-white px-4 text-base font-bold text-slate-900 active:bg-slate-100"
            >
              <ShieldCheck className="size-5" aria-hidden />
              總召管理
            </Link>
          </div>
        )}
      </LiveTopBar>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!snapshot || !derived || !lookup || viewedSlotNumber === null ? (
          <LoadingState error={live.status.error} onRetry={() => void refetch()} />
        ) : (
          <>
            <SlotPanel
              current={derived.current}
              slots={snapshot.slots}
              viewedSlotNumber={viewedSlotNumber}
              onView={(n) => setViewedSlot(n === null || n === derived.current.slotNumber ? null : n)}
            />

            <SummaryBar
              summary={derived.summary}
              currentSlotNumber={derived.current.slotNumber}
              anomaliesOnly={anomaliesOnly}
              onAnomaliesOnlyChange={setAnomaliesOnly}
              anomalyCount={anomalyCount}
            />

            <Tabs<TabValue>
              ariaLabel="Dashboard 檢視"
              size="lg"
              value={tab}
              onValueChange={setTab}
              items={[
                { value: "stations", label: "關卡", count: anomalyCount },
                { value: "teams", label: "小隊視角", count: derived.summary.transitionOverdue },
              ]}
            />

            {tab === "stations" ? (
              visibleRows.length === 0 ? (
                <p className="rounded-2xl border-2 border-slate-300 bg-white py-10 text-center text-xl font-black text-slate-700">
                  {anomaliesOnly ? "目前沒有異常" : "本時段沒有關卡資料"}
                </p>
              ) : game === "gold" ? (
                <GoldStations
                  rows={visibleRows}
                  snapshot={snapshot}
                  derived={derived}
                  lookup={lookup}
                  now={now}
                  isAdmin={isAdmin}
                  onAdminDone={onAdminDone}
                />
              ) : (
                <LandStations
                  rows={visibleRows}
                  snapshot={snapshot}
                  derived={derived}
                  lookup={lookup}
                  now={now}
                  isAdmin={isAdmin}
                  onAdminDone={onAdminDone}
                />
              )
            ) : (
              <TeamView d={derived} lk={lookup} />
            )}
          </>
        )}
      </main>

      <NotificationCenter
        open={centerOpen}
        onClose={() => setCenterOpen(false)}
        notifications={watcher.notifications}
        renderActions={renderNotificationActions}
      />

      {isAdmin && extendTarget && snapshot && (
        <ExtendDialog
          open
          onOpenChange={(open) => {
            if (!open) setExtendAssignmentId(null);
          }}
          assignment={extendTarget}
          snapshot={snapshot}
          now={now}
          onDone={() => {
            setExtendAssignmentId(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function LoadingState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-red-600 bg-red-50 p-6 text-center">
        <p className="text-xl font-black text-red-800">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw className="size-5" aria-hidden />
          重新載入
        </Button>
      </div>
    );
  }
  return (
    <p className="rounded-2xl border-2 border-slate-300 bg-white py-10 text-center text-xl font-bold text-slate-600" role="status">
      載入中…
    </p>
  );
}
