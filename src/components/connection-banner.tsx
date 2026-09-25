"use client";

import * as React from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { formatHms } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { CONNECTION_LEVEL_LABEL, connectionLevel, type ConnectionLevel, type LiveStatus } from "@/lib/client/live-status";

export interface ConnectionBannerProps {
  status: LiveStatus;
  /** 「重新整理」按鈕（通常傳 useLiveGame().refetch） */
  onRetry?: () => void | Promise<void>;
  className?: string;
}

/**
 * 離線／資料可能過期的橫幅（第二十八節）。正常連線時不渲染。
 * - 離線：紅色「離線中」。
 * - 超過 60 秒沒有成功抓取：黃色「資料可能過期」＋最後更新時間。
 */
export function ConnectionBanner({ status, onRetry, className }: ConnectionBannerProps) {
  const [retrying, setRetrying] = React.useState(false);
  const level = connectionLevel(status);
  if (level !== "offline" && level !== "stale") return null;

  const last = status.lastFetchOkAt !== null ? `最後更新 ${formatHms(status.lastFetchOkAt)}` : "尚未成功載入";
  const offline = level === "offline";

  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 px-4 py-2 text-base font-bold",
        offline ? "bg-red-600 text-white" : "bg-yellow-300 text-black",
        className,
      )}
    >
      {offline ? <WifiOff className="size-6 shrink-0" aria-hidden /> : <RefreshCw className="size-6 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1">
        {offline ? "離線中，恢復網路後會自動更新" : CONNECTION_LEVEL_LABEL.stale}
        <span className="ml-2 font-normal">（{last}）</span>
      </span>
      {onRetry && !offline && (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="h-11 shrink-0 rounded-lg border-2 border-black/70 bg-white/80 px-3 text-base font-bold disabled:opacity-50"
        >
          {retrying ? "更新中…" : "重新整理"}
        </button>
      )}
    </div>
  );
}

const DOT: Record<ConnectionLevel, string> = {
  live: "bg-emerald-500",
  polling: "bg-yellow-400",
  connecting: "bg-slate-400 animate-pulse",
  stale: "bg-yellow-500",
  offline: "bg-red-600",
};

const SHORT: Record<ConnectionLevel, string> = {
  live: "即時",
  polling: "定時更新",
  connecting: "連線中",
  stale: "可能過期",
  offline: "離線",
};

/** 頂端列的小型連線指示（點 + 短文字） */
export function ConnectionIndicator({ status, className }: { status: LiveStatus; className?: string }) {
  const level = connectionLevel(status);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-bold text-slate-700", className)}
      title={CONNECTION_LEVEL_LABEL[level]}
    >
      <span className={cn("inline-block size-3 rounded-full", DOT[level])} aria-hidden />
      {SHORT[level]}
    </span>
  );
}
