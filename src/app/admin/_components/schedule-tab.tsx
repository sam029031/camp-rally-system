"use client";
/**
 * 排程調整分頁（第二十四節）：整場延後／提前。
 * - 兩種輸入：「從第 k 時段起延後 N 分鐘」（大按鈕 5／10 分鐘＋自訂；負數 = 提前，要再確認）、
 *   「第 k 時段從 HH:mm 開始」。k 預設 = defaultAdjustFromSlot。
 * - 送出前預覽（受影響時段新舊開始、最後一場新結束、重疊紅字警告要再確認）；原因必填。
 * - 調整紀錄（有效／已撤銷）與「撤銷最近一次調整」。
 * 規則由 server（adjust_schedule / void_last_adjustment RPC）判斷；這裡的提示只是事先說明，server 的錯誤訊息一律顯示在按鈕下方。
 */
import * as React from "react";
import { CalendarClock, Eye, TriangleAlert, Undo2 } from "lucide-react";
import type { AdminAdjustRequest, AdminAdjustResponse, AdminVoidLastAdjustmentRequest } from "@/lib/api/contract";
import { getIndex } from "@/lib/derive";
import { errorMessage } from "@/lib/errors";
import { slotLabel } from "@/lib/labels";
import { defaultAdjustFromSlot, previewAdjustment, slotByNumber, type AdjustmentPreview } from "@/lib/schedule";
import { formatDurationText, formatHm, formatHmRange, formatHms, taipeiLocalToMs } from "@/lib/time";
import type { Adjustment, GameSnapshot } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { pushToast } from "@/lib/client/toast-store";
import { AdminReasonAction, useAdminRequest } from "@/components/admin-actions";
import { ConfirmDialog, type ConfirmChecklistItem } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Section, StatusPill, TableScroll, tdClass, thClass, type ReadyTabProps } from "@/app/admin/_components/a-shared";

type Mode = "DELAY" | "START_AT";

const MAX_MINUTES = 360;
const REASON_CHIPS = ["前一時段整體延誤", "用餐／集合延誤", "天氣因素", "彩排測試"];
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 「延後 10 分鐘」「提前 5 分鐘」 */
function offsetText(offsetMs: number): string {
  return `${offsetMs >= 0 ? "延後" : "提前"} ${formatDurationText(offsetMs)}`;
}

/** 目前有效 station_check_in 所在的最大時段編號（0 = 沒有） */
function maxSlotWithCheckIn(snapshot: GameSnapshot): number {
  const idx = getIndex(snapshot);
  let max = 0;
  for (const [assignmentId, rec] of idx.records) {
    if (!rec.stationCheckIn) continue;
    const a = idx.assignmentById.get(assignmentId);
    const slot = a ? idx.slotById.get(a.slotId) : undefined;
    if (slot && slot.number > max) max = slot.number;
  }
  return max;
}

export function ScheduleTab(props: ReadyTabProps) {
  const { snapshot, live } = props;
  const now = live.now;
  const game = snapshot.game;

  const [mode, setMode] = React.useState<Mode>("DELAY");
  const [fromChoice, setFromChoice] = React.useState<number | null>(null);
  const [minutesText, setMinutesText] = React.useState("");
  const [startAtText, setStartAtText] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const req = useAdminRequest<AdminAdjustResponse>();
  const ids = { from: React.useId(), minutes: React.useId(), startAt: React.useId(), reason: React.useId() };

  const defaultK = defaultAdjustFromSlot(snapshot, now);
  const k = fromChoice ?? defaultK ?? snapshot.slots[0]?.number ?? 1;
  const slotK = slotByNumber(snapshot.slots, k);
  const checkInMax = maxSlotWithCheckIn(snapshot);

  // ---- 換算 offset ----
  let offsetMs: number | null = null;
  let inputError: string | null = null;
  if (mode === "DELAY") {
    const t = minutesText.trim();
    if (t !== "") {
      const n = Number(t);
      if (!Number.isInteger(n)) inputError = "分鐘數請輸入整數（負數代表提前）。";
      else if (n === 0) inputError = "分鐘數不能是 0。";
      else if (Math.abs(n) > MAX_MINUTES) inputError = `一次最多調整 ${MAX_MINUTES} 分鐘。`;
      else offsetMs = n * 60_000;
    }
  } else if (slotK) {
    const t = startAtText.trim();
    if (t !== "") {
      if (!HHMM_RE.test(t)) inputError = "請輸入開始時間（HH:mm）。";
      else {
        try {
          const target = taipeiLocalToMs(snapshot.event.eventDate, t);
          const diff = target - slotK.scheduledStart;
          if (diff === 0) inputError = `${slotLabel(k)}目前就是 ${formatHm(slotK.scheduledStart)} 開始，不需要調整。`;
          else if (Math.abs(diff) > MAX_MINUTES * 60_000) inputError = `一次最多調整 ${MAX_MINUTES} 分鐘。`;
          else offsetMs = diff;
        } catch {
          inputError = "開始時間格式不正確（HH:mm）。";
        }
      }
    }
  }

  const preview: AdjustmentPreview | null = offsetMs !== null && slotK ? previewAdjustment(snapshot.slots, k, offsetMs) : null;
  const newStartK = slotK && offsetMs !== null ? slotK.scheduledStart + offsetMs : null;

  // ---- 事先提示（server 仍會再判斷） ----
  const warnings: string[] = [];
  if (slotK && slotK.scheduledStart <= now) warnings.push(`${slotLabel(k)}已經開始（${formatHm(slotK.scheduledStart)}）：${errorMessage("ADJUST_SLOT_STARTED")}`);
  else if (checkInMax >= k) warnings.push(`${slotLabel(checkInMax)}已有關主進關紀錄：${errorMessage("ADJUST_SLOT_HAS_CHECKINS")}`);
  else if (newStartK !== null && newStartK <= now) warnings.push(`調整後 ${slotLabel(k)} ${formatHm(newStartK)} 開始已經過去：${errorMessage("ADJUST_RESULT_IN_PAST")}`);

  const negative = offsetMs !== null && offsetMs < 0;
  const summary =
    offsetMs !== null && newStartK !== null
      ? mode === "DELAY"
        ? `${game.name} ${slotLabel(k)}起${offsetText(offsetMs)}，${slotLabel(k)}改為 ${formatHm(newStartK)} 開始`
        : `${game.name} ${slotLabel(k)}從 ${formatHm(newStartK)} 開始（${offsetText(offsetMs)}）`
      : null;

  const reasonOk = reason.trim().length > 0;
  const canPreview = offsetMs !== null && !!slotK && reasonOk && !req.pending;

  const checklist: ConfirmChecklistItem[] = [];
  if (negative && offsetMs !== null) {
    checklist.push({ id: "negative", label: `我確定要「提前」${formatDurationText(offsetMs)}（不是延後）` });
  }
  if (preview?.overlapWarning) {
    checklist.push({ id: "overlap", label: "我了解調整後時段會與前一時段重疊，仍要送出" });
  }

  const resetForm = () => {
    setFromChoice(null);
    setMinutesText("");
    setStartAtText("");
    setReason("");
  };

  const submit = async () => {
    if (offsetMs === null || !slotK) return;
    const body: AdminAdjustRequest =
      mode === "DELAY"
        ? { gameId: game.id, fromSlotNumber: k, mode, offsetMinutes: Math.round(offsetMs / 60_000), reason: reason.trim() }
        : { gameId: game.id, fromSlotNumber: k, mode, startAt: startAtText.trim(), reason: reason.trim() };
    const r = await req.run("/api/admin/schedule/adjust", body);
    if (!r) return;
    setConfirmOpen(false);
    pushToast({ tone: "success", title: "已調整排程", body: summary });
    resetForm();
    void live.refetch();
  };

  const slotOptions = snapshot.slots.map((s) => {
    const started = s.scheduledStart <= now;
    const tag = s.number === defaultK ? "（預設）" : started ? "（已開始）" : s.number <= checkInMax ? "（已有進關）" : "";
    return { value: String(s.number), label: `${slotLabel(s.number)} ${formatHm(s.scheduledStart)} 開始${tag}` };
  });

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={`${game.name}：整場延後／提前`}
        description="只能從尚未開始、且之後沒有關主進關紀錄的時段起調整。原定時間不覆寫，可以撤銷；每次調整都會發出全場通知。"
        aside={<CalendarClock className="size-8 text-slate-500" aria-hidden />}
      >
        <Tabs
          items={[
            { value: "DELAY", label: "延後 N 分鐘" },
            { value: "START_AT", label: "指定開始時間" },
          ]}
          value={mode}
          onValueChange={(v) => {
            setMode(v);
            req.reset();
          }}
          ariaLabel="輸入方式"
          size="lg"
        />

        <Field
          label="從第幾時段起"
          htmlFor={ids.from}
          required
          hint={
            defaultK !== null
              ? `預設 ${slotLabel(defaultK)}：第一個尚未開始、且該時段及之後沒有關主進關紀錄的時段。`
              : "目前沒有可以調整的時段（所有時段都已開始或已有關主進關紀錄）。"
          }
        >
          <Select
            id={ids.from}
            value={String(k)}
            options={slotOptions}
            onChange={(e) => {
              setFromChoice(Number(e.target.value));
              req.reset();
            }}
            disabled={req.pending}
          />
        </Field>

        {mode === "DELAY" ? (
          <div className="flex flex-col gap-3">
            <p className="text-lg font-black text-slate-950">從{slotLabel(k)}起延後</p>
            <div className="grid grid-cols-2 gap-3">
              {[5, 10].map((n) => {
                const active = minutesText.trim() === String(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={active}
                    disabled={req.pending}
                    onClick={() => {
                      setMinutesText(String(n));
                      req.reset();
                    }}
                    className={cn(
                      "flex h-20 items-center justify-center rounded-xl border-2 text-2xl font-black",
                      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                      active ? "border-blue-800 bg-blue-700 text-white" : "border-slate-400 bg-white text-slate-950",
                    )}
                  >
                    延後 {n} 分鐘
                  </button>
                );
              })}
            </div>
            <Field
              label="自訂分鐘數"
              htmlFor={ids.minutes}
              hint="輸入負數代表提前（例如 -5 = 提前 5 分鐘），送出前會再確認一次。"
              error={inputError ?? undefined}
            >
              <Input
                id={ids.minutes}
                type="text"
                inputMode="numeric"
                pattern="-?[0-9]*"
                placeholder="例如 15 或 -5"
                value={minutesText}
                onChange={(e) => {
                  setMinutesText(e.target.value.replace(/[^0-9-]/g, ""));
                  req.reset();
                }}
                disabled={req.pending}
                className="max-w-56 text-2xl font-black"
              />
            </Field>
          </div>
        ) : (
          <Field
            label={`${slotLabel(k)}改從幾點開始（活動日 ${snapshot.event.eventDate}）`}
            htmlFor={ids.startAt}
            required
            hint={
              slotK
                ? `${slotLabel(k)}目前 ${formatHmRange(slotK.scheduledStart, slotK.scheduledEnd)}。其後時段維持「關卡時間＋跑關間隔」一起平移；選第1時段就是「整場從 HH:mm 開始」。`
                : undefined
            }
            error={inputError ?? undefined}
          >
            <Input
              id={ids.startAt}
              type="time"
              step={60}
              value={startAtText}
              onChange={(e) => {
                setStartAtText(e.target.value.slice(0, 5));
                req.reset();
              }}
              disabled={req.pending}
              className="max-w-56 text-2xl font-black"
            />
          </Field>
        )}

        {preview && slotK && offsetMs !== null && (
          <PreviewTable preview={preview} fromSlotNumber={k} offsetMs={offsetMs} summary={summary} />
        )}

        {warnings.length > 0 && (
          <div role="status" className="flex items-start gap-2 rounded-xl border-2 border-orange-500 bg-orange-50 p-3 text-base font-bold text-orange-950">
            <TriangleAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
            <div>
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              <p className="mt-1 text-sm text-orange-900">送出後 server 會依目前資料再判斷一次。</p>
            </div>
          </div>
        )}

        <Field label="原因" htmlFor={ids.reason} required>
          <Textarea
            id={ids.reason}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            rows={2}
            disabled={req.pending}
            placeholder="例如：午餐延誤，整體延後"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {REASON_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setReason(chip)}
              disabled={req.pending}
              className="h-11 rounded-lg border-2 border-slate-400 bg-white px-3 text-base font-bold text-slate-800 hover:bg-slate-100"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant={negative ? "warning" : "primary"}
            size="xl"
            block
            disabled={!canPreview}
            onClick={() => {
              req.reset();
              setConfirmOpen(true);
            }}
          >
            <Eye className="size-7" aria-hidden />
            {offsetMs !== null ? `確認${negative ? "提前" : "延後"}並送出` : "確認並送出"}
          </Button>
          <ErrorText message={!confirmOpen ? req.error : null} />
          {!canPreview && !req.pending && (
            <p className="text-base font-bold text-slate-600">
              {offsetMs === null ? (mode === "DELAY" ? "請選擇延後分鐘數。" : "請輸入新的開始時間。") : !reasonOk ? "請填寫原因後送出。" : null}
            </p>
          )}
        </div>
      </Section>

      <ConfirmDialog
        open={confirmOpen}
        title={negative ? "確認提前排程" : "確認延後排程"}
        description={summary}
        confirmLabel={negative ? "確定提前" : "確定延後"}
        tone={negative || preview?.overlapWarning ? "danger" : "primary"}
        pending={req.pending}
        error={req.error}
        checklist={checklist.length > 0 ? { items: checklist, waitingHint: () => "請勾選上面的確認項目" } : undefined}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      >
        {preview && offsetMs !== null && <PreviewTable preview={preview} fromSlotNumber={k} offsetMs={offsetMs} summary={null} compact />}
        <p className="text-base font-bold text-slate-700">原因：{reason.trim()}</p>
        <p className="text-base font-bold text-slate-700">送出後所有裝置立即更新並收到全場通知；之後可以撤銷這次調整。</p>
      </ConfirmDialog>

      <AdjustmentsList snapshot={snapshot} now={now} onDone={() => void live.refetch()} />
    </div>
  );
}

// =====================================================================
// 預覽
// =====================================================================

function PreviewTable({
  preview,
  fromSlotNumber,
  offsetMs,
  summary,
  compact = false,
}: {
  preview: AdjustmentPreview;
  fromSlotNumber: number;
  offsetMs: number;
  summary: string | null;
  compact?: boolean;
}) {
  const affected = preview.rows.filter((r) => r.affected);
  const lastOld = preview.rows.length > 0 ? preview.rows[preview.rows.length - 1].oldEnd : null;
  // 重疊：第一個「新開始 < 前一時段新結束」的時段
  let overlapSlot: number | null = null;
  for (let i = 1; i < preview.rows.length; i++) {
    if (preview.rows[i].newStart < preview.rows[i - 1].newEnd) {
      overlapSlot = preview.rows[i].slotNumber;
      break;
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-blue-600 bg-blue-50 p-3">
      {summary && <p className="text-lg font-black text-blue-950">預覽：{summary}</p>}
      <TableScroll>
        <table className="w-full min-w-[20rem] border-collapse bg-white">
          <thead>
            <tr>
              <th className={thClass}>時段</th>
              <th className={thClass}>目前開始</th>
              <th className={thClass}>調整後開始</th>
            </tr>
          </thead>
          <tbody>
            {(compact ? affected : preview.rows).map((r) => (
              <tr key={r.slotNumber} className={r.affected ? "bg-yellow-50" : "text-slate-500"}>
                <td className={cn(tdClass, "font-black whitespace-nowrap")}>{slotLabel(r.slotNumber)}</td>
                <td className={cn(tdClass, "timer-digits whitespace-nowrap")}>{formatHmRange(r.oldStart, r.oldEnd)}</td>
                <td className={cn(tdClass, "timer-digits whitespace-nowrap", r.affected && "font-black text-blue-900")}>
                  {r.affected ? `→ ${formatHmRange(r.newStart, r.newEnd)}` : "不變"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="text-base font-bold text-slate-900">
        受影響：{slotLabel(fromSlotNumber)}起共 {affected.length} 個時段（{offsetText(offsetMs)}）。最後一場結束：
        {lastOld !== null && <span className="timer-digits text-slate-600"> {formatHm(lastOld)} →</span>}
        <span className="timer-digits font-black text-blue-900"> {formatHm(preview.newLastEnd)}</span>
      </p>
      {preview.overlapWarning && (
        <p role="alert" className="flex items-start gap-2 text-lg font-black text-red-700">
          <TriangleAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
          警告：提前後{overlapSlot !== null ? `${slotLabel(overlapSlot)}` : "時段"}會與前一時段重疊（前一場還沒結束就要開始），送出前需要再確認。
        </p>
      )}
    </div>
  );
}

// =====================================================================
// 調整紀錄與撤銷
// =====================================================================

function inputModeText(a: Adjustment): string {
  return a.inputMode === "START_AT" ? "指定開始時間" : "延後 N 分鐘";
}

function AdjustmentsList({ snapshot, now, onDone }: { snapshot: GameSnapshot; now: number; onDone: () => void }) {
  const list = [...snapshot.adjustments].sort((a, b) => b.createdAt - a.createdAt);
  const active = list.filter((a) => a.voidedAt === null);
  const latest = active[0] ?? null;

  let voidPreview: string | null = null;
  let voidWarning: string | null = null;
  if (latest) {
    const slot = slotByNumber(snapshot.slots, latest.fromSlotNumber);
    if (slot) {
      const restored = slot.scheduledStart - latest.offsetMs;
      voidPreview = `撤銷後${slotLabel(latest.fromSlotNumber)}改回 ${formatHm(restored)} 開始（目前 ${formatHm(slot.scheduledStart)}），其後時段一起平移。`;
      if (slot.scheduledStart <= now || restored <= now) voidWarning = `${slotLabel(latest.fromSlotNumber)}已經開始或撤銷後的時間已過去，server 會拒絕撤銷。`;
      else if (maxSlotWithCheckIn(snapshot) >= latest.fromSlotNumber) voidWarning = "受影響的時段已有關主進關紀錄，server 會拒絕撤銷。";
    }
  }

  return (
    <Section
      title="調整紀錄"
      description="有效的調整會加總到時段時間；撤銷只能從最近一次開始，且受影響的時段都必須還沒開始。"
      aside={
        latest ? (
          <AdminReasonAction
            label="撤銷最近一次調整"
            icon={<Undo2 className="size-6" aria-hidden />}
            variant="warning"
            size="md"
            title="撤銷最近一次調整"
            description={`撤銷「${slotLabel(latest.fromSlotNumber)}起${offsetText(latest.offsetMs)}」（原因：${latest.reason}）？`}
            confirmLabel="確定撤銷調整"
            tone="warning"
            url="/api/admin/schedule/void-last"
            buildBody={(r) => ({ gameId: snapshot.game.id, reason: r }) satisfies AdminVoidLastAdjustmentRequest}
            successMessage="已撤銷最近一次調整"
            reasonPlaceholder="例如：延誤已排除、設定錯誤"
            onDone={onDone}
          >
            {voidPreview && <p className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-base font-bold text-slate-900">{voidPreview}</p>}
            {voidWarning && <p className="text-base font-bold text-orange-800">{voidWarning}</p>}
            <p className="text-base font-bold text-slate-700">撤銷後所有裝置立即更新並收到撤銷通知。</p>
          </AdminReasonAction>
        ) : null
      }
    >
      {list.length === 0 ? (
        <p className="text-lg font-bold text-slate-600">目前沒有任何排程調整。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((a) => {
            const isActive = a.voidedAt === null;
            return (
              <li
                key={a.id}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border-2 p-3",
                  isActive ? "border-orange-500 bg-orange-50" : "border-slate-300 bg-slate-50 text-slate-600",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill active={isActive} />
                  <span className={cn("text-lg font-black", !isActive && "line-through")}>
                    {slotLabel(a.fromSlotNumber)}起{offsetText(a.offsetMs)}
                  </span>
                  {a.id === latest?.id && <span className="text-sm font-black text-orange-800">（最近一次）</span>}
                </div>
                <p className="text-base font-bold">
                  <span className="timer-digits">{formatHms(a.createdAt)}</span>・{inputModeText(a)}・原因：{a.reason}
                </p>
                {!isActive && (
                  <p className="text-base font-bold">
                    已撤銷{a.voidedAt !== null && <span className="timer-digits">（{formatHms(a.voidedAt)}）</span>}
                    {a.voidReason && `：${a.voidReason}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
