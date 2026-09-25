"use client";

import type { ReactNode } from "react";
import type { AssignmentDerived, DerivedGame } from "@/lib/derive/types";
import { SECONDARY_TAG_RING_CLASS, stationStateClasses } from "@/lib/labels";
import { formatDuration, formatHm } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { TONE_CLASSES } from "@/lib/client/state-colors";
import { AdminActions, FlagChips, RecordTime, SideStatusBadge, StationBadge } from "@/app/dashboard/_components/parts";
import { RowExtras } from "@/app/dashboard/_components/row-extras";
import type { StationListProps } from "@/app/dashboard/_components/gold-stations";
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-sm font-bold text-slate-600">{label}</span>
      <div className="text-lg">{children}</div>
    </div>
  );
}

/** 一隊的欄位：隊名、自己的小隊狀態、隊輔進關／出關 */
function TeamSide({ ad, teamId, d, lk }: { ad: AssignmentDerived; teamId: string; d: DerivedGame; lk: Lookup }) {
  const side = ad.sides.find((s) => s.teamId === teamId) ?? null;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="text-xl font-black leading-tight">{teamLabel(lk, teamId)}</span>
      <SideStatusBadge status={sideStatus(d, lk, ad, teamId)} stationState={ad.state} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-1.5 text-sm">
        <dt className="font-bold text-slate-600">隊輔進關</dt>
        <dd>
          <RecordTime record={side?.teamCheckIn ?? null} />
        </dd>
        <dt className="font-bold text-slate-600">隊輔出關</dt>
        <dd>
          <RecordTime record={side?.teamCheckOut ?? null} />
        </dd>
      </dl>
    </div>
  );
}

function EndText({ ad }: { ad: AssignmentDerived }) {
  if (ad.officialEnd === null) {
    return <span className="timer-digits font-bold">預定 {formatHm(ad.slot.scheduledEnd)}</span>;
  }
  return (
    <span className="font-bold">
      <span className="timer-digits">{formatHm(ad.officialEnd)}</span>
      {ad.shortenedMs !== null && ad.shortenedMs > 0 && (
        <span className="ml-1 text-base font-black text-yellow-800">（本場縮短 {formatDuration(ad.shortenedMs)}）</span>
      )}
      {ad.endOverride && <span className="ml-1 text-base font-black text-blue-800">（已延長）</span>}
    </span>
  );
}

function LandCard({ m, props }: { m: RowModel; props: StationListProps }) {
  const { snapshot, derived: d, lookup: lk, now, isAdmin, onAdminDone } = props;
  const ad = m.primary;
  const station = m.row.station;

  if (!ad) {
    // 本時段休息：灰色、不是故障或尚未進關
    const cls = stationStateClasses("REST");
    return (
      <li className={cn("flex flex-col gap-1 rounded-2xl border-2 p-3", cls.card)}>
        <p className="text-xl font-black leading-tight">
          {stationTitle(station)} <span className="text-sm font-bold text-slate-600">{station.code}</span>
        </p>
        <p className="text-2xl font-black text-slate-700">本時段休息</p>
        <p className="text-base font-bold text-slate-600">{nextGroupText(lk, m.nextRest)}</p>
        <RowExtras m={m} d={d} lk={lk} />
      </li>
    );
  }

  const cls = stationStateClasses(ad.state, ad.noShow);
  const times = slotTimes(ad.slot);
  const remaining = remainingView(ad);
  const flagged = ad.tags.length > 0;
  const cancelled = ad.state === "CANCELLED";

  return (
    <li className={cn("relative flex flex-col gap-2 rounded-2xl border-2 p-3", cls.card, flagged && SECONDARY_TAG_RING_CLASS)}>
      {flagged && (
        <span className="absolute -right-1.5 -top-2.5 rounded-lg bg-orange-500 px-2 py-0.5 text-xs font-black text-white shadow">
          {ad.tags.length} 項待確認
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xl font-black leading-tight">
            {stationTitle(station)} <span className="text-sm font-bold text-slate-600">{station.code}</span>
          </p>
          <p className="text-sm font-bold text-slate-700">
            第{ad.slot.number}時段 <span className="timer-digits">{times.range}</span>
            {times.original && <span className="ml-1 text-orange-700">{times.original}</span>}
            {m.row.showingPrevious && <span className="ml-1">（延續）</span>}
          </p>
        </div>
        <StationBadge ad={ad} className="shrink-0" />
      </div>

      {cancelled ? (
        <p className="text-lg font-bold text-slate-700">
          {ad.teamIds.map((tid) => teamLabel(lk, tid)).join(" VS ")}
        </p>
      ) : (
        <div
          className={cn(
            "grid items-start gap-2 rounded-xl bg-white/70 p-2",
            ad.teamIds.length > 1 ? "grid-cols-[1fr_auto_1fr]" : "grid-cols-1",
          )}
        >
          {ad.teamIds.map((tid, i) => (
            <div key={tid} className="contents">
              {i > 0 && <span className="self-center text-lg font-black text-slate-500">VS</span>}
              <TeamSide ad={ad} teamId={tid} d={d} lk={lk} />
            </div>
          ))}
        </div>
      )}

      {!cancelled && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <Field label="關主進關">
            <RecordTime record={ad.stationCheckIn} />
          </Field>
          <Field label="剩餘">
            <span className={cn("timer-digits text-2xl font-black leading-tight", TONE_CLASSES[remaining.tone].text)}>{remaining.text}</span>
          </Field>
          <Field label="結束">
            <EndText ad={ad} />
          </Field>
          {ad.stationCheckOut && (
            <Field label="關主出關">
              <RecordTime record={ad.stationCheckOut} />
            </Field>
          )}
        </div>
      )}

      {ad.singleTeamStart && (
        <p className={cn("rounded-lg border-2 px-2 py-1 text-sm font-black", TONE_CLASSES.orange.soft)}>
          單隊開始{ad.stationCheckIn?.reason ? `（${ad.stationCheckIn.reason}）` : ""}
        </p>
      )}
      <FlagChips tags={tagTexts(lk, ad)} insufficient={ad.insufficientTime} />
      <RowExtras m={m} d={d} lk={lk} />
      <AdminActions isAdmin={isAdmin} ad={ad} snapshot={snapshot} now={now} onDone={onAdminDone} />
    </li>
  );
}

/** 第十三節：大地遊戲 10 關 VS 卡片（手機一欄、平板兩欄、桌機三欄） */
export function LandStations(props: StationListProps) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {props.rows.map((m) => (
        <LandCard key={m.row.station.id} m={m} props={props} />
      ))}
    </ul>
  );
}
