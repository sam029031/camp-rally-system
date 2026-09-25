"use client";

import type { ReactNode } from "react";
import type { DerivedGame, TeamDerived } from "@/lib/derive/types";
import { NO_SHOW_LABEL, slotLabel, teamStateClasses, teamStateLabel } from "@/lib/labels";
import { formatCountdown, formatHm, formatHms } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { TeamStateBadge } from "@/components/state-badges";
import { remainingView, stationTitle, teamLabel, type Lookup } from "@/app/dashboard/_components/view-model";
import { TONE_CLASSES } from "@/lib/client/state-colors";

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-sm font-bold text-slate-600">{label}</span>
      <span className="min-w-0 text-right text-lg font-bold">{children}</span>
    </div>
  );
}

function TeamCard({ td, d, lk }: { td: TeamDerived; d: DerivedGame; lk: Lookup }) {
  const cur = td.currentAssignmentId ? d.assignments.get(td.currentAssignmentId) : undefined;
  const prev = td.previousAssignmentId ? d.assignments.get(td.previousAssignmentId) : undefined;
  const cls = teamStateClasses(td, cur?.state ?? null);
  const moving = td.state === "WAITING" || td.state === "TRANSITIONING" || td.state === "TRANSITION_OVERDUE";
  const atStation = td.state === "ARRIVED" || td.state === "AT_STATION";

  // 關卡中／已到時的「下一關」= 路線中目前關卡的下一個
  const route = td.routeAssignmentIds;
  const curIdx = td.currentAssignmentId ? route.indexOf(td.currentAssignmentId) : -1;
  const after = atStation && curIdx >= 0 && curIdx + 1 < route.length ? d.assignments.get(route[curIdx + 1]) : undefined;

  const remaining = td.transitionRemainingMs;
  const skipped = td.skippedCancelledAssignmentIds
    .map((id) => d.assignments.get(id))
    .filter((x): x is NonNullable<typeof x> => x !== undefined);

  return (
    <li className={cn("flex flex-col gap-1.5 rounded-2xl border-2 p-3", cls.card)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xl font-black">{teamLabel(lk, td.team.id)}</span>
        <TeamStateBadge
          state={td.state}
          arrivedDetail={td.arrivedDetail}
          overdueFirstStation={td.overdueFirstStation}
          transitionWarning={td.transitionWarning}
          stationState={cur?.state ?? null}
          className="whitespace-normal text-left"
        />
      </div>

      <Line label="目前">{teamStateLabel(td)}</Line>

      {atStation && cur && (
        <>
          <Line label="目前關卡">{stationTitle(cur.station)}</Line>
          {td.arrivedAt !== null && (
            <Line label="抵達">
              <span className="timer-digits">{formatHms(td.arrivedAt)}</span>
            </Line>
          )}
          {td.state === "AT_STATION" && (
            <Line label="關卡剩餘">
              <span className={cn("timer-digits font-black", TONE_CLASSES[remainingView(cur).tone].text)}>{remainingView(cur).text}</span>
            </Line>
          )}
        </>
      )}

      {(moving || td.state === "COMPLETED") && (
        <>
          <Line label="上一關">{prev ? stationTitle(prev.station) : "—（第一關）"}</Line>
          {td.previousCheckOut && (
            <Line label="出關">
              {td.previousCheckOut.noShow ? (
                <span className="font-black text-red-700">{NO_SHOW_LABEL}</span>
              ) : (
                <span className="timer-digits">{formatHms(td.previousCheckOut.recordedAt)}</span>
              )}
            </Line>
          )}
        </>
      )}

      {moving && cur && <Line label="下一關">{stationTitle(cur.station)}</Line>}
      {atStation && (
        <Line label="下一關">
          {after ? (
            <>
              {stationTitle(after.station)}
              <span className="ml-1 text-sm text-slate-600">
                {slotLabel(after.slot.number)} {formatHm(after.slot.scheduledStart)}
              </span>
            </>
          ) : (
            "本關為最後一關"
          )}
        </Line>
      )}

      {moving && td.deadline !== null && (
        <p className="text-lg font-black">
          須於 <span className="timer-digits">{formatHms(td.deadline)}</span> 前抵達
        </p>
      )}
      {moving && remaining !== null && (
        <div
          className={cn(
            "flex items-baseline justify-between gap-2 rounded-xl border-2 px-2 py-1",
            remaining <= 0
              ? cn(TONE_CLASSES.red.solid, "border-red-800")
              : td.transitionWarning
                ? cn(TONE_CLASSES.yellow.solid, "border-yellow-600")
                : "border-slate-300 bg-white",
          )}
        >
          <span className="text-sm font-bold">距離跑關上限</span>
          <span className="timer-digits text-3xl font-black leading-tight">
            {remaining <= 0 ? `逾期 +${formatCountdown(remaining)}` : formatCountdown(remaining)}
          </span>
        </div>
      )}

      {td.state === "COMPLETED" && <p className="text-lg font-black text-slate-700">已完成全部關卡</p>}

      {skipped.map((a) => (
        <p key={a.assignment.id} className="rounded-lg border-2 border-slate-300 bg-slate-100 px-2 py-1 text-sm font-bold text-slate-700">
          {slotLabel(a.slot.number)} {stationTitle(a.station)} 已取消{a.cancellation ? `（${a.cancellation.reason}）` : ""}
        </p>
      ))}
    </li>
  );
}

/** 第十九節：小隊視角（黃金不含幹部隊、大地包含；隊伍來自本遊戲 assignments） */
export function TeamView({ d, lk }: { d: DerivedGame; lk: Lookup }) {
  const teams = [...d.teams.values()];
  if (teams.length === 0) return <p className="py-10 text-center text-lg font-bold text-slate-600">本遊戲沒有隊伍資料</p>;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {teams.map((td) => (
        <TeamCard key={td.team.id} td={td} d={d} lk={lk} />
      ))}
    </ul>
  );
}
