"use client";

import * as React from "react";
import { AlertTriangle, BellRing, Info } from "lucide-react";
import { formatHms } from "@/lib/time";
import { A_CLASS_KINDS, type AppNotification } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import {
  browserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "@/lib/client/browser-notification";
import { notificationKindTitle } from "@/lib/client/toast-merge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/** A 類（會跳 Toast）：A_CLASS_KINDS，以及 RECORD_MISMATCH / TEAM_OUT_STATION_NOT_OUT（第十五節） */
export function isAlertClass(n: Pick<AppNotification, "kind" | "subkind">): boolean {
  return A_CLASS_KINDS.includes(n.kind) || (n.kind === "RECORD_MISMATCH" && n.subkind === "TEAM_OUT_STATION_NOT_OUT");
}

export interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  /** 要列出的通知（通常是 useNotificationWatcher().notifications：已過濾本頁相關、新的在前） */
  notifications: ReadonlyArray<AppNotification>;
  /**
   * 每則通知右下角的操作區（render prop）。例如 ADMIN 對 STATION_SHORTENED 顯示「延長」：
   * `renderActions={(n) => isAdmin && n.kind === "STATION_SHORTENED" && !n.invalidatedAt ? <Button …>延長</Button> : null}`
   */
  renderActions?: (n: AppNotification) => React.ReactNode;
  /** 標題（預設「通知中心」） */
  title?: React.ReactNode;
}

function NotificationRow({ n, actions }: { n: AppNotification; actions: React.ReactNode }) {
  const alert = isAlertClass(n);
  const invalidated = n.invalidatedAt !== null;
  const Icon = alert ? (n.kind === "SCHEDULE_ADJUSTED" ? BellRing : AlertTriangle) : Info;
  return (
    <li
      className={cn(
        "rounded-xl border-2 border-l-8 p-3",
        invalidated
          ? "border-slate-300 bg-slate-50 text-slate-500"
          : alert
            ? n.kind === "SCHEDULE_ADJUSTED"
              ? "border-blue-300 border-l-blue-600 bg-blue-50"
              : "border-red-300 border-l-red-600 bg-red-50"
            : "border-slate-300 border-l-slate-500 bg-white",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-6 shrink-0", invalidated ? "text-slate-400" : alert ? "text-red-700" : "text-slate-600")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-lg font-black", invalidated && "line-through")}>{notificationKindTitle(n.kind, n.subkind)}</span>
            <span className="timer-digits text-sm font-bold text-slate-600">{formatHms(n.createdAt)}</span>
            {invalidated && (
              <Badge tone="gray" size="sm">
                已解除
              </Badge>
            )}
          </div>
          <p className={cn("mt-1 text-base font-bold leading-snug", invalidated ? "text-slate-500 line-through" : "text-slate-900")}>
            {n.message}
          </p>
          {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </li>
  );
}

/**
 * 通知中心（抽屜）。新的在前；被撤銷／修正而不再成立的通知顯示「已解除」（不刪除）。
 * A 類（紅／藍框）與 B 類（灰框，只進通知中心）用不同樣式。
 */
export function NotificationCenter({ open, onClose, notifications, renderActions, title = "通知中心" }: NotificationCenterProps) {
  const [permission, setPermission] = React.useState<BrowserNotificationPermission>(() => browserNotificationPermission());

  const askPermission = async () => {
    setPermission(await requestBrowserNotificationPermission());
  };

  const activeCount = notifications.filter((n) => n.invalidatedAt === null).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="right"
      title={title}
      description={notifications.length > 0 ? `共 ${notifications.length} 則（未解除 ${activeCount} 則）` : undefined}
      footer={
        permission === "default" ? (
          <Button variant="secondary" block onClick={askPermission}>
            開啟系統通知
          </Button>
        ) : undefined
      }
    >
      {notifications.length === 0 ? (
        <p className="py-10 text-center text-lg font-bold text-slate-600">目前沒有通知</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notifications.map((n) => (
            <NotificationRow key={n.id} n={n} actions={renderActions?.(n) ?? null} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
