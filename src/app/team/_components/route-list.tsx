"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { getIndex, sideOf, teamAssignments } from "@/lib/derive";
import type { AssignmentDerived, DerivedGame, TeamDerived } from "@/lib/derive/types";
import { CANCELLED_CLASS, NO_SHOW_CLASS, slotLabel, teamName } from "@/lib/labels";
import { formatHm, formatHmRange, formatHms } from "@/lib/time";
import type { GameSnapshot } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { StationStateBadge } from "@/components/state-badges";
import { opponentOf } from "./helpers";

export interface RouteListProps {
  snapshot: GameSnapshot;
  derived: DerivedGame;
  teamId: string;
  td: TeamDerived;
}

type RowKind = "cancelled" | "current" | "done" | "noshow" | "upcoming";

function rowKind(ad: AssignmentDerived, td: TeamDerived): RowKind {
  if (ad.state === "CANCELLED") return "cancelled";
  if (ad.stationCheckOut) return ad.noShow ? "noshow" : "done";
  if (ad.assignment.id === td.currentAssignmentId && td.state !== "COMPLETED") return "current";
  return "upcoming";
}

function currentMark(td: TeamDerived): string {
  switch (td.state) {
    case "WAITING":
      return "第一關";
    case "TRANSITIONING":
    case "TRANSITION_OVERDUE":
      return "下一關";
    default:
      return "目前";
  }
}

function RouteRow({ ad, snapshot, teamId, td }: { ad: AssignmentDerived; snapshot: GameSnapshot; teamId: string; td: TeamDerived }) {
  const kind = rowKind(ad, td);
  const side = sideOf(ad, teamId);
  const oppId = opponentOf(ad, teamId);
  const opp = oppId ? getIndex(snapshot).teamById.get(oppId) : undefined;
  const shifted = ad.slot.totalOffsetMs !== 0;

  return (
    <li
      className={cn(
        "flex gap-3 rounded-xl border-2 p-3",
        kind === "current" && "border-blue-600 bg-blue-50 ring-2 ring-blue-600",
        kind === "done" && "border-slate-300 bg-slate-50",
        kind === "noshow" && NO_SHOW_CLASS.card,
        kind === "cancelled" && CANCELLED_CLASS,
        kind === "upcoming" && "border-slate-300 bg-white",
      )}
      aria-current={kind === "current" ? "step" : undefined}
    >
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-white/70 py-1 text-center">
        <span className="text-sm font-bold text-slate-600">{slotLabel(ad.slot.number)}</span>
        <span className="timer-digits text-lg font-black leading-tight text-slate-950">{formatHm(ad.slot.scheduledStart)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-xl font-black leading-snug text-slate-950", kind === "cancelled" && "text-slate-500 line-through")}>
            {ad.station.name}
          </span>
          {kind === "current" && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-2 py-1 text-sm font-black text-white">
              <MapPin className="size-4" aria-hidden />
              {currentMark(td)}
            </span>
          )}
          {kind === "done" && <StationStateBadge state="CHECKED_OUT" size="sm" label="已完成" />}
          {kind === "noshow" && <StationStateBadge state="CHECKED_OUT" noShow size="sm" />}
          {kind === "cancelled" && <StationStateBadge state="CANCELLED" size="sm" />}
        </div>
        <p className="timer-digits text-base font-bold text-slate-700">
          {formatHmRange(ad.slot.scheduledStart, ad.slot.scheduledEnd)}
          {shifted && <span className="ml-2 text-sm text-slate-500">原定 {formatHm(ad.slot.originalStart)}</span>}
          {opp && <span className="ml-2 text-slate-800">vs {teamName(opp)}</span>}
        </p>
        {kind === "cancelled" && ad.cancellation && (
          <p className="text-base font-bold text-slate-600">已取消（{ad.cancellation.reason}）</p>
        )}
        {(kind === "done" || kind === "current") && (ad.stationCheckIn || side?.teamCheckIn || ad.stationCheckOut || side?.teamCheckOut) && (
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm font-bold text-slate-700">
            <div>
              <dt className="inline">關主進關 </dt>
              <dd className="timer-digits inline">{ad.stationCheckIn ? formatHms(ad.stationCheckIn.recordedAt) : "--"}</dd>
            </div>
            <div>
              <dt className="inline">隊輔進關 </dt>
              <dd className="timer-digits inline">{side?.teamCheckIn ? formatHms(side.teamCheckIn.recordedAt) : "--"}</dd>
            </div>
            <div>
              <dt className="inline">關主出關 </dt>
              <dd className="timer-digits inline">{ad.stationCheckOut ? formatHms(ad.stationCheckOut.recordedAt) : "--"}</dd>
            </div>
            <div>
              <dt className="inline">隊輔出關 </dt>
              <dd className="timer-digits inline">{side?.teamCheckOut ? formatHms(side.teamCheckOut.recordedAt) : "--"}</dd>
            </div>
          </dl>
        )}
      </div>
    </li>
  );
}

/** 本隊在本遊戲的完整路線（8 個時段；已完成／目前／已取消標示），可收合。 */
export function RouteList({ snapshot, derived, teamId, td }: RouteListProps) {
  const [open, setOpen] = React.useState(false);
  const list = teamAssignments(snapshot, derived, teamId);
  const doneCount = list.filter((ad) => ad.state !== "CANCELLED" && ad.stationCheckOut).length;
  const activeCount = list.filter((ad) => ad.state !== "CANCELLED").length;
  const panelId = React.useId();

  if (list.length === 0) return null;

  return (
    <section className="rounded-2xl border-2 border-slate-300 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-16 w-full items-center gap-3 rounded-2xl px-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-black text-slate-950">完整路線</span>
          <span className="block text-base font-bold text-slate-600">
            已完成 {doneCount} / {activeCount} 關{list.length !== activeCount ? `（${list.length - activeCount} 關已取消）` : ""}
          </span>
        </span>
        {open ? <ChevronUp className="size-7 shrink-0" aria-hidden /> : <ChevronDown className="size-7 shrink-0" aria-hidden />}
        <span className="sr-only">{open ? "收合" : "展開"}</span>
      </button>
      {open && (
        <ol id={panelId} className="flex flex-col gap-2 px-3 pb-3">
          {list.map((ad) => (
            <RouteRow key={ad.assignment.id} ad={ad} snapshot={snapshot} teamId={teamId} td={td} />
          ))}
        </ol>
      )}
    </section>
  );
}
