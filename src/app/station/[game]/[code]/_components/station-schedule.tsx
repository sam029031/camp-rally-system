"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { AssignmentDerived } from "@/lib/derive/types";
import type { GameSnapshot } from "@/lib/types";
import { CANCELLED_CLASS, STATION_STATE_LABEL, slotLabel } from "@/lib/labels";
import { formatHmRange, formatHms } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { StationStateBadge } from "@/components/state-badges";
import { teamsTitle } from "./station-view";

export interface StationScheduleProps {
  snapshot: GameSnapshot;
  /** 本關所有 assignment（依時段，含取消的） */
  assignments: ReadonlyArray<AssignmentDerived>;
  /** 目前主卡片的 assignment（標示「目前」） */
  focusId: string | null;
}

function Row({ snapshot, ad, isFocus }: { snapshot: GameSnapshot; ad: AssignmentDerived; isFocus: boolean }) {
  const pk = ad.teamIds.length > 1;
  const cancelled = ad.state === "CANCELLED";
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-xl border-2 px-3 py-2",
        isFocus ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-bold text-slate-700">
          {slotLabel(ad.slot.number)} <span className="timer-digits">{formatHmRange(ad.slot.scheduledStart, ad.slot.scheduledEnd)}</span>
        </span>
        {isFocus && <span className="rounded-md bg-blue-700 px-2 py-0.5 text-sm font-black text-white">目前</span>}
        <span className="ml-auto">
          {cancelled ? (
            <span className={cn("inline-flex rounded-lg px-2 py-1 text-sm font-bold", CANCELLED_CLASS)}>
              {STATION_STATE_LABEL.CANCELLED}（{ad.cancellation?.reason ?? ""}）
            </span>
          ) : (
            <StationStateBadge
              state={ad.state}
              noShow={ad.noShow}
              label={ad.noShow && pk ? "本場未進行" : undefined}
              size="sm"
            />
          )}
        </span>
      </div>
      <p className={cn("text-lg font-black", cancelled ? "text-slate-500 line-through" : "text-slate-950")}>
        {teamsTitle(snapshot, ad, " vs ")}
      </p>
      {(ad.stationCheckIn || ad.stationCheckOut) && (
        <p className="timer-digits text-base font-bold text-slate-700">
          {ad.stationCheckIn && <>進關 {formatHms(ad.stationCheckIn.recordedAt)}</>}
          {ad.stationCheckIn && ad.stationCheckOut && "　"}
          {ad.stationCheckOut && (
            <>
              {ad.noShow ? (pk ? "本場未進行" : "本隊未到") : "出關"} {formatHms(ad.stationCheckOut.recordedAt)}
            </>
          )}
        </p>
      )}
    </li>
  );
}

/** 本關全部時段（含休息與已取消），預設收合 */
export function StationSchedule({ snapshot, assignments, focusId }: StationScheduleProps) {
  const bySlot = new Map(assignments.map((ad) => [ad.slot.id, ad] as const));
  return (
    <details className="group rounded-2xl border-2 border-slate-300 bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 text-lg font-bold text-slate-900 [&::-webkit-details-marker]:hidden">
        本關全部時段
        <ChevronDown className="size-6 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ol className="flex flex-col gap-2 px-3 pb-3">
        {snapshot.slots.map((slot) => {
          const ad = bySlot.get(slot.id);
          if (!ad) {
            return (
              <li key={slot.id} className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-base font-bold text-slate-600">
                  {slotLabel(slot.number)} <span className="timer-digits">{formatHmRange(slot.scheduledStart, slot.scheduledEnd)}</span>
                </span>
                <span className="ml-auto text-base font-bold text-slate-600">{STATION_STATE_LABEL.REST}</span>
              </li>
            );
          }
          return <Row key={slot.id} snapshot={snapshot} ad={ad} isFocus={ad.assignment.id === focusId} />;
        })}
      </ol>
    </details>
  );
}
