"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Coffee, Eye, RefreshCw } from "lucide-react";
import { EARLY_CHECK_IN_CONFIRM_MS } from "@/lib/constants";
import { stationAssignments, stationFocusAssignment } from "@/lib/derive";
import type { AssignmentDerived } from "@/lib/derive/types";
import { undoExpiredMessage } from "@/lib/errors";
import { INSUFFICIENT_TIME_CLASS, recordActionLabel, slotLabel } from "@/lib/labels";
import { formatCountdown, formatDuration, formatHm, formatHms, formatSignedDuration } from "@/lib/time";
import type { CheckAction, CheckRecordRow, GameCode } from "@/lib/types";
import { SESSION_EXPIRED_EVENT } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { unlockSound } from "@/lib/client/sound";
import { stationStateTone, TONE_CLASSES } from "@/lib/client/state-colors";
import { useCheckAction, type CheckExtra, type CheckOutcome } from "@/lib/client/use-check-action";
import { useLiveGame } from "@/lib/client/use-live-game";
import { useNotificationWatcher } from "@/lib/client/use-notification-watcher";
import { useUndo } from "@/lib/client/use-undo";
import { AdminAssignmentActions } from "@/components/admin-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { LiveTopBar } from "@/components/live-top-bar";
import { NotificationCenter } from "@/components/notification-center";
import { SecondaryTagChips, StationStateBadge } from "@/components/state-badges";
import { Timer } from "@/components/timer";
import { UndoReminderDialog } from "@/components/undo-reminder-dialog";
import { WakeLockHint } from "@/components/wake-lock-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StationSchedule } from "./station-schedule";
import { UndoZone } from "./undo-zone";
import {
  currentCellAssignment,
  currentSlotText,
  formatClockSmart,
  nameOfTeam,
  noShowAvailable,
  originalRangeText,
  playableIfStartNow,
  redBanners,
  sideStatus,
  slotRangeText,
  startBlockedBySlotEnd,
  teamsTitle,
  type OwnRecordItem,
} from "./station-view";

export interface ReadOnlyNotice {
  /** 例：「你登入的是 A 關（九九乘法）」 */
  text: string;
  href: string;
  /** 例：「前往我的關卡」 */
  linkLabel: string;
}

export interface StationClientProps {
  gameCode: GameCode;
  gameName: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  /** 目前登入的 identity（只能撤銷自己按的紀錄） */
  identityId: string;
  /** 本關關主或 ADMIN → 顯示按鈕 */
  canOperate: boolean;
  /** ADMIN：「以總召身分操作」＋總召專用選項 */
  actingAsAdmin: boolean;
  /** 非本關身分：唯讀提示；null = 可操作 */
  readOnlyNotice: ReadOnlyNotice | null;
}

/** 計時中（或已到等待開始）時保持亮屏 */
const WAKE_STATES = new Set(["READY", "IN_PROGRESS", "ENDING_SOON", "OVERTIME"]);
const STATION_ACTIONS: ReadonlySet<CheckAction> = new Set(["station_check_in", "station_check_out"]);

type DialogState =
  | { kind: "none" }
  /** 黃金：比預定開始早超過 7 分鐘 */
  | { kind: "early"; key: string }
  /** 大地：雙方到齊勾選 */
  | { kind: "pk"; key: string; early: boolean }
  /** 大地：總召單隊開始 */
  | { kind: "single"; key: string; teamId: string | null }
  /** FIXED_END：可玩時間 < min_play */
  | { kind: "short"; key: string; extra: CheckExtra; playableMs: number }
  /** 本隊未到／本場未進行（二次確認） */
  | { kind: "noshow1"; key: string }
  | { kind: "noshow2"; key: string };

function pendingText(attempt: number): string {
  return attempt > 1 ? `網路不穩，重試中（第 ${attempt - 1} 次）…` : "送出中…";
}

function TeamBlock({ name, status }: { name: string; status: ReturnType<typeof sideStatus> }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <p className="text-[clamp(2.25rem,11vw,3.5rem)] font-black leading-none text-slate-950">{name}</p>
      <span
        className={cn(
          "inline-flex max-w-full rounded-lg border-2 px-2.5 py-1 text-lg font-bold leading-snug",
          TONE_CLASSES[status.tone].soft,
          status.dashed && "border-dashed",
        )}
      >
        <span className="timer-digits">{status.text}</span>
      </span>
    </div>
  );
}

/**
 * 關主頁（第十七、十八節）。
 * 主卡片 = 該關「最早一個尚未關主出關、且未取消」的 assignment（不依時鐘）；全部完成 →「本關已完成」。
 * 所有顯示都由即時快照＋app 時鐘推導，refresh 後仍正確。
 */
export function StationClient({
  gameCode,
  gameName,
  stationId,
  stationCode,
  stationName,
  identityId,
  canOperate,
  actingAsAdmin,
  readOnlyNotice,
}: StationClientProps) {
  const live = useLiveGame(gameCode);
  const { snapshot, derived, now, getNow, realNow, status, refetch } = live;

  const [centerOpen, setCenterOpen] = React.useState(false);
  const openCenter = React.useCallback(() => setCenterOpen(true), []);
  const watcher = useNotificationWatcher({
    snapshot,
    derived,
    context: { page: "station", stationId },
    realNow,
    refetch,
    online: status.online,
    onOpenCenter: openCenter,
  });

  // session 失效（改 PIN、停用）→ 回登入頁
  React.useEffect(() => {
    const onExpired = () => window.location.replace("/login");
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const ready = snapshot !== null && derived !== null;
  const focus: AssignmentDerived | null = ready ? stationFocusAssignment(snapshot, derived, stationId) : null;
  const all: AssignmentDerived[] = ready ? stationAssignments(snapshot, derived, stationId) : [];
  const focusId = focus?.assignment.id ?? null;
  const pk = (snapshot?.game.teamsPerStation ?? (gameCode === "land" ? 2 : 1)) === 2;
  const station = snapshot?.stations.find((s) => s.id === stationId) ?? null;

  // 對話框只對「開啟當下的那一場、那個紀錄狀態」有效：別台裝置先按了、或撤銷後，舊對話框自動失效
  // （有效紀錄記 1、已撤銷記 2：新增或撤銷任何一筆關主側紀錄都會改變 key）
  let stationRecordCount = 0;
  if (snapshot && focusId) {
    for (const r of snapshot.records) if (r.assignmentId === focusId && STATION_ACTIONS.has(r.action)) stationRecordCount += r.voidedAt === null ? 1 : 2;
  }
  const focusKey = focusId ? `${focusId}|${stationRecordCount}` : "";

  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const activeDialog: DialogState = dialog.kind !== "none" && dialog.key === focusKey ? dialog : { kind: "none" };
  const closeDialog = () => setDialog({ kind: "none" });

  const [notice, setNotice] = React.useState<string | null>(null);

  // ---- 打卡按鈕（一個按鈕一個 hook） ----
  const actionAssignmentId = canOperate ? focusId : null;
  const checkIn = useCheckAction({ assignmentId: actionAssignmentId, action: "station_check_in", teamId: null }, { refetch });
  const checkOut = useCheckAction({ assignmentId: actionAssignmentId, action: "station_check_out", teamId: null }, { refetch });
  const noShow = useCheckAction({ assignmentId: actionAssignmentId, action: "station_check_out", teamId: null }, { refetch });

  // ---- 現場撤銷 ----
  const [undoTargetId, setUndoTargetId] = React.useState<string | null>(null);
  const undo = useUndo({
    refetch,
    onUndone: () => {
      checkIn.reset();
      checkOut.reset();
      noShow.reset();
      setNotice(null);
    },
  });
  const onUndo = React.useCallback(
    (recordId: string) => {
      setUndoTargetId(recordId);
      void undo.undo(recordId);
    },
    [undo],
  );

  /** 送出成功、但快照還沒更新（避免在同步前重複按） */
  const syncing = (rec: CheckRecordRow | null): boolean => {
    if (!rec || !snapshot) return false;
    return !snapshot.records.some((r) => r.id === rec.id);
  };

  const showOutcome = (label: string, out: CheckOutcome | null) => {
    if (out && out.ok && out.notice) setNotice(`${label}：${out.notice}`);
  };

  // ---- 本 identity 自己按、仍可能撤銷的紀錄（新的在前） ----
  const ownItems: OwnRecordItem[] = [];
  if (ready && canOperate) {
    for (const ad of all) {
      const title = teamsTitle(snapshot, ad, " vs ");
      const ci = ad.stationCheckIn;
      if (ci && ci.identityId === identityId && ci.source === "ui" && !ad.stationCheckOut) {
        ownItems.push({ record: ci, label: `${title} ${recordActionLabel(ci, { pk })}` });
      }
      const co = ad.stationCheckOut;
      if (co && co.identityId === identityId && co.source === "ui") {
        const next = ad.nextAssignmentId ? derived.assignments.get(ad.nextAssignmentId) : null;
        // 下一隊已進關 → 只能找總召修正，不顯示撤銷
        if (!next?.stationCheckIn) ownItems.push({ record: co, label: `${title} ${recordActionLabel(co, { pk })}` });
      }
    }
    ownItems.sort((a, b) => b.record.realCreatedAt - a.record.realCreatedAt);
  }

  // ---- 事件處理（一律用 getNow()，不用 Date.now()） ----
  const submitStart = async (extra: CheckExtra) => {
    setDialog({ kind: "none" });
    setNotice(null);
    const out = await checkIn.submit(extra);
    showOutcome(pk ? "雙方到齊，開始" : "確認進關", out);
  };

  const proceedStart = (extra: CheckExtra) => {
    if (!focus || !snapshot) return;
    const playable = playableIfStartNow(snapshot.game, focus.slot, focus.endOverride, getNow());
    if (snapshot.game.endPolicy === "FIXED_END" && playable < snapshot.game.minPlayMs) {
      setDialog({ kind: "short", key: focusKey, extra, playableMs: playable });
      return;
    }
    void submitStart(extra);
  };

  const onPressStart = () => {
    if (!focus) return;
    // 關主按開始本身就是使用者手勢：順便解鎖聲音（第十五節）
    void unlockSound();
    setNotice(null);
    const early = getNow() < focus.slot.scheduledStart - EARLY_CHECK_IN_CONFIRM_MS;
    if (pk) {
      setDialog({ kind: "pk", key: focusKey, early });
      return;
    }
    if (early) {
      setDialog({ kind: "early", key: focusKey });
      return;
    }
    proceedStart({});
  };

  const onPressCheckOut = async () => {
    void unlockSound();
    setNotice(null);
    const out = await checkOut.submit();
    showOutcome("確認出關", out);
  };

  const onConfirmNoShow = async () => {
    setDialog({ kind: "none" });
    setNotice(null);
    const out = await noShow.submit({ noShow: true });
    showOutcome(pk ? "本場未進行" : "本隊未到", out);
  };

  // ---- 頂端橫幅 ----
  const banners = ready && focus ? redBanners(snapshot, focus) : [];
  const wakeActive = !!focus && WAKE_STATES.has(focus.state);

  const topChildren = (
    <>
      {readOnlyNotice && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-sky-100 px-4 py-2 text-lg font-bold text-sky-950">
          <Eye className="size-6 shrink-0" aria-hidden />
          <span className="min-w-0">{readOnlyNotice.text}，</span>
          <Link href={readOnlyNotice.href} className="inline-flex min-h-11 items-center gap-1 font-black text-blue-800 underline underline-offset-4">
            {readOnlyNotice.linkLabel}
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      )}
      {banners.map((b) => (
        <div key={b.key} role="alert" className="flex items-center gap-3 bg-red-600 px-4 py-3 text-xl font-black leading-snug text-white">
          <AlertTriangle className="size-7 shrink-0" aria-hidden />
          <span className="min-w-0">{b.text}</span>
        </div>
      ))}
      <WakeLockHint active={wakeActive} />
    </>
  );

  // ---- 主要內容 ----
  let body: React.ReactNode;
  if (!ready) {
    body = (
      <Card className="flex flex-col items-center gap-4 p-6 text-center">
        {status.error ? (
          <>
            <p className="text-xl font-bold text-red-700">{status.error}</p>
            <Button variant="secondary" size="lg" onClick={() => void refetch()}>
              <RefreshCw className="size-6" aria-hidden />
              重新載入
            </Button>
          </>
        ) : (
          <p className="text-xl font-bold text-slate-700">載入中…</p>
        )}
      </Card>
    );
  } else if (!station) {
    body = (
      <Card className="p-6 text-center text-xl font-bold text-red-700">找不到這個關卡的排程資料，請聯絡總召。</Card>
    );
  } else {
    const game = snapshot.game;
    const cell = currentCellAssignment(snapshot, derived, stationId);
    let restText: string | null = null;
    if (focus && !focus.stationCheckIn && cell && focus.slot.number > derived.current.slotNumber) {
      const nextWhat = `${formatHm(focus.slot.scheduledStart)} ${teamsTitle(snapshot, focus, " vs ")}`;
      if (cell.kind === "rest") restText = `本時段休息，下一組 ${nextWhat}`;
      else if (cell.ad.state === "CANCELLED")
        restText = `${slotLabel(cell.ad.slot.number)}本關已取消（${cell.ad.cancellation?.reason ?? ""}），下一${pk ? "組" : "隊"} ${nextWhat}`;
    }

    const next = focus?.nextAssignmentId ? (derived.assignments.get(focus.nextAssignmentId) ?? null) : null;
    const nextReported = next ? next.sides.filter((s) => s.teamCheckIn !== null) : [];

    body = (
      <>
        {restText && (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-slate-400 bg-slate-100 px-4 py-3 text-xl font-black text-slate-800">
            <Coffee className="size-7 shrink-0" aria-hidden />
            <span className="timer-digits min-w-0">{restText}</span>
          </div>
        )}

        {focus ? (
          <FocusCard snapshot={snapshot} derived={derived} focus={focus} pk={pk} />
        ) : (
          <Card tone="green" className="flex flex-col items-center gap-3 p-6 text-center">
            <CheckCircle2 className="size-16 text-emerald-700" aria-hidden />
            <p className="text-4xl font-black text-emerald-900">本關已完成</p>
            <p className="text-lg font-bold text-emerald-900">所有場次都已出關，辛苦了！</p>
          </Card>
        )}

        {canOperate && focus && (
          <section aria-label="操作" className="flex flex-col gap-3">
            {!focus.stationCheckIn ? (
              <>
                {startBlockedBySlotEnd(game, focus, now) ? (
                  <div role="alert" className="rounded-2xl border-2 border-red-600 bg-red-50 p-4 text-xl font-black leading-snug text-red-800">
                    本時段已結束，請聯絡總召延長或取消本場
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="success"
                      size="xl"
                      block
                      className="h-24 text-3xl"
                      onClick={onPressStart}
                      loading={checkIn.pending}
                      loadingText={pendingText(checkIn.attempt)}
                      disabled={syncing(checkIn.lastRecord)}
                    >
                      {pk ? "雙方到齊，開始" : "確認進關"}
                    </Button>
                    <ErrorText message={checkIn.error} />
                  </div>
                )}
                {noShowAvailable(focus, now) && (
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="danger"
                      size="lg"
                      block
                      onClick={() => {
                        setNotice(null);
                        setDialog({ kind: "noshow1", key: focusKey });
                      }}
                      loading={noShow.pending}
                      loadingText={pendingText(noShow.attempt)}
                      disabled={syncing(noShow.lastRecord)}
                    >
                      {pk ? "本場未進行" : "本隊未到"}
                    </Button>
                    <ErrorText message={noShow.error} />
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  size="xl"
                  block
                  className="h-24 text-3xl"
                  onClick={() => void onPressCheckOut()}
                  loading={checkOut.pending}
                  loadingText={pendingText(checkOut.attempt)}
                  disabled={syncing(checkOut.lastRecord)}
                >
                  確認出關
                </Button>
                <ErrorText message={checkOut.error} />
              </div>
            )}
          </section>
        )}

        {canOperate && (
          <>
            <ErrorText tone="notice" message={notice} />
            <UndoZone
              items={ownItems}
              realNow={realNow}
              onUndo={onUndo}
              pendingRecordId={undo.pendingRecordId}
              error={undo.error && undoTargetId ? { recordId: undoTargetId, message: undo.error } : null}
              expiredHint={undoExpiredMessage(snapshot.event.leadTitle)}
            />
          </>
        )}

        {next && (
          <div className="flex flex-col gap-1 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3">
            <p className="text-xl font-bold text-slate-900">
              {pk ? "下一組：" : "下一隊："}
              <span className="font-black">{teamsTitle(snapshot, next, " vs ")}</span>{" "}
              <span className="timer-digits">{formatHm(next.slot.scheduledStart)}</span>
            </p>
            {nextReported.map((s) => (
              <p key={s.teamId} className="text-lg font-black text-violet-800">
                {pk ? "下一組" : "下一隊"}
                {nameOfTeam(snapshot, s.teamId)}已到（隊輔回報）
              </p>
            ))}
          </div>
        )}

        {actingAsAdmin && focus && (
          <div className="flex flex-col gap-2">
            <AdminAssignmentActions key={focus.assignment.id} assignment={focus} snapshot={snapshot} now={now} onDone={() => void refetch()} />
          </div>
        )}

        <StationSchedule snapshot={snapshot} assignments={all} focusId={focusId} />
      </>
    );
  }

  // ---- 對話框 ----
  const dialogs =
    ready && focus ? (
      <>
        <ConfirmDialog
          open={activeDialog.kind === "early"}
          title="確認進關"
          description="尚未到時段，確定小隊已經到了？"
          confirmLabel="確定，已經到了"
          tone="warning"
          onConfirm={() => proceedStart({})}
          onCancel={closeDialog}
        >
          <p className="text-lg font-bold text-slate-800">
            本關預期隊伍：<span className="font-black">{teamsTitle(snapshot, focus)}</span>
            <br />
            <span className="timer-digits">
              {slotLabel(focus.slot.number)} {formatHm(focus.slot.scheduledStart)} 開始
            </span>
          </p>
        </ConfirmDialog>

        <ConfirmDialog
          open={activeDialog.kind === "pk"}
          title="雙方到齊，開始"
          description={
            activeDialog.kind === "pk" && activeDialog.early
              ? `尚未到時段（${formatHm(focus.slot.scheduledStart)} 開始），確定兩隊都已經到了？`
              : "請逐一確認兩隊都已到場"
          }
          confirmLabel="開始"
          tone="success"
          checklist={{
            heading: "到場確認",
            items: focus.sides.map((s) => {
              const name = nameOfTeam(snapshot, s.teamId);
              return {
                id: s.teamId,
                label: `${name}已到場`,
                waitingLabel: name,
                defaultChecked: s.teamCheckIn !== null,
                hint: s.teamCheckIn ? `隊輔已回報 ${formatHms(s.teamCheckIn.recordedAt)}` : "隊輔尚未回報到關",
              };
            }),
          }}
          onConfirm={({ checkedIds }) => proceedStart({ confirmedTeamIds: checkedIds })}
          onCancel={closeDialog}
        >
          {actingAsAdmin && (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-red-300 bg-red-50 p-3">
              <p className="text-base font-bold text-red-900">總召專用：某隊確定無法到場（受傷、走失等）時才使用。</p>
              <Button
                variant="secondary"
                size="md"
                block
                onClick={() => {
                  const reported = focus.sides.find((s) => s.teamCheckIn !== null);
                  setDialog({ kind: "single", key: focusKey, teamId: reported?.teamId ?? focus.teamIds[0] ?? null });
                }}
              >
                單隊開始（需填原因）
              </Button>
            </div>
          )}
        </ConfirmDialog>

        <ConfirmDialog
          open={activeDialog.kind === "single"}
          title="單隊開始（總召）"
          description="只有到場的隊伍開始，另一隊視為無法到場。"
          confirmLabel="單隊開始"
          tone="danger"
          reason={{ label: "原因", placeholder: "例：第4小隊有人受傷，無法到場", required: true }}
          onConfirm={({ reason }) => {
            if (activeDialog.kind !== "single") return;
            proceedStart({
              confirmedTeamIds: activeDialog.teamId ? [activeDialog.teamId] : [],
              singleTeamOverride: true,
              reason,
            });
          }}
          onCancel={closeDialog}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-lg font-bold text-slate-900">已到場的隊伍</legend>
            {focus.teamIds.map((id) => {
              const on = activeDialog.kind === "single" && activeDialog.teamId === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDialog((d) => (d.kind === "single" ? { ...d, teamId: id } : d))}
                  className={cn(
                    "flex min-h-14 w-full items-center rounded-xl border-2 px-4 text-left text-xl font-bold",
                    on ? "border-emerald-600 bg-emerald-50 text-emerald-950" : "border-slate-400 bg-white text-slate-900",
                  )}
                >
                  {on ? "● " : "○ "}
                  {nameOfTeam(snapshot, id)}
                </button>
              );
            })}
          </fieldset>
        </ConfirmDialog>

        <ConfirmDialog
          open={activeDialog.kind === "short"}
          title="可玩時間不足"
          description={
            activeDialog.kind === "short" ? `本場只剩 ${formatCountdown(activeDialog.playableMs)}，確定開始？` : undefined
          }
          confirmLabel="確定開始"
          tone="warning"
          onConfirm={() => {
            if (activeDialog.kind === "short") void submitStart(activeDialog.extra);
          }}
          onCancel={closeDialog}
        >
          <p className="text-lg font-bold text-slate-800">
            本時段 {formatHm(focus.slot.scheduledEnd)} 結束。開始後會通知總召，總召可以延長本場時間。
          </p>
        </ConfirmDialog>

        <ConfirmDialog
          open={activeDialog.kind === "noshow1"}
          title={pk ? "本場未進行" : "本隊未到"}
          description={
            pk
              ? `${teamsTitle(snapshot, focus)} 本場沒有進行？`
              : `${teamsTitle(snapshot, focus)} 在本時段（${formatHm(focus.slot.scheduledStart)}–${formatHm(focus.slot.scheduledEnd)}）沒有到關？`
          }
          confirmLabel={pk ? "是，本場未進行" : "是，本隊未到"}
          tone="danger"
          onConfirm={() => setDialog({ kind: "noshow2", key: focusKey })}
          onCancel={closeDialog}
        >
          <ul className="flex flex-col gap-2">
            {focus.sides.map((s) => (
              <li key={s.teamId} className="rounded-xl border-2 border-slate-300 bg-slate-50 px-3 py-2 text-lg font-bold text-slate-900">
                {nameOfTeam(snapshot, s.teamId)}：
                {s.teamCheckIn ? (
                  <span className="text-violet-800">隊輔已回報到場 {formatHms(s.teamCheckIn.recordedAt)}</span>
                ) : (
                  <span className="text-slate-700">沒有到場紀錄</span>
                )}
              </li>
            ))}
          </ul>
        </ConfirmDialog>

        <ConfirmDialog
          open={activeDialog.kind === "noshow2"}
          title="再次確認"
          description={`送出後本場會記為「${pk ? "本場未進行" : "未到"}」，頁面切到下一${pk ? "組" : "隊"}。確定送出？`}
          confirmLabel={pk ? "確定：本場未進行" : "確定：本隊未到"}
          tone="danger"
          onConfirm={() => void onConfirmNoShow()}
          onCancel={closeDialog}
        />
      </>
    ) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <LiveTopBar
        title={gameName}
        subtitle={`${stationCode} ${station?.name ?? stationName}`}
        live={live}
        unreadCount={watcher.unreadCount}
        onOpenNotifications={() => {
          setCenterOpen(true);
          watcher.markAllRead();
        }}
        actingAsAdmin={actingAsAdmin}
      >
        {topChildren}
      </LiveTopBar>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-4">
        <section aria-label="關卡" className="flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-5xl font-black text-white">
            {stationCode}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-600">{gameName}</p>
            <h2 className="break-words text-3xl font-black leading-tight text-slate-950">{station?.name ?? stationName}</h2>
            {derived && <p className="timer-digits text-lg font-bold text-slate-800">{currentSlotText(derived.current)}</p>}
          </div>
        </section>

        {body}
      </main>

      {dialogs}

      <UndoReminderDialog reminder={undo.reminder} onClose={undo.dismissReminder} />
      <NotificationCenter
        open={centerOpen}
        onClose={() => {
          setCenterOpen(false);
          watcher.markAllRead();
        }}
        notifications={watcher.notifications}
      />
    </div>
  );
}

/** 主卡片：本關預期隊伍、狀態、Timer（第十七、十八節） */
function FocusCard({
  snapshot,
  derived,
  focus,
  pk,
}: {
  snapshot: NonNullable<ReturnType<typeof useLiveGame>["snapshot"]>;
  derived: NonNullable<ReturnType<typeof useLiveGame>["derived"]>;
  focus: AssignmentDerived;
  pk: boolean;
}) {
  const game = snapshot.game;
  const original = originalRangeText(focus.slot);
  const ci = focus.stationCheckIn;
  const preStart = ci !== null && focus.untilStartMs !== null && focus.untilStartMs > 0;
  const started = ci !== null && !preStart;

  const caption =
    started && focus.officialEnd !== null ? (
      <div className="flex flex-col items-center gap-0.5">
        {focus.deltaVsScheduledMs !== null && (
          <span className="timer-digits">較預定 {formatSignedDuration(focus.deltaVsScheduledMs)}</span>
        )}
        <span className="timer-digits">
          至 {formatClockSmart(focus.officialEnd)} 結束
          {focus.shortenedMs !== null && game.endPolicy === "FIXED_END" && !focus.endOverride
            ? `（本場縮短 ${formatDuration(focus.shortenedMs)}）`
            : ""}
          {focus.endOverride ? "（總召已調整結束時間）" : ""}
        </span>
      </div>
    ) : undefined;

  return (
    <Card tone={stationStateTone(focus.state)} flagged={focus.tags.length > 0} className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="timer-digits text-xl font-black text-slate-900">{slotRangeText(focus.slot)}</p>
          {original && <p className="timer-digits text-base font-bold text-slate-600">{original}</p>}
        </div>
        <StationStateBadge state={focus.state} size="lg" solid />
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-center text-lg font-bold text-slate-700">本關預期隊伍</p>
        {pk ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            {focus.sides.map((s, i) => (
              <React.Fragment key={s.teamId}>
                {i === 1 && <span className="self-center pt-1 text-2xl font-black text-slate-500">VS</span>}
                <TeamBlock name={nameOfTeam(snapshot, s.teamId)} status={sideStatus(focus, s, derived)} />
              </React.Fragment>
            ))}
          </div>
        ) : (
          focus.sides.map((s) => <TeamBlock key={s.teamId} name={nameOfTeam(snapshot, s.teamId)} status={sideStatus(focus, s, derived)} />)
        )}
      </div>

      {(focus.tags.length > 0 || focus.insufficientTime || focus.singleTeamStart) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {focus.insufficientTime && (
            <span className={cn("inline-flex rounded-lg px-2.5 py-1 text-base font-black", INSUFFICIENT_TIME_CLASS)}>時間不足</span>
          )}
          {focus.singleTeamStart && (
            <span className="inline-flex rounded-lg border-2 border-red-500 bg-red-50 px-2.5 py-1 text-base font-black text-red-800">
              單隊開始（{focus.stationCheckIn?.reason ?? ""}）
            </span>
          )}
          <SecondaryTagChips
            tags={focus.tags.map((t) => (pk ? `${nameOfTeam(snapshot, t.teamId, { short: true })} ${t.label}` : t.label))}
            size="md"
          />
        </div>
      )}

      {preStart && ci && focus.startedAt !== null && (
        <p className="timer-digits text-center text-2xl font-black text-violet-900">
          已進關 {formatHms(ci.recordedAt)}，{formatHm(focus.startedAt)} 開始計時
        </p>
      )}

      {ci && (
        <Timer
          variant="station"
          remainingMs={focus.remainingMs}
          untilStartMs={focus.untilStartMs}
          startAt={focus.startedAt}
          trackKey={focus.assignment.id}
          size="xl"
          caption={caption}
        />
      )}

      {started && ci && (
        <p className="timer-digits text-center text-lg font-bold text-slate-800">關主進關 {formatHms(ci.recordedAt)}</p>
      )}
    </Card>
  );
}
