"use client";

import { AlertTriangle, BellRing, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/client/cn";
import type { ToastTone } from "@/lib/client/toast-merge";
import { dismissToast, useToasts, type ToastItem } from "@/lib/client/toast-store";

const TONE: Record<ToastTone, string> = {
  danger: "bg-red-600 text-white border-red-800",
  warning: "bg-yellow-300 text-black border-yellow-600",
  info: "bg-blue-700 text-white border-blue-900",
  success: "bg-emerald-600 text-white border-emerald-800",
};

const ICON: Record<ToastTone, typeof Info> = {
  danger: AlertTriangle,
  warning: BellRing,
  info: Info,
  success: CheckCircle2,
};

function Toast({ item }: { item: ToastItem }) {
  const Icon = ICON[item.tone];
  return (
    <div
      role={item.tone === "danger" ? "alert" : "status"}
      className={cn("pointer-events-auto flex w-full gap-3 rounded-2xl border-2 p-3 shadow-xl", TONE[item.tone])}
    >
      <Icon className="mt-0.5 size-7 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xl font-black leading-snug">{item.title}</p>
        {item.body && <p className="mt-1 text-lg font-bold leading-snug">{item.body}</p>}
        {item.lines && item.lines.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-base font-bold leading-snug">
            {item.lines.map((line, i) => (
              <li key={i}>・{line}</li>
            ))}
          </ul>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismissToast(item.id);
            }}
            className="mt-2 h-11 rounded-lg border-2 border-current bg-white/15 px-4 text-base font-bold"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        className="-m-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/10"
        aria-label="關閉通知"
      >
        <X className="size-6" aria-hidden />
      </button>
    </div>
  );
}

/**
 * 畫面頂端的 Toast（第十五節）。放在 layout 的 Providers 裡，整個 app 只有一個。
 * 多筆 A 類通知已由 use-notification-watcher 合併成一則，這裡最多同時顯示 3 則。
 */
export function ToastStack() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-0 z-[110] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="flex w-full max-w-xl flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} />
        ))}
      </div>
    </div>
  );
}
