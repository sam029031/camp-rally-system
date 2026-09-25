"use client";

import { MonitorSmartphone, X } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { useWakeLock } from "@/lib/client/wake-lock";

export interface WakeLockHintProps {
  /**
   * true 時保持亮屏（關卡計時中、跑關中，第十六、十七節）。
   * 這個元件同時負責 request wake lock 與顯示「無法保持亮屏」的一次性提示。
   */
  active: boolean;
  className?: string;
}

/** 保持亮屏 + 失敗時顯示一次提示「此裝置無法保持亮屏，請到設定把自動鎖定改成永不」。 */
export function WakeLockHint({ active, className }: WakeLockHintProps) {
  const { hint, dismissHint } = useWakeLock(active);
  if (!hint) return null;
  return (
    <div role="status" className={cn("flex items-center gap-3 bg-amber-100 px-4 py-2 text-base font-bold text-amber-950", className)}>
      <MonitorSmartphone className="size-6 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{hint}</span>
      <button
        type="button"
        onClick={dismissHint}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-amber-200"
        aria-label="關閉提示"
      >
        <X className="size-6" aria-hidden />
      </button>
    </div>
  );
}
