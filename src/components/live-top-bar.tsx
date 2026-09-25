"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CalendarClock, FlaskConical, LogOut, ShieldAlert } from "lucide-react";
import { formatHms } from "@/lib/time";
import type { GameCode } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import type { LiveGame } from "@/lib/client/use-live-game";
import { logout } from "@/lib/client/use-session";
import { ConnectionBanner, ConnectionIndicator } from "@/components/connection-banner";
import { SoundUnlockButton } from "@/components/sound-unlock-button";

export interface GameSwitchLink {
  code: GameCode;
  /** 「黃金傳奇」「大地遊戲」 */
  label: string;
  href: string;
  active: boolean;
}

export interface LiveTopBarProps {
  /** 大標題：遊戲名稱或頁面名稱（例如「黃金傳奇」） */
  title: React.ReactNode;
  /** 副標題：關卡／隊伍／身分（例如「A 九九乘法」「第2小隊」） */
  subtitle?: React.ReactNode;
  /** 遊戲切換連結（Dashboard、隊輔頁）；不給就不顯示 */
  gameLinks?: ReadonlyArray<GameSwitchLink>;
  /** useLiveGame() 的結果（用到 now、status、snapshot、derived、refetch） */
  live: Pick<LiveGame, "now" | "status" | "snapshot" | "derived"> & { refetch?: () => Promise<void> };
  /** 通知中心未讀數（useNotificationWatcher().unreadCount） */
  unreadCount?: number;
  /** 按鈴鐺：打開通知中心；不給就不顯示鈴鐺 */
  onOpenNotifications?: () => void;
  /** ADMIN 在關主頁／隊輔頁操作時顯示「以總召身分操作」（第二十節） */
  actingAsAdmin?: boolean;
  /** 顯示登出按鈕（預設 true）；onLogout 不給就用預設的 logout() */
  showLogout?: boolean;
  onLogout?: () => void;
  /** 頂端列下方的額外橫幅（例如「你登入的是 A 關，前往我的關卡」、WakeLockHint） */
  children?: React.ReactNode;
  className?: string;
}

function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : speed.toFixed(1);
}

/**
 * 每個即時頁面的頂端列（Dashboard、關主頁、隊輔頁、admin）。
 * 內容：遊戲名稱＋切換、目前 app 時間 HH:mm:ss、連線狀態、「資料可能過期」、
 * DEMO 橫幅「DEMO 模式 ×10」（第三十一節）、整場延後標籤（第二十四節）、開啟聲音、通知中心、以總召身分操作、登出。
 */
export function LiveTopBar({
  title,
  subtitle,
  gameLinks,
  live,
  unreadCount = 0,
  onOpenNotifications,
  actingAsAdmin = false,
  showLogout = true,
  onLogout,
  children,
  className,
}: LiveTopBarProps) {
  const [loggingOut, setLoggingOut] = React.useState(false);
  const clock = live.snapshot?.event.clock;
  const demo = clock?.simEnabled ? `DEMO 模式 ×${formatSpeed(clock.simSpeed)}` : null;
  const adjustment = live.derived?.activeAdjustmentLabel ?? null;

  const handleLogout = async () => {
    if (onLogout) return onLogout();
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className={cn("sticky top-0 z-40 border-b-2 border-slate-300 bg-white/95 backdrop-blur", className)}>
      {demo && (
        <div className="flex items-center justify-center gap-2 bg-fuchsia-700 px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-lg font-black tracking-wide text-white">
          <FlaskConical className="size-5" aria-hidden />
          {demo}
          <span className="text-sm font-bold opacity-90">（非正式活動時間）</span>
        </div>
      )}

      <div className={cn("mx-auto flex max-w-6xl flex-col gap-2 px-3 py-2", !demo && "pt-[max(0.5rem,env(safe-area-inset-top))]")}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black leading-tight text-slate-950">{title}</h1>
            {subtitle && <p className="truncate text-base font-bold text-slate-700">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="timer-digits text-2xl font-black leading-none text-slate-950" aria-label="目前時間">
              {live.now > 0 ? formatHms(live.now) : "--:--:--"}
            </span>
            <ConnectionIndicator status={live.status} className="mt-1" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {gameLinks && gameLinks.length > 0 && (
            <nav aria-label="切換遊戲" className="flex rounded-xl border-2 border-slate-300 bg-slate-100 p-0.5">
              {gameLinks.map((g) => (
                <Link
                  key={g.code}
                  href={g.href}
                  aria-current={g.active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center rounded-lg px-3 text-base font-bold",
                    g.active ? "bg-white text-slate-950 shadow ring-2 ring-slate-900" : "text-slate-700",
                  )}
                >
                  {g.label}
                </Link>
              ))}
            </nav>
          )}
          {actingAsAdmin && (
            <span className="inline-flex h-10 items-center gap-1 rounded-lg border-2 border-red-600 bg-red-50 px-2.5 text-base font-black text-red-800">
              <ShieldAlert className="size-5" aria-hidden />
              以總召身分操作
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <SoundUnlockButton compact />
            {onOpenNotifications && (
              <button
                type="button"
                onClick={onOpenNotifications}
                className="relative inline-flex size-11 items-center justify-center rounded-xl border-2 border-slate-400 bg-white text-slate-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
                aria-label={unreadCount > 0 ? `通知中心（${unreadCount} 則未讀）` : "通知中心"}
              >
                <Bell className="size-6" aria-hidden />
                {unreadCount > 0 && (
                  <span className="absolute -right-2 -top-2 inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-sm font-black text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            )}
            {showLogout && (
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="inline-flex size-11 items-center justify-center rounded-xl border-2 border-slate-400 bg-white text-slate-900 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
                aria-label="登出"
                title="登出"
              >
                <LogOut className="size-6" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>

      {adjustment && (
        <div className="flex items-center gap-2 bg-orange-500 px-4 py-1.5 text-lg font-black text-white">
          <CalendarClock className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0">{adjustment}</span>
        </div>
      )}
      <ConnectionBanner status={live.status} onRetry={live.refetch} />
      {children}
    </header>
  );
}
