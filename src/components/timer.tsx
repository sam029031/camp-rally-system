"use client";

import * as React from "react";
import { ENDING_SOON_MS, TRANSITION_WARNING_MS } from "@/lib/constants";
import { formatCountdown, formatHm } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { playSound } from "@/lib/client/sound";
import { TONE_CLASSES, type Tone } from "@/lib/client/state-colors";
import { createCrossingDetector } from "@/lib/client/threshold";
import { vibrate } from "@/lib/client/vibrate";

export interface TimerProps {
  /**
   * 倒數種類（第八節「兩種倒數不可混用」）：
   * - `station`：關卡剩餘 = official_end − now。綠 → 剩 2:00 黃 → 0 以下紅「超時 +MM:SS」。
   * - `transition`：跑關剩餘 = deadline − now。藍 → 剩 2:00 黃 → 0 以下紅「逾期 +MM:SS」。
   */
  variant?: "station" | "transition";
  /** 剩餘毫秒（app 時間）；負數 = 超時／逾期；null = 目前沒有在倒數 */
  remainingMs: number | null;
  /**
   * 開始前模式（第八、十七節：「已進關 09:30:12，09:32 開始計時」並倒數到開始）：
   * remainingMs 為 null 且 untilStartMs > 0 時，顯示紫色倒數與「HH:mm 開始計時」。
   */
  untilStartMs?: number | null;
  /** 開始計時的時刻（app ms），用來顯示「09:32 開始計時」 */
  startAt?: number | null;
  /**
   * 倒數對象（例如 assignment id）。換對象時重設門檻偵測，不會誤觸發提醒。
   */
  trackKey?: string | null;
  /**
   * 本機「親眼看到」剩餘時間由上往下跨過 2:00 時呼叫（上一個 tick > 2:00、這一個 tick <= 2:00）。
   * 載入或 refresh 時已經過了的門檻不會補觸發（第十七節）。
   */
  onCrossWarning?: () => void;
  /** 同上，跨過 0:00 時呼叫 */
  onCrossZero?: () => void;
  /**
   * 跨過門檻時自動提醒：Android 震動 + 聲音已解鎖時播放短音（iPhone 只有畫面與聲音）。
   * 預設 station = true、transition = false（跑關黃色只改顏色，不提醒）。
   */
  alert?: boolean;
  /** xl = 關主頁超大 Timer；lg = 隊輔頁；md = 卡片內 */
  size?: "xl" | "lg" | "md";
  /** 數字下方的小字，例如「至 14:46 結束（本場縮短 03:08）」 */
  caption?: React.ReactNode;
  className?: string;
}

const DIGITS: Record<NonNullable<TimerProps["size"]>, string> = {
  xl: "text-[clamp(4.5rem,26vw,10rem)]",
  lg: "text-[clamp(3.5rem,18vw,6.5rem)]",
  md: "text-5xl",
};

const LABEL: Record<NonNullable<TimerProps["size"]>, string> = {
  xl: "text-2xl",
  lg: "text-xl",
  md: "text-lg",
};

interface TimerView {
  tone: Tone;
  label: string;
  digits: string;
}

function viewFor(variant: "station" | "transition", remainingMs: number): TimerView {
  const warnAt = variant === "station" ? ENDING_SOON_MS : TRANSITION_WARNING_MS;
  if (remainingMs <= 0) {
    return { tone: "red", label: variant === "station" ? "超時" : "逾期", digits: `+${formatCountdown(remainingMs)}` };
  }
  if (remainingMs <= warnAt) {
    return {
      tone: "yellow",
      label: variant === "station" ? "即將結束" : "跑關剩餘",
      digits: formatCountdown(remainingMs),
    };
  }
  return {
    tone: variant === "station" ? "green" : "blue",
    label: variant === "station" ? "關卡剩餘" : "跑關剩餘",
    digits: formatCountdown(remainingMs),
  };
}

/**
 * 超大倒數（第八、九、十七節）。所有時間由 server 紀錄推導，只負責顯示與「跨越門檻」提醒。
 * 顏色一定搭配文字（「超時」「逾期」），不只靠顏色判讀。
 */
export function Timer({
  variant = "station",
  remainingMs,
  untilStartMs = null,
  startAt = null,
  trackKey = null,
  onCrossWarning,
  onCrossZero,
  alert,
  size = "xl",
  caption,
  className,
}: TimerProps) {
  const alertOn = alert ?? variant === "station";
  const warnAt = variant === "station" ? ENDING_SOON_MS : TRANSITION_WARNING_MS;
  const [detector] = React.useState(() => createCrossingDetector([warnAt, 0]));

  const handlers = React.useRef({ onCrossWarning, onCrossZero, alertOn });
  React.useEffect(() => {
    handlers.current = { onCrossWarning, onCrossZero, alertOn };
  });

  React.useEffect(() => {
    const crossed = detector.observe(remainingMs, trackKey);
    if (crossed.length === 0) return;
    const h = handlers.current;
    const hitZero = crossed.includes(0);
    const hitWarn = crossed.includes(warnAt);
    // 一次跨過兩個門檻（例如頁面卡頓）時只提醒較嚴重的那一個
    if (h.alertOn) {
      if (hitZero) {
        vibrate("overtime");
        playSound("overtime");
      } else if (hitWarn) {
        vibrate("warning");
        playSound("warning");
      }
    }
    if (hitWarn) h.onCrossWarning?.();
    if (hitZero) h.onCrossZero?.();
  }, [remainingMs, trackKey, detector, warnAt]);

  const preStart = remainingMs === null && untilStartMs !== null && untilStartMs > 0;
  if (remainingMs === null && !preStart) return null;

  const view: TimerView = preStart
    ? { tone: "purple", label: startAt !== null ? `${formatHm(startAt)} 開始計時` : "等待開始", digits: formatCountdown(untilStartMs ?? 0) }
    : viewFor(variant, remainingMs ?? 0);

  return (
    <div
      role="timer"
      aria-label={`${view.label} ${view.digits}`}
      className={cn(
        "flex flex-col items-center justify-center rounded-3xl px-4 py-3 text-center shadow-sm",
        TONE_CLASSES[view.tone].solid,
        view.tone === "red" && "ring-4 ring-red-800/40",
        className,
      )}
    >
      <div className={cn("font-bold leading-tight", LABEL[size])}>{view.label}</div>
      <div className={cn("timer-digits font-black leading-none tracking-tight", DIGITS[size])}>{view.digits}</div>
      {caption && <div className={cn("mt-2 font-bold leading-snug", size === "md" ? "text-base" : "text-lg")}>{caption}</div>}
    </div>
  );
}
