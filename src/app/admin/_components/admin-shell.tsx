"use client";
/**
 * /admin 的 client 外框（第二十五節）：頂端列、遊戲切換（驅動唯一的 useLiveGame）、分頁、通知中心。
 * 遊戲與分頁放在網址（?game=gold&tab=schedule），重新整理後維持在同一個分頁。
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutDashboard, Loader, TriangleAlert } from "lucide-react";
import { GAME_NAMES } from "@/lib/constants";
import type { GameCode, SessionInfo } from "@/lib/types";
import { useLiveGame } from "@/lib/client/use-live-game";
import { useNotificationWatcher } from "@/lib/client/use-notification-watcher";
import { AdminAssignmentActions, ExtendDialog } from "@/components/admin-actions";
import { LiveTopBar, type GameSwitchLink } from "@/components/live-top-bar";
import { NotificationCenter } from "@/components/notification-center";
import { Button } from "@/components/ui/button";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { AnomaliesTab, countLiveAnomalies, LIVE_ANOMALY_BADGE_HINT } from "@/app/admin/_components/anomalies-tab";
import { buildSnapIndex } from "@/app/admin/_components/b-helpers";
import { AuditTab } from "@/app/admin/_components/audit-tab";
import { CancelExtendTab } from "@/app/admin/_components/cancel-extend-tab";
import { DemoResetTab } from "@/app/admin/_components/demo-reset-tab";
import { ExportTab } from "@/app/admin/_components/export-tab";
import { OverviewTab } from "@/app/admin/_components/overview-tab";
import { PinsTab } from "@/app/admin/_components/pins-tab";
import { RecordsTab } from "@/app/admin/_components/records-tab";
import { ScheduleTab } from "@/app/admin/_components/schedule-tab";
import type { AdminTabProps } from "@/app/admin/_components/types";

export type AdminTabKey = "overview" | "schedule" | "cancel" | "records" | "anomalies" | "pins" | "audit" | "export" | "demo";

const TAB_LABELS: ReadonlyArray<{ value: AdminTabKey; label: string }> = [
  { value: "overview", label: "總覽設定" },
  { value: "schedule", label: "排程調整" },
  { value: "cancel", label: "取消與延長" },
  { value: "records", label: "打卡紀錄" },
  { value: "anomalies", label: "異常" },
  { value: "pins", label: "PIN 總表" },
  { value: "audit", label: "Audit log" },
  { value: "export", label: "匯出" },
  { value: "demo", label: "Demo 與 Reset" },
];

function parseTab(v: string | null): AdminTabKey | null {
  return TAB_LABELS.some((t) => t.value === v) ? (v as AdminTabKey) : null;
}

function parseGame(v: string | null): GameCode | null {
  return v === "gold" || v === "land" ? v : null;
}

export interface AdminShellProps {
  session: SessionInfo;
  /** 網址沒有 ?game= 時使用（server 依 app 時間判斷） */
  initialGame: GameCode;
  /** APP_ENV 是否允許 Demo／Reset（server 仍會再檢查） */
  demoAllowed: boolean;
  appEnv: string;
}

export function AdminShell({ session, initialGame, demoAllowed, appEnv }: AdminShellProps) {
  const searchParams = useSearchParams();
  const game = parseGame(searchParams.get("game")) ?? initialGame;
  const tab = parseTab(searchParams.get("tab")) ?? "overview";

  const live = useLiveGame(game);
  const { snapshot, derived, refetch } = live;

  const [centerOpen, setCenterOpen] = React.useState(false);
  const [extendTargetId, setExtendTargetId] = React.useState<string | null>(null);

  const openCenter = React.useCallback(() => setCenterOpen(true), []);
  const watcher = useNotificationWatcher({
    snapshot,
    derived,
    context: { page: "admin" },
    realNow: live.realNow,
    online: live.status.online,
    refetch,
    onOpenCenter: openCenter,
  });

  // 通知中心開著時，新進來的通知也算已讀
  const { unreadCount, markAllRead } = watcher;
  React.useEffect(() => {
    if (centerOpen && unreadCount > 0) markAllRead();
  }, [centerOpen, unreadCount, markAllRead]);

  const snapIndex = React.useMemo(() => (snapshot ? buildSnapIndex(snapshot) : null), [snapshot]);
  const liveAnomalies = React.useMemo(
    () => (snapshot && derived && snapIndex ? countLiveAnomalies(snapshot, derived, snapIndex) : undefined),
    [snapshot, derived, snapIndex],
  );

  const setTab = (next: AdminTabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    if (!params.get("game")) params.set("game", game);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  const gameLinks: GameSwitchLink[] = (["gold", "land"] as const).map((code) => ({
    code,
    label: GAME_NAMES[code],
    href: `/admin?game=${code}&tab=${tab}`,
    active: code === game,
  }));

  // 「異常」徽章 = 異常分頁實際列出的即時項目數（不是 Dashboard 的異常列數；第二十五節）
  const tabItems: TabItem<AdminTabKey>[] = TAB_LABELS.map((t) =>
    t.value === "anomalies"
      ? {
          value: t.value,
          label: (
            <span title={LIVE_ANOMALY_BADGE_HINT}>
              {t.label}
              {liveAnomalies ? <span className="sr-only">（{LIVE_ANOMALY_BADGE_HINT}）</span> : null}
            </span>
          ),
          count: liveAnomalies,
        }
      : { value: t.value, label: t.label },
  );

  const onDone = () => void refetch();
  const extendTarget = extendTargetId && derived ? (derived.assignments.get(extendTargetId) ?? null) : null;

  const tabProps: AdminTabProps = { gameCode: game, live, session };
  const ready = snapshot && derived ? { ...tabProps, snapshot, derived } : null;

  let content: React.ReactNode;
  switch (tab) {
    case "records":
      content = <RecordsTab {...tabProps} />;
      break;
    case "anomalies":
      content = <AnomaliesTab {...tabProps} />;
      break;
    case "pins":
      content = <PinsTab {...tabProps} />;
      break;
    case "audit":
      content = <AuditTab {...tabProps} />;
      break;
    case "export":
      content = <ExportTab {...tabProps} />;
      break;
    default:
      if (!ready) {
        content = <LoadingPanel error={live.status.error} onRetry={onDone} />;
      } else if (tab === "overview") {
        content = <OverviewTab key={game} {...ready} />;
      } else if (tab === "schedule") {
        content = <ScheduleTab key={game} {...ready} />;
      } else if (tab === "cancel") {
        content = <CancelExtendTab key={game} {...ready} />;
      } else {
        content = <DemoResetTab key={game} {...ready} demoAllowed={demoAllowed} appEnv={appEnv} />;
      }
  }

  return (
    <div className="min-h-dvh bg-slate-100">
      <LiveTopBar
        title="總召管理"
        subtitle={`${snapshot?.game.name ?? GAME_NAMES[game]}・${session.label}`}
        gameLinks={gameLinks}
        live={live}
        unreadCount={unreadCount}
        onOpenNotifications={() => {
          markAllRead();
          setCenterOpen(true);
        }}
      >
        {/* 總召在管理頁與全場 Dashboard 之間切換（跟著目前選的遊戲） */}
        <div className="mx-auto flex w-full max-w-6xl justify-end px-3 pt-2">
          <Link
            href={`/dashboard/${game}`}
            className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-slate-900 bg-white px-4 text-base font-bold text-slate-900 active:bg-slate-100"
          >
            <LayoutDashboard className="size-5" aria-hidden />
            全場 Dashboard（{GAME_NAMES[game]}）
          </Link>
        </div>
      </LiveTopBar>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <nav aria-label="管理分頁">
          <Tabs items={tabItems} value={tab} onValueChange={setTab} ariaLabel="管理分頁" stretch={false} size="lg" className="bg-white" />
        </nav>
        {content}
      </main>

      <NotificationCenter
        open={centerOpen}
        onClose={() => setCenterOpen(false)}
        notifications={watcher.notifications}
        renderActions={(n) => {
          if (!snapshot || !derived || n.invalidatedAt !== null || !n.assignmentId) return null;
          const ad = derived.assignments.get(n.assignmentId);
          if (!ad) return null;
          if (n.kind === "STATION_SHORTENED") {
            return (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setCenterOpen(false);
                  setExtendTargetId(ad.assignment.id);
                }}
              >
                延長
              </Button>
            );
          }
          if (n.kind === "STATION_OVERTIME" || n.kind === "STATION_NOT_STARTED") {
            return <AdminAssignmentActions key={ad.assignment.id} compact assignment={ad} snapshot={snapshot} now={live.now} onDone={onDone} className="h-11" />;
          }
          return null;
        }}
      />

      {extendTarget && snapshot && (
        <ExtendDialog
          key={extendTarget.assignment.id}
          open
          onOpenChange={(o) => {
            if (!o) setExtendTargetId(null);
          }}
          assignment={extendTarget}
          snapshot={snapshot}
          now={live.now}
          onDone={onDone}
        />
      )}
    </div>
  );
}

function LoadingPanel({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-slate-300 bg-white p-8 text-center">
      {error ? (
        <>
          <TriangleAlert className="size-10 text-red-600" aria-hidden />
          <p className="text-lg font-bold text-red-700">{error}</p>
          <Button variant="secondary" onClick={onRetry}>
            重新讀取
          </Button>
        </>
      ) : (
        <>
          <Loader className="size-10 animate-spin text-slate-500" aria-hidden />
          <p className="text-lg font-bold text-slate-700">讀取資料中…</p>
        </>
      )}
    </div>
  );
}
