"use client";
/**
 * 取消與延長分頁（第二十四之二、八節）：
 * - 選關卡＋時段 → 該場的總召操作（取消本場／取消本關接下來所有時段／撤銷取消／延長／撤銷延長／強制結束）
 * - 時間不足（FIXED_END 壓縮）的場次：一鍵延長
 * - 取消紀錄（撤銷取消）、延長紀錄（修改延長、撤銷延長）
 * 所有操作都走 src/components/admin-actions.tsx（原因必填、二次確認、不自動重試）。
 */
import * as React from "react";
import { Ban, TimerReset, Undo2 } from "lucide-react";
import type { AdminVoidCancellationRequest, AdminVoidEndOverrideRequest } from "@/lib/api/contract";
import { stationAssignments, stationFocusAssignment } from "@/lib/derive";
import type { AssignmentDerived, DerivedGame } from "@/lib/derive/types";
import { INSUFFICIENT_TIME_CLASS, slotLabel, stationStateClasses, stationStateLabel } from "@/lib/labels";
import { formatCountdown, formatDuration, formatHm, formatHmRange, formatHms, formatSignedDuration } from "@/lib/time";
import type { GameSnapshot } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { AdminAssignmentActions, AdminReasonAction, ExtendDialog, assignmentTeamsText, assignmentTitle } from "@/components/admin-actions";
import { StationStateBadge } from "@/components/state-badges";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Section, StatusPill, type ReadyTabProps } from "@/app/admin/_components/a-shared";

export function CancelExtendTab(props: ReadyTabProps) {
  const { snapshot, derived, live } = props;
  const now = live.now;
  const onDone = () => void live.refetch();

  const [stationChoice, setStationChoice] = React.useState<string | null>(null);
  const [assignmentChoice, setAssignmentChoice] = React.useState<string | null>(null);
  const [extendId, setExtendId] = React.useState<string | null>(null);
  const ids = { station: React.useId(), slot: React.useId() };

  const stationId =
    stationChoice && snapshot.stations.some((s) => s.id === stationChoice) ? stationChoice : (snapshot.stations[0]?.id ?? null);
  const list = stationId ? stationAssignments(snapshot, derived, stationId) : [];
  const focus = stationId ? stationFocusAssignment(snapshot, derived, stationId) : null;
  const selected: AssignmentDerived | null =
    (assignmentChoice ? list.find((a) => a.assignment.id === assignmentChoice) : undefined) ?? focus ?? list[0] ?? null;

  const extendTarget = extendId ? (derived.assignments.get(extendId) ?? null) : null;

  const stationOptions = snapshot.stations.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }));
  const slotOptions = list.map((ad) => ({
    value: ad.assignment.id,
    label: `${slotLabel(ad.slot.number)} ${formatHmRange(ad.slot.scheduledStart, ad.slot.scheduledEnd)}　${assignmentTeamsText(snapshot, ad)}・${stationStateLabel(ad.state, ad.noShow)}`,
  }));
  const restSlots = stationId ? snapshot.slots.length - list.length : 0;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="取消關卡／延長時間"
        description="先選關卡與時段，再選要做的操作。進行中的場次不能取消，要先由關主出關或強制結束。取消與延長都可以撤銷。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="關卡" htmlFor={ids.station}>
            <Select
              id={ids.station}
              value={stationId ?? ""}
              options={stationOptions}
              onChange={(e) => {
                setStationChoice(e.target.value);
                setAssignmentChoice(null);
              }}
            />
          </Field>
          <Field
            label="時段"
            htmlFor={ids.slot}
            hint={restSlots > 0 ? `本關有 ${restSlots} 個時段休息（沒有安排，不在清單中）。` : "預設為本關目前（最早一個尚未出關）的場次。"}
          >
            <Select
              id={ids.slot}
              value={selected?.assignment.id ?? ""}
              options={slotOptions}
              onChange={(e) => setAssignmentChoice(e.target.value)}
              disabled={slotOptions.length === 0}
            />
          </Field>
        </div>

        {selected ? (
          <SelectedAssignment snapshot={snapshot} ad={selected} now={now} onDone={onDone} />
        ) : (
          <p className="text-lg font-bold text-slate-600">這個關卡沒有任何場次。</p>
        )}
      </Section>

      <InsufficientList snapshot={snapshot} derived={derived} onExtend={setExtendId} />
      <CancellationsList snapshot={snapshot} derived={derived} onDone={onDone} />
      <OverridesList snapshot={snapshot} derived={derived} onDone={onDone} onExtend={setExtendId} />

      {extendTarget && (
        <ExtendDialog
          key={extendTarget.assignment.id}
          open
          onOpenChange={(o) => {
            if (!o) setExtendId(null);
          }}
          assignment={extendTarget}
          snapshot={snapshot}
          now={now}
          onDone={onDone}
        />
      )}
    </div>
  );
}

// =====================================================================
// 選取的場次
// =====================================================================

function SelectedAssignment({ snapshot, ad, now, onDone }: { snapshot: GameSnapshot; ad: AssignmentDerived; now: number; onDone: () => void }) {
  const classes = stationStateClasses(ad.state, ad.noShow);
  const moved = ad.slot.totalOffsetMs !== 0;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-col gap-2 rounded-2xl border-2 p-4", classes.card)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-xl font-black">{assignmentTitle(ad)}</span>
          <StationStateBadge state={ad.state} noShow={ad.noShow} />
        </div>
        <p className="text-lg font-black">{assignmentTeamsText(snapshot, ad)}</p>
        {moved && <p className="timer-digits text-sm font-bold opacity-80">原定 {formatHmRange(ad.slot.originalStart, ad.slot.originalEnd)}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-base font-bold">
          {ad.stationCheckIn && (
            <>
              <dt className="opacity-75">關主進關</dt>
              <dd className="timer-digits">{formatHms(ad.stationCheckIn.recordedAt)}</dd>
            </>
          )}
          {ad.startedAt !== null && (
            <>
              <dt className="opacity-75">開始計時</dt>
              <dd className="timer-digits">
                {formatHms(ad.startedAt)}
                {ad.deltaVsScheduledMs !== null && ad.deltaVsScheduledMs !== 0 && (
                  <span className="ml-2">（較預定 {formatSignedDuration(ad.deltaVsScheduledMs)}）</span>
                )}
              </dd>
            </>
          )}
          {ad.officialEnd !== null && (
            <>
              <dt className="opacity-75">正式結束</dt>
              <dd className="timer-digits">
                {formatHms(ad.officialEnd)}
                {ad.endOverride && <span className="ml-2 text-blue-800">（已延長）</span>}
              </dd>
            </>
          )}
          {ad.remainingMs !== null && !ad.stationCheckOut && (
            <>
              <dt className="opacity-75">{ad.remainingMs < 0 ? "已超時" : "關卡剩餘"}</dt>
              <dd className={cn("timer-digits text-lg font-black", classes.text)}>{formatCountdown(ad.remainingMs)}</dd>
            </>
          )}
          {ad.stationCheckOut && (
            <>
              <dt className="opacity-75">{ad.noShow ? "本隊未到" : "關主出關"}</dt>
              <dd className="timer-digits">{formatHms(ad.stationCheckOut.recordedAt)}</dd>
            </>
          )}
        </dl>
        {ad.shortenedMs !== null && ad.shortenedMs > 0 && ad.officialEnd !== null && (
          <p className={cn("self-start rounded-lg px-2 py-1 text-base font-black", ad.insufficientTime ? INSUFFICIENT_TIME_CLASS : "bg-white/70")}>
            本場縮短 {formatDuration(ad.shortenedMs)}，至 {formatHm(ad.officialEnd)} 結束{ad.insufficientTime ? "（時間不足）" : ""}
          </p>
        )}
        {ad.cancellation && (
          <p className="text-base font-black text-slate-700">
            已取消（{ad.cancellation.reason}）<span className="timer-digits font-bold">・{formatHms(ad.cancellation.createdAt)}</span>
          </p>
        )}
        {ad.endOverride && (
          <p className="text-base font-bold text-blue-900">
            延長至 <span className="timer-digits">{formatHms(ad.endOverride.officialEnd)}</span>（{ad.endOverride.reason}）
          </p>
        )}
        {!ad.stationCheckIn && snapshot.game.endPolicy === "FIXED_END" && now >= ad.slot.scheduledEnd && !ad.cancellation && !ad.stationCheckOut && (
          <p className="text-base font-black text-red-700">本時段已結束，關主無法開始；請延長或取消本場。</p>
        )}
      </div>

      <AdminAssignmentActions key={ad.assignment.id} assignment={ad} snapshot={snapshot} now={now} onDone={onDone} />
    </div>
  );
}

// =====================================================================
// 時間不足的場次
// =====================================================================

function InsufficientList({
  snapshot,
  derived,
  onExtend,
}: {
  snapshot: GameSnapshot;
  derived: DerivedGame;
  onExtend: (assignmentId: string) => void;
}) {
  const items = [...derived.assignments.values()].filter((ad) => ad.insufficientTime && !ad.stationCheckOut && ad.state !== "CANCELLED");
  if (items.length === 0) return null;
  return (
    <Section title="時間不足的場次" description="大地（FIXED_END）因晚開始被壓縮、可玩時間少於最低可玩時間的場次。" tone="warning">
      <ul className="flex flex-col gap-3">
        {items.map((ad) => (
          <li key={ad.assignment.id} className="flex flex-col gap-2 rounded-xl border-2 border-yellow-500 bg-yellow-50 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-lg font-black text-slate-950">{assignmentTitle(ad)}</p>
              <p className="text-base font-bold text-slate-800">
                {assignmentTeamsText(snapshot, ad)}
                {ad.playableMs !== null && <>・可玩 {formatCountdown(ad.playableMs)}</>}
                {ad.officialEnd !== null && <>，至 {formatHm(ad.officialEnd)} 結束</>}
              </p>
            </div>
            <Button variant="primary" size="md" onClick={() => onExtend(ad.assignment.id)}>
              <TimerReset className="size-6" aria-hidden />
              延長
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// =====================================================================
// 取消紀錄
// =====================================================================

function CancellationsList({ snapshot, derived, onDone }: { snapshot: GameSnapshot; derived: DerivedGame; onDone: () => void }) {
  const list = [...snapshot.cancellations].sort((a, b) => b.createdAt - a.createdAt);
  const activeCount = list.filter((c) => c.voidedAt === null).length;
  return (
    <Section
      title="取消紀錄"
      description="被取消的場次顯示「已取消（原因）」灰色、拒絕打卡，相關隊伍直接前往再下一個場次。"
      aside={<span className="text-base font-black text-slate-700">有效 {activeCount} 筆</span>}
    >
      {list.length === 0 ? (
        <p className="text-lg font-bold text-slate-600">目前沒有取消任何場次。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((c) => {
            const ad = derived.assignments.get(c.assignmentId);
            const active = c.voidedAt === null;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border-2 p-3 sm:flex-row sm:items-center",
                  active ? "border-slate-400 bg-slate-100" : "border-slate-300 bg-white text-slate-600",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill active={active} />
                    <Ban className="size-5 text-slate-600" aria-hidden />
                    <span className={cn("text-lg font-black", !active && "line-through")}>{ad ? assignmentTitle(ad) : "（找不到場次）"}</span>
                  </div>
                  <p className="text-base font-bold">
                    {ad ? assignmentTeamsText(snapshot, ad) : ""}・原因：{c.reason}・<span className="timer-digits">{formatHms(c.createdAt)}</span>
                  </p>
                  {!active && (
                    <p className="text-base font-bold">
                      已撤銷{c.voidedAt !== null && <span className="timer-digits">（{formatHms(c.voidedAt)}）</span>}
                      {c.voidReason && `：${c.voidReason}`}
                    </p>
                  )}
                </div>
                {active && (
                  <AdminReasonAction
                    label="撤銷取消"
                    icon={<Undo2 className="size-6" aria-hidden />}
                    size="md"
                    title="撤銷取消"
                    description={`恢復 ${ad ? `${assignmentTitle(ad)}・${assignmentTeamsText(snapshot, ad)}` : "這個場次"}？（原取消原因：${c.reason}）`}
                    confirmLabel="確定撤銷取消"
                    url="/api/admin/cancellations/void"
                    buildBody={(reason) => ({ cancellationId: c.id, reason }) satisfies AdminVoidCancellationRequest}
                    successMessage="已撤銷取消"
                    reasonPlaceholder="例如：雨停，恢復進行"
                    onDone={onDone}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// =====================================================================
// 延長紀錄
// =====================================================================

function OverridesList({
  snapshot,
  derived,
  onDone,
  onExtend,
}: {
  snapshot: GameSnapshot;
  derived: DerivedGame;
  onDone: () => void;
  onExtend: (assignmentId: string) => void;
}) {
  const list = [...snapshot.endOverrides].sort((a, b) => b.createdAt - a.createdAt);
  const activeCount = list.filter((o) => o.voidedAt === null).length;
  return (
    <Section
      title="延長紀錄（end override）"
      description="延長後以新的結束時間為正式結束；撤銷後回到依遊戲規則計算的結束時間。"
      aside={<span className="text-base font-black text-slate-700">有效 {activeCount} 筆</span>}
    >
      {list.length === 0 ? (
        <p className="text-lg font-bold text-slate-600">目前沒有延長任何場次。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((o) => {
            const ad = derived.assignments.get(o.assignmentId);
            const active = o.voidedAt === null;
            const editable = active && !!ad && !ad.stationCheckOut && ad.state !== "CANCELLED";
            return (
              <li
                key={o.id}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border-2 p-3 lg:flex-row lg:items-center",
                  active ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white text-slate-600",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill active={active} />
                    <span className={cn("text-lg font-black", !active && "line-through")}>{ad ? assignmentTitle(ad) : "（找不到場次）"}</span>
                  </div>
                  <p className="text-base font-bold">
                    {ad ? `${assignmentTeamsText(snapshot, ad)}・` : ""}延長至 <span className="timer-digits font-black">{formatHms(o.officialEnd)}</span>
                    ・原因：{o.reason}・<span className="timer-digits">{formatHms(o.createdAt)}</span>
                  </p>
                  {!active && (
                    <p className="text-base font-bold">
                      已撤銷{o.voidedAt !== null && <span className="timer-digits">（{formatHms(o.voidedAt)}）</span>}
                      {o.voidReason && `：${o.voidReason}`}
                    </p>
                  )}
                </div>
                {editable && ad && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="primary" size="md" onClick={() => onExtend(ad.assignment.id)}>
                      <TimerReset className="size-6" aria-hidden />
                      修改延長
                    </Button>
                    <AdminReasonAction
                      label="撤銷延長"
                      icon={<Undo2 className="size-6" aria-hidden />}
                      size="md"
                      title="撤銷延長"
                      description={`${assignmentTitle(ad)}・${assignmentTeamsText(snapshot, ad)}：撤銷「延長至 ${formatHms(o.officialEnd)}」，結束時間回到依遊戲規則計算的時間。`}
                      confirmLabel="確定撤銷延長"
                      url="/api/admin/end-override/void"
                      buildBody={(reason) => ({ overrideId: o.id, reason }) satisfies AdminVoidEndOverrideRequest}
                      successMessage="已撤銷延長"
                      onDone={onDone}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
