"use client";

import type { ReactNode } from "react";
import type { AssignmentDerived, DerivedGame } from "@/lib/derive/types";
import type { GameSnapshot } from "@/lib/types";
import { SECONDARY_TAG_RING_CLASS, stationStateClasses } from "@/lib/labels";
import { formatSignedDuration } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { TONE_CLASSES } from "@/lib/client/state-colors";
import { AdminActions, FlagChips, RecordTime, SideStatusBadge, StationBadge } from "@/app/dashboard/_components/parts";
import { RowExtras } from "@/app/dashboard/_components/row-extras";
import type { RowModel } from "@/app/dashboard/_components/row-model";
import {
  nextGroupText,
  remainingView,
  sideStatus,
  slotTimes,
  stationTitle,
  tagTexts,
  teamLabel,
  type Lookup,
} from "@/app/dashboard/_components/view-model";

export interface StationListProps {
  rows: RowModel[];
  snapshot: GameSnapshot;
  derived: DerivedGame;
  lookup: Lookup;
  now: number;
  isAdmin: boolean;
  onAdminDone: () => void;
}

/** 分配欄：隊名＋（不是「關卡中」時）小隊狀態 */
function TeamCell({ ad, d, lk, big = false }: { ad: AssignmentDerived; d: DerivedGame; lk: Lookup; big?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {ad.teamIds.map((tid) => {
        const s = sideStatus(d, lk, ad, tid);
        const showBadge = ad.state !== "CANCELLED" && !ad.stationCheckOut && !(s.kind === "team" && s.td.state === "AT_STATION" && !s.label);
        return (
          <div key={tid} className="flex flex-col items-start gap-1">
            <span className={cn("font-black", big ? "text-xl" : "text-lg")}>{teamLabel(lk, tid)}</span>
            {showBadge && <SideStatusBadge status={s} stationState={ad.state} />}
          </div>
        );
      })}
    </div>
  );
}

function ScheduleText({ ad, showingPrevious }: { ad: AssignmentDerived; showingPrevious: boolean }) {
  const t = slotTimes(ad.slot);
  return (
    <div className="flex flex-col">
      <span className="timer-digits whitespace-nowrap font-bold">{t.range}</span>
      {t.original && <span className="whitespace-nowrap text-sm font-bold text-orange-700">{t.original}</span>}
      {showingPrevious && <span className="whitespace-nowrap text-sm font-bold text-slate-600">第{ad.slot.number}時段（延續）</span>}
    </div>
  );
}

function Remaining({ ad, className }: { ad: AssignmentDerived; className?: string }) {
  const r = remainingView(ad);
  return <span className={cn("timer-digits whitespace-nowrap font-black", TONE_CLASSES[r.tone].text, className)}>{r.text}</span>;
}

function Delta({ ad }: { ad: AssignmentDerived }) {
  if (ad.deltaVsScheduledMs === null) return <span className="text-slate-500">--</span>;
  return (
    <span className={cn("timer-digits whitespace-nowrap font-bold", ad.deltaVsScheduledMs > 0 ? "text-red-700" : "text-slate-800")}>
      {formatSignedDuration(ad.deltaVsScheduledMs)}
    </span>
  );
}

/** 第十二節：黃金傳奇 13 關。桌機 table（>= md），手機 compact card。 */
export function GoldStations(props: StationListProps) {
  return (
    <>
      <GoldTable {...props} />
      <GoldCards {...props} />
    </>
  );
}

function GoldTable({ rows, snapshot, derived: d, lookup: lk, now, isAdmin, onAdminDone }: StationListProps) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border-2 border-slate-300 bg-white md:block">
      <table className="w-full border-collapse text-left text-base">
        <thead className="bg-slate-800 text-sm text-white">
          <tr>
            {["關卡", "分配", "預定", "關主進關", "隊輔進關", "關主出關", "隊輔出關", "關卡剩餘", "較預定", "狀態"].map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-2 py-2 font-bold first:pl-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const ad = m.primary;
            const station = m.row.station;
            const cls = ad ? stationStateClasses(ad.state, ad.noShow) : stationStateClasses("REST");
            const flagged = ad ? ad.tags.length > 0 : false;
            return (
              <tr key={station.id} className={cn("border-b-2 border-slate-200 align-top", cls.card)}>
                <th scope="row" className="relative py-2 pl-4 pr-2 text-left">
                  <span className={cn("absolute inset-y-0 left-0 w-2", cls.dot)} aria-hidden />
                  <span className="block text-lg font-black leading-tight">{stationTitle(station)}</span>
                  <span className="text-sm font-bold text-slate-600">{station.code}</span>
                  {flagged && <span className="mt-1 block h-1.5 w-8 rounded bg-orange-500" aria-hidden />}
                </th>
                {ad ? (
                  <>
                    <td className="px-2 py-2">
                      <TeamCell ad={ad} d={d} lk={lk} />
                    </td>
                    <td className="px-2 py-2">
                      <ScheduleText ad={ad} showingPrevious={m.row.showingPrevious} />
                    </td>
                    <td className="px-2 py-2">
                      <RecordTime record={ad.stationCheckIn} />
                    </td>
                    <td className="px-2 py-2">
                      <RecordTime record={ad.sides[0]?.teamCheckIn ?? null} />
                    </td>
                    <td className="px-2 py-2">
                      <RecordTime record={ad.stationCheckOut} />
                    </td>
                    <td className="px-2 py-2">
                      <RecordTime record={ad.sides[0]?.teamCheckOut ?? null} />
                    </td>
                    <td className="px-2 py-2">
                      <Remaining ad={ad} className="text-xl" />
                    </td>
                    <td className="px-2 py-2">
                      <Delta ad={ad} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex min-w-40 flex-col items-start gap-1.5">
                        <StationBadge ad={ad} />
                        <FlagChips tags={tagTexts(lk, ad)} insufficient={ad.insufficientTime} />
                        <RowExtras m={m} d={d} lk={lk} />
                        <AdminActions isAdmin={isAdmin} ad={ad} snapshot={snapshot} now={now} onDone={onAdminDone} />
                      </div>
                    </td>
                  </>
                ) : (
                  <td colSpan={9} className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-lg font-black">本時段休息</span>
                      <span className="text-sm font-bold text-slate-600">{nextGroupText(lk, m.nextRest)}</span>
                      <RowExtras m={m} d={d} lk={lk} />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs font-bold text-slate-600">{label}</span>
      <div className="text-base">{children}</div>
    </div>
  );
}

function GoldCards({ rows, snapshot, derived: d, lookup: lk, now, isAdmin, onAdminDone }: StationListProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:hidden">
      {rows.map((m) => {
        const ad = m.primary;
        const station = m.row.station;
        const cls = ad ? stationStateClasses(ad.state, ad.noShow) : stationStateClasses("REST");
        const flagged = ad ? ad.tags.length > 0 : false;
        return (
          <li
            key={station.id}
            className={cn("relative overflow-hidden rounded-2xl border-2 py-2 pl-4 pr-3", cls.card, flagged && SECONDARY_TAG_RING_CLASS)}
          >
            <span className={cn("absolute inset-y-0 left-0 w-2", cls.dot)} aria-hidden />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xl font-black leading-tight">
                  {stationTitle(station)} <span className="text-sm font-bold text-slate-600">{station.code}</span>
                </p>
              </div>
              {ad ? <StationBadge ad={ad} size="sm" className="shrink-0" /> : <span className="text-base font-bold">本時段休息</span>}
            </div>
            {ad ? (
              <>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <TeamCell ad={ad} d={d} lk={lk} />
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-xs font-bold text-slate-600">關卡剩餘</span>
                    <Remaining ad={ad} className="text-2xl leading-tight" />
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1">
                  <MiniField label="預定">
                    <ScheduleText ad={ad} showingPrevious={m.row.showingPrevious} />
                  </MiniField>
                  <MiniField label="關主進關">
                    <RecordTime record={ad.stationCheckIn} />
                  </MiniField>
                  <MiniField label="隊輔進關">
                    <RecordTime record={ad.sides[0]?.teamCheckIn ?? null} />
                  </MiniField>
                  <MiniField label="較預定">
                    <Delta ad={ad} />
                  </MiniField>
                  <MiniField label="關主出關">
                    <RecordTime record={ad.stationCheckOut} />
                  </MiniField>
                  <MiniField label="隊輔出關">
                    <RecordTime record={ad.sides[0]?.teamCheckOut ?? null} />
                  </MiniField>
                </div>
                <FlagChips className="mt-1.5" tags={tagTexts(lk, ad)} insufficient={ad.insufficientTime} />
                <RowExtras className="mt-1.5" m={m} d={d} lk={lk} />
                <div className="mt-1.5 empty:hidden">
                  <AdminActions isAdmin={isAdmin} ad={ad} snapshot={snapshot} now={now} onDone={onAdminDone} />
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm font-bold text-slate-600">{nextGroupText(lk, m.nextRest)}</p>
                <RowExtras className="mt-1.5" m={m} d={d} lk={lk} />
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
