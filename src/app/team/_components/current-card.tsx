"use client";

import * as React from "react";
import { Flag, MapPin, Swords } from "lucide-react";
import type { CheckStatus } from "@/lib/api/contract";
import { EARLY_CHECK_IN_CONFIRM_MS, GAME_NAMES } from "@/lib/constants";
import type { AssignmentDerived, DerivedGame, SecondaryTag, TeamDerived } from "@/lib/derive/types";
import {
  INSUFFICIENT_TIME_CLASS,
  slotLabel,
  teamName,
  teamStateClasses,
} from "@/lib/labels";
import { formatClockSmart, formatCountdown, formatDuration, formatHm, formatHmRange, formatHms } from "@/lib/time";
import type { CheckRecordRow, GameCode, GameSnapshot } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { SecondaryTagChips, TeamStateBadge } from "@/components/state-badges";
import { Timer } from "@/components/timer";
import { TeamCheckButton, type CheckConfirmSpec } from "./check-button";
import { firstStop, leaveToNextTarget, opponentView, teamRecordAt, type LocalRecord, type TeamProp } from "./helpers";

export interface CurrentCardProps {
  gameCode: GameCode;
  snapshot: GameSnapshot;
  derived: DerivedGame;
  td: TeamDerived;
  team: TeamProp;
  now: number;
  getNow: () => number;
  canOperate: boolean;
  local: ReadonlyArray<LocalRecord>;
  knownIds: ReadonlySet<string>;
  undoneIds: ReadonlySet<string>;
  /** 撤銷後遞增：讓按鈕重新掛載（丟棄舊的 clientRequestId 與提示） */
  undoEpoch: number;
  /** 黃金時：下午大地的快照（顯示「下午大地第一站」用） */
  landPeek: { snapshot: GameSnapshot | null; loading: boolean; error: string | null };
  refetch: () => Promise<void>;
  onRecorded: (record: CheckRecordRow, status: CheckStatus) => void;
}

/** 時段資訊：「第2時段 09:32–09:47」＋有延後時「原定 09:32」 */
function SlotLine({ ad, className }: { ad: AssignmentDerived; className?: string }) {
  const shifted = ad.slot.totalOffsetMs !== 0;
  return (
    <p className={cn("timer-digits text-xl font-bold text-slate-800", className)}>
      {slotLabel(ad.slot.number)} {formatHmRange(ad.slot.scheduledStart, ad.slot.scheduledEnd)}
      {shifted && <span className="ml-2 text-base text-slate-600">原定 {formatHm(ad.slot.originalStart)}</span>}
    </p>
  );
}

function OpponentLine({ snapshot, derived, ad, teamId }: { snapshot: GameSnapshot; derived: DerivedGame; ad: AssignmentDerived; teamId: string }) {
  const view = opponentView(snapshot, derived, ad, teamId);
  if (!view) return null;
  const classes = view.arrived
    ? "bg-purple-50 text-purple-900 border-purple-500"
    : view.derived
      ? teamStateClasses(view.derived).badge
      : "bg-slate-100 text-slate-800 border-slate-300";
  return (
    <p className={cn("flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-xl font-black", classes)}>
      <Swords className="size-6 shrink-0" aria-hidden />
      <span className="timer-digits min-w-0">{view.text}</span>
    </p>
  );
}

function tagText(tag: SecondaryTag, ad: AssignmentDerived, isCurrent: boolean): string {
  return isCurrent ? tag.label : `「${ad.station.name}」${tag.label}`;
}

/** 本隊相關的次要標籤（目前這一場與上一場） */
function teamTags(teamId: string, cur: AssignmentDerived | null, prev: AssignmentDerived | null): string[] {
  const out: string[] = [];
  if (prev) for (const t of prev.tags) if (t.teamId === teamId) out.push(tagText(t, prev, false));
  if (cur) for (const t of cur.tags) if (t.teamId === teamId) out.push(tagText(t, cur, true));
  return out;
}

/** 隊輔頁主卡片（第十六節）：目前關卡 = 第十節 B 小隊狀態機指向的 assignment。 */
export function CurrentCard(props: CurrentCardProps) {
  const { gameCode, snapshot, derived, td, team, now, getNow, canOperate, local, knownIds, undoneIds, undoEpoch, landPeek, refetch, onRecorded } =
    props;
  const cur = td.currentAssignmentId ? (derived.assignments.get(td.currentAssignmentId) ?? null) : null;
  const prev = td.previousAssignmentId ? (derived.assignments.get(td.previousAssignmentId) ?? null) : null;
  const classes = teamStateClasses(td, cur?.state ?? null);
  const tName = teamName(team);
  const tags = teamTags(team.id, cur, td.state === "COMPLETED" ? null : prev);

  const recordAt = (ad: AssignmentDerived, action: "team_check_in" | "team_check_out") =>
    teamRecordAt(ad, team.id, action, local, knownIds, undoneIds);

  const checkButton = (
    ad: AssignmentDerived,
    action: "team_check_in" | "team_check_out",
    opts: {
      variant?: "primary" | "success" | "secondary";
      size?: "md" | "lg" | "xl";
      getConfirm?: () => CheckConfirmSpec | null;
      /** 預設「確認進關」／「確認出關」 */
      label?: string;
    } = {},
  ) => {
    const at = recordAt(ad, action);
    return (
      <TeamCheckButton
        key={`${ad.assignment.id}|${action}|${undoEpoch}`}
        assignmentId={ad.assignment.id}
        action={action}
        teamId={team.id}
        label={opts.label ?? (action === "team_check_in" ? "確認進關" : "確認出關")}
        doneAt={at}
        doneText={at === null ? null : action === "team_check_in" ? `隊輔確認：${formatHms(at)}` : `隊輔確認出關：${formatHms(at)}`}
        canOperate={canOperate}
        variant={opts.variant}
        size={opts.size}
        getConfirm={opts.getConfirm}
        refetch={refetch}
        onRecorded={onRecorded}
      />
    );
  };

  /** 早於預定開始超過 7 分鐘按進關：先確認（避免在上一關誤按下一關的進關） */
  const earlyCheckInConfirm = (ad: AssignmentDerived) => (): CheckConfirmSpec | null => {
    const until = ad.slot.scheduledStart - getNow();
    if (until <= EARLY_CHECK_IN_CONFIRM_MS) return null;
    return {
      title: "尚未到時段",
      description: `「${ad.station.name}」${formatHm(ad.slot.scheduledStart)} 才開始。確定${tName}已經抵達「${ad.station.name}」？`,
      confirmLabel: "已抵達，確認進關",
    };
  };

  /** 關主還沒出關就按出關：先確認（隊輔已出關、關主未出關是最危險的情況） */
  const checkoutConfirm = (ad: AssignmentDerived) => (): CheckConfirmSpec | null => {
    if (ad.stationCheckOut) return null;
    return {
      title: "關主尚未確認出關",
      description: `關主還沒有按出關。確定${tName}已經離開「${ad.station.name}」？`,
      confirmLabel: "已離開，確認出關",
    };
  };

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <TeamStateBadge
        state={td.state}
        arrivedDetail={td.arrivedDetail}
        overdueFirstStation={td.overdueFirstStation}
        transitionWarning={td.transitionWarning}
        stationState={cur?.state ?? null}
        size="lg"
        solid
      />
      <span className="text-xl font-black text-slate-950">{tName}</span>
    </div>
  );

  // ---------------------------------------------------------------- COMPLETED
  if (td.state === "COMPLETED") {
    const land = gameCode === "gold" && landPeek.snapshot ? firstStop(landPeek.snapshot, team.id) : null;
    return (
      <section className={cn("flex flex-col gap-4 rounded-3xl border-4 p-4", classes.card)}>
        {header}
        <h2 className="flex items-center gap-2 text-4xl font-black leading-tight text-slate-950">
          <Flag className="size-9 shrink-0" aria-hidden />
          {GAME_NAMES[gameCode]}完成
        </h2>
        {!cur && <p className="text-xl font-bold text-slate-800">本隊在{GAME_NAMES[gameCode]}沒有需要前往的關卡（已全部取消）。</p>}
        {gameCode === "gold" && (
          <div className="rounded-2xl border-2 border-slate-300 bg-white p-4">
            <p className="text-lg font-bold text-slate-700">下午大地第一站</p>
            {land ? (
              <p className="timer-digits text-3xl font-black leading-tight text-slate-950">
                {land.station.name} {formatHm(land.slot.scheduledStart)}
                <span className="ml-2 text-lg font-bold text-slate-700">（{slotLabel(land.slot.number)}）</span>
              </p>
            ) : (
              <p className="text-xl font-bold text-slate-700">
                {landPeek.loading ? "讀取中…" : landPeek.error ? "無法讀取下午大地排程，請稍後重新整理。" : "本隊下午沒有大地遊戲場次。"}
              </p>
            )}
          </div>
        )}
        {cur && cur.stationCheckOut && (
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4">
            <p className="text-lg font-bold text-slate-700">最後一關：{cur.station.name}</p>
            <p className="timer-digits text-xl font-black text-slate-950">
              {cur.noShow ? "關主已標記本場未到" : `關主已於 ${formatHms(cur.stationCheckOut.recordedAt)} 確認出關`}
            </p>
            {!cur.noShow && checkButton(cur, "team_check_out", { variant: "primary", size: "lg" })}
          </div>
        )}
        <SecondaryTagChips tags={tags} size="md" />
      </section>
    );
  }

  if (!cur) {
    return (
      <section className={cn("flex flex-col gap-3 rounded-3xl border-4 p-4", classes.card)}>
        {header}
        <p className="text-xl font-bold">目前沒有要前往的關卡。</p>
      </section>
    );
  }

  // ------------------------------------------ WAITING / TRANSITIONING / TRANSITION_OVERDUE
  if (td.state === "WAITING" || td.state === "TRANSITIONING" || td.state === "TRANSITION_OVERDUE") {
    const firstLeg = td.previousCheckOut === null;
    const deadlineText = td.deadline === null ? null : firstLeg ? formatHm(td.deadline) : formatHms(td.deadline);
    const prevOut = prev?.stationCheckOut ?? null;
    return (
      <section className={cn("flex flex-col gap-4 rounded-3xl border-4 p-4", classes.card)}>
        {header}

        {prev && prevOut && (
          <div className="flex flex-col gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4">
            <p className="text-lg font-bold text-slate-700">上一關：{prev.station.name}</p>
            <p className="timer-digits text-xl font-black text-slate-950">
              {prev.noShow ? "關主已標記本場未到" : `關主已於 ${formatHms(prevOut.recordedAt)} 確認出關`}
            </p>
            {!prev.noShow && checkButton(prev, "team_check_out", { variant: "secondary", size: "lg" })}
          </div>
        )}

        {td.skippedCancelledAssignmentIds.map((id) => {
          const c = derived.assignments.get(id);
          if (!c) return null;
          return (
            <p key={id} className="rounded-xl border-2 border-slate-400 bg-slate-100 px-3 py-2 text-lg font-black text-slate-800">
              {slotLabel(c.slot.number)} {c.station.name} 已取消{c.cancellation ? `（${c.cancellation.reason}）` : ""}，下一關：{cur.station.name}
            </p>
          );
        })}

        <div className="flex flex-col gap-1">
          <h2 className="flex items-start gap-2 text-4xl font-black leading-tight text-slate-950">
            <MapPin className="mt-1 size-8 shrink-0" aria-hidden />
            <span className="min-w-0">
              {firstLeg ? "第一關" : "下一關"}：{cur.station.name}
            </span>
          </h2>
          <SlotLine ad={cur} />
          {deadlineText && (
            <p className="timer-digits text-2xl font-black text-slate-950">須於 {deadlineText} 前抵達</p>
          )}
        </div>

        {td.state === "WAITING" ? (
          td.transitionRemainingMs !== null && (
            <p className="timer-digits text-xl font-bold text-slate-800">距離開始還有 {formatCountdown(td.transitionRemainingMs)}</p>
          )
        ) : (
          <Timer
            variant="transition"
            remainingMs={td.transitionRemainingMs}
            trackKey={cur.assignment.id}
            size="lg"
            alert={false}
            caption={td.overdueFirstStation ? "未到第一關" : undefined}
          />
        )}

        <OpponentLine snapshot={snapshot} derived={derived} ad={cur} teamId={team.id} />
        <SecondaryTagChips tags={tags} size="md" />

        {checkButton(cur, "team_check_in", { variant: "primary", size: "xl", getConfirm: earlyCheckInConfirm(cur) })}
      </section>
    );
  }

  // ------------------------------------------------------------ ARRIVED / AT_STATION
  const checkInAt = recordAt(cur, "team_check_in");
  const checkOutAt = recordAt(cur, "team_check_out");
  const started = cur.startedAt !== null && now >= cur.startedAt && cur.stationCheckIn !== null;
  const canCheckOut = checkInAt !== null || cur.stationCheckIn !== null;
  // 上一關關主已出關、本隊隊輔還沒按出關，而且本隊在這一關還沒有隊輔紀錄（有了就不能再對前面的關卡打卡）→ 仍可補按上一關出關。
  // 剛在本頁補按完的，保留顯示「隊輔確認出關：HH:mm:ss」直到本隊在這一關按下任何確認。
  const prevOut = prev?.stationCheckOut ?? null;
  const prevId = prev?.assignment.id ?? null;
  const prevJustPressed = prevId !== null && local.some((r) => r.assignmentId === prevId && r.action === "team_check_out");
  const prevNeedsTeamOut =
    canOperate &&
    prev !== null &&
    prevOut !== null &&
    !prev.noShow &&
    (recordAt(prev, "team_check_out") === null || prevJustPressed) &&
    checkInAt === null &&
    checkOutAt === null;

  // 第二十一節「上一關尚未關主出關時按下一關進關：允許」＋第三十四節突發 2：
  // 本關關主忘了按出關、小隊其實已經到下一關 → 隊輔可以直接對「下一關」按進關，推導會自動把小隊移到下一關。
  // 只在小隊看起來已經離開時顯示（隊輔已按出關／本場已到結束時間／下一關快開始），避免在本關進行中誤按。
  const next = canOperate ? leaveToNextTarget(derived, td, cur, checkOutAt !== null, now) : null;
  const leaveToNextConfirm = (nx: AssignmentDerived) => (): CheckConfirmSpec => {
    const early = nx.slot.scheduledStart - getNow() > EARLY_CHECK_IN_CONFIRM_MS;
    return {
      title: "關主尚未確認出關",
      description: `「${cur.station.name}」關主尚未確認出關。確定${tName}已經到了「${nx.station.name}」？${
        early ? `（「${nx.station.name}」${formatHm(nx.slot.scheduledStart)} 才開始）` : ""
      }`,
      confirmLabel: "已到下一關，確認進關",
    };
  };

  let detail: React.ReactNode = null;
  if (td.state === "ARRIVED") {
    switch (td.arrivedDetail) {
      case "TEAM_REPORTED":
        detail = <p className="text-3xl font-black text-purple-900">已到，等待關主開始</p>;
        break;
      case "WAITING_START":
        detail = <p className="text-3xl font-black text-purple-900">已到，等待開始</p>;
        break;
      case "WAITING_OPPONENT":
        detail = <p className="text-3xl font-black text-purple-900">已到，等待對手</p>;
        break;
      case "QUEUED":
        detail = <p className="text-3xl font-black text-purple-900">已到，排隊中（前一隊尚未出關）</p>;
        break;
      default:
        detail = null;
    }
  }

  const endCaption =
    cur.officialEnd !== null ? (
      <span className="timer-digits">
        至 {formatClockSmart(cur.officialEnd)} 結束
        {cur.shortenedMs !== null && `（本場縮短 ${formatDuration(cur.shortenedMs)}）`}
      </span>
    ) : null;

  // 關主已進關、本隊隊輔還沒按：把「確認進關」提到最上面、醒目提醒（計時規則不變，只是顯示）
  const urgeCheckIn =
    canOperate && cur.stationCheckIn !== null && !cur.stationCheckOut && recordAt(cur, "team_check_in") === null;

  return (
    <section className={cn("flex flex-col gap-4 rounded-3xl border-4 p-4", classes.card)}>
      {header}

      {urgeCheckIn && cur.stationCheckIn && (
        <div className="flex flex-col gap-3 rounded-2xl border-4 border-orange-500 bg-orange-50 p-4 shadow-lg" role="alert">
          <p className="text-2xl font-black leading-snug text-orange-950">
            關主已於 <span className="timer-digits">{formatHms(cur.stationCheckIn.recordedAt)}</span> 確認進關，請按「確認進關」回報本隊已到
          </p>
          {checkButton(cur, "team_check_in", { variant: "primary", size: "xl" })}
        </div>
      )}

      {prevNeedsTeamOut && prev && prevOut && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4">
          <p className="text-lg font-bold text-slate-700">上一關：{prev.station.name}</p>
          <p className="timer-digits text-xl font-black text-slate-950">關主已於 {formatHms(prevOut.recordedAt)} 確認出關</p>
          {checkButton(prev, "team_check_out", { variant: "secondary", size: "lg" })}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-lg font-bold text-slate-700">
          <MapPin className="size-5" aria-hidden />
          目前
        </p>
        <h2 className="text-4xl font-black leading-tight text-slate-950">{cur.station.name}</h2>
        <SlotLine ad={cur} />
      </div>

      {detail}

      {td.state === "AT_STATION" ? (
        <Timer variant="station" remainingMs={cur.remainingMs} trackKey={cur.assignment.id} size="lg" alert={false} caption={endCaption} />
      ) : (
        cur.untilStartMs !== null &&
        cur.untilStartMs > 0 && (
          <Timer
            variant="station"
            remainingMs={null}
            untilStartMs={cur.untilStartMs}
            startAt={cur.startedAt}
            trackKey={cur.assignment.id}
            size="lg"
            alert={false}
          />
        )
      )}

      <div className="rounded-2xl border-2 border-slate-300 bg-white p-3">
        <p className="text-lg font-bold text-slate-700">關主</p>
        <p className="timer-digits text-xl font-black text-slate-950">
          {cur.stationCheckIn ? `已於 ${formatHms(cur.stationCheckIn.recordedAt)} 確認進關` : "尚未確認進關"}
        </p>
        {cur.singleTeamStart && (
          <p className="text-lg font-bold text-orange-800">單隊開始{cur.stationCheckIn?.reason ? `（${cur.stationCheckIn.reason}）` : ""}</p>
        )}
      </div>

      {!cur.stationCheckIn && <OpponentLine snapshot={snapshot} derived={derived} ad={cur} teamId={team.id} />}

      {cur.insufficientTime && (
        <p className={cn("rounded-xl px-3 py-2 text-lg font-black", INSUFFICIENT_TIME_CLASS)}>
          時間不足：本場只有 {cur.playableMs !== null ? formatCountdown(cur.playableMs) : "--:--"}
        </p>
      )}
      <SecondaryTagChips tags={tags} size="md" />

      {!urgeCheckIn && checkButton(cur, "team_check_in", { variant: "primary", size: "xl" })}

      {canCheckOut &&
        checkButton(cur, "team_check_out", {
          variant: started ? "primary" : "secondary",
          size: started ? "xl" : "lg",
          getConfirm: checkoutConfirm(cur),
        })}
      {checkOutAt !== null && !cur.stationCheckOut && (
        <p className="rounded-xl border-2 border-purple-500 bg-purple-50 px-3 py-2 text-xl font-black text-purple-900">等待關主確認出關</p>
      )}

      {next && (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-slate-400 bg-white p-3">
          <p className="text-lg font-bold text-slate-700">關主還沒按出關？小隊已經到了下一關，就直接在這裡確認進關。</p>
          {checkButton(next, "team_check_in", {
            variant: "secondary",
            size: "lg",
            label: `已離開，抵達下一關：${next.station.name}`,
            getConfirm: leaveToNextConfirm(next),
          })}
        </div>
      )}
    </section>
  );
}
