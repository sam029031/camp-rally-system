"use client";

import { ChevronLeft, ChevronRight, Crosshair, Eye } from "lucide-react";
import type { CurrentSlotInfo } from "@/lib/derive/types";
import type { Slot } from "@/lib/types";
import { slotLabel } from "@/lib/labels";
import { formatCountdown, formatHm } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { TONE_CLASSES } from "@/lib/client/state-colors";
import { Button } from "@/components/ui/button";
import { slotTimes } from "@/app/dashboard/_components/view-model";

function OriginalNote({ slot }: { slot: Slot }) {
  const t = slotTimes(slot);
  if (!t.original) return null;
  return <span className="ml-2 text-base font-bold text-orange-700">{t.original}</span>;
}

/** 第十一節「目前時段」文字 */
function CurrentText({ current }: { current: CurrentSlotInfo }) {
  const { phase, slot, slotNumber, remainingMs } = current;
  const times = slotTimes(slot);
  switch (phase) {
    case "BEFORE_START":
      return (
        <p className="text-2xl font-black leading-snug">
          尚未開始，<span className="timer-digits">{formatHm(slot.scheduledStart)}</span> 開始
          <OriginalNote slot={slot} />
          {remainingMs !== null && (
            <span className="ml-2 text-lg font-bold text-slate-600">
              還有 <span className="timer-digits">{formatCountdown(remainingMs)}</span>
            </span>
          )}
        </p>
      );
    case "IN_SLOT":
      return (
        <p className="text-2xl font-black leading-snug">
          {slotLabel(slotNumber)} <span className="timer-digits">{times.range}</span>
          <OriginalNote slot={slot} />
          <span className="ml-3 whitespace-nowrap">
            <span className="text-lg font-bold text-slate-600">時段剩餘</span>{" "}
            <span className="timer-digits">{remainingMs !== null ? formatCountdown(remainingMs) : "--:--"}</span>
          </span>
        </p>
      );
    case "TRANSITION":
      return (
        <p className="text-2xl font-black leading-snug">
          跑關中，{slotLabel(slotNumber)} <span className="timer-digits">{formatHm(slot.scheduledStart)}</span> 開始
          <OriginalNote slot={slot} />
          ，還有 <span className="timer-digits">{remainingMs !== null ? formatCountdown(remainingMs) : "--:--"}</span>
        </p>
      );
    case "ENDED":
      return <p className="text-2xl font-black leading-snug">本遊戲已結束</p>;
  }
}

export interface SlotPanelProps {
  current: CurrentSlotInfo;
  slots: Slot[];
  /** 正在瀏覽的時段編號 */
  viewedSlotNumber: number;
  /** null = 回到目前時段 */
  onView: (slotNumber: number | null) => void;
}

/** 頂端資訊（目前時段）＋ 時段切換（上一時段／目前時段／下一時段）。切換只改變瀏覽的時段。 */
export function SlotPanel({ current, slots, viewedSlotNumber, onView }: SlotPanelProps) {
  const idx = slots.findIndex((s) => s.number === viewedSlotNumber);
  const prev = idx > 0 ? slots[idx - 1] : null;
  const next = idx >= 0 && idx + 1 < slots.length ? slots[idx + 1] : null;
  const viewingCurrent = viewedSlotNumber === current.slotNumber;
  const viewed = idx >= 0 ? slots[idx] : null;
  const viewedTimes = viewed ? slotTimes(viewed) : null;

  return (
    <section aria-label="目前時段" className="flex flex-col gap-2 rounded-2xl border-2 border-slate-300 bg-white p-3">
      <div>
        <p className="text-sm font-bold text-slate-600">目前</p>
        <CurrentText current={current} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          disabled={!prev}
          onClick={() => prev && onView(prev.number)}
          className="px-2"
          aria-label="上一時段"
        >
          <ChevronLeft className="size-6 shrink-0" aria-hidden />
          <span className="truncate">上一時段</span>
        </Button>
        <Button
          variant={viewingCurrent ? "secondary" : "primary"}
          disabled={viewingCurrent}
          onClick={() => onView(null)}
          className="px-2"
        >
          <Crosshair className="size-5 shrink-0" aria-hidden />
          <span className="truncate">目前時段</span>
        </Button>
        <Button
          variant="secondary"
          disabled={!next}
          onClick={() => next && onView(next.number)}
          className="px-2"
          aria-label="下一時段"
        >
          <span className="truncate">下一時段</span>
          <ChevronRight className="size-6 shrink-0" aria-hidden />
        </Button>
      </div>

      {viewed && viewedTimes && (
        <div
          role={viewingCurrent ? undefined : "status"}
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 px-3 py-2",
            viewingCurrent ? "border-slate-300 bg-slate-50" : cn(TONE_CLASSES.yellow.solid, "border-yellow-600"),
          )}
        >
          {viewingCurrent ? (
            <span className="text-lg font-black">顯示：{slotLabel(viewed.number)}（目前）</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xl font-black">
              <Eye className="size-6" aria-hidden />
              檢視中：{slotLabel(viewed.number)}（非目前）
            </span>
          )}
          <span className="timer-digits text-lg font-bold">{viewedTimes.range}</span>
          {viewedTimes.original && <span className="text-base font-bold">{viewedTimes.original}</span>}
        </div>
      )}
    </section>
  );
}
