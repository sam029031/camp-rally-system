"use client";

import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { playSound, unlockSound, useSoundUnlocked } from "@/lib/client/sound";
import { useIsClient } from "@/lib/client/use-is-client";

export interface SoundUnlockButtonProps {
  className?: string;
  /** compact = 頂端列用的小尺寸（仍至少 44px 高） */
  compact?: boolean;
}

/**
 * 「開啟聲音」按鈕（第十五節）：按下時播放無聲音訊解鎖；解鎖後顯示「聲音已開」，再按一下試播提示音。
 */
export function SoundUnlockButton({ className, compact = false }: SoundUnlockButtonProps) {
  const unlocked = useSoundUnlocked();
  const isClient = useIsClient();
  const [failed, setFailed] = React.useState(false);

  const onClick = async () => {
    if (unlocked) {
      playSound("notification");
      return;
    }
    const ok = await unlockSound();
    setFailed(!ok);
    if (ok) playSound("notification");
  };

  if (!isClient) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 font-bold",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
        compact ? "h-11 px-2.5 text-sm" : "h-14 px-4 text-lg",
        unlocked ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-orange-500 bg-orange-100 text-orange-950",
        className,
      )}
      aria-pressed={unlocked}
      title={failed ? "此瀏覽器無法播放聲音" : undefined}
    >
      {unlocked ? <Volume2 className="size-5 shrink-0" aria-hidden /> : <VolumeX className="size-5 shrink-0" aria-hidden />}
      {unlocked ? "聲音已開" : failed ? "無法播放聲音" : "開啟聲音"}
    </button>
  );
}
