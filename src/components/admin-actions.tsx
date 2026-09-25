"use client";
/**
 * 總召快捷操作（延長／取消／強制結束）。Dashboard、關主頁、通知中心、/admin 共用。
 * 合約：props 不可改名，可新增 optional props。
 *
 * 規則（第八、二十二、二十四之二、二十九節）：
 * - 每個操作都要填原因、並經過確認對話框；危險動作（取消、強制結束）用紅色。
 * - 管理類 POST 一律「不自動重試」（postApi 預設 retry = false），失敗訊息直接顯示在按鈕下方。
 * - 成功後呼叫 onDone（通常是 refetch）；Realtime 也會讓所有裝置更新。
 */
import * as React from "react";
import { Ban, CircleStop, Clock, Ellipsis, ShieldAlert, TimerReset, Undo2 } from "lucide-react";
import type {
  AdminCancelRequest,
  AdminEndOverrideRequest,
  AdminEndOverrideResponse,
  AdminForceEndRequest,
  AdminSimpleResponse,
  AdminVoidCancellationRequest,
  AdminVoidEndOverrideRequest,
} from "@/lib/api/contract";
import { getIndex } from "@/lib/derive";
import type { AssignmentDerived } from "@/lib/derive/types";
import { errorMessage, type ErrorCode } from "@/lib/errors";
import { INSUFFICIENT_TIME_CLASS, slotLabel, teamName } from "@/lib/labels";
import { formatCountdown, formatDuration, formatDurationText, formatHm, formatHmRange, formatHms, msToTaipeiTimeInput, taipeiLocalToMs } from "@/lib/time";
import type { GameSnapshot } from "@/lib/types";
import { postApi } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { pushToast } from "@/lib/client/toast-store";
import { ConfirmDialog, type ConfirmChecklistItem } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// =====================================================================
// 共用：管理類請求（不重試）
// =====================================================================

type OkOf<T> = Extract<T, { ok: true }>;

export interface AdminRequestState<T extends { ok: boolean }> {
  /** 送出；成功回傳 server 的結果，失敗回 null（錯誤訊息放在 error） */
  run: (url: string, body: unknown) => Promise<OkOf<T> | null>;
  pending: boolean;
  /** 失敗時的中文訊息（server 的 message，或 error code 對應的提示） */
  error: string | null;
  errorCode: ErrorCode | null;
  reset: () => void;
}

/**
 * 管理類 POST（第二十八節：管理操作不自動重試，避免重複延後／取消）。
 * 同一個 hook 同時只允許一個請求（按鈕送出後立即 pending）。
 */
export function useAdminRequest<T extends { ok: boolean }>(): AdminRequestState<T> {
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<{ code: ErrorCode; message: string } | null>(null);
  const inflight = React.useRef(false);

  const run = React.useCallback(async (url: string, body: unknown): Promise<OkOf<T> | null> => {
    if (inflight.current) return null;
    inflight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const res = await postApi<T>(url, body, { retry: false });
      if (res.ok) return res as OkOf<T>;
      const err = res as unknown as { code: ErrorCode; message?: string | null };
      setFailure({ code: err.code, message: err.message?.trim() ? err.message : errorMessage(err.code) });
      return null;
    } finally {
      inflight.current = false;
      setPending(false);
    }
  }, []);

  const reset = React.useCallback(() => setFailure(null), []);

  return { run, pending, error: failure?.message ?? null, errorCode: failure?.code ?? null, reset };
}

// =====================================================================
// 共用：場次描述
// =====================================================================

/** 場次的隊伍文字：「第2小隊」／「第2隊 vs 第4隊」 */
export function assignmentTeamsText(snapshot: GameSnapshot, ad: Pick<AssignmentDerived, "teamIds">): string {
  const { teamById } = getIndex(snapshot);
  const pk = ad.teamIds.length > 1;
  return ad.teamIds
    .map((id) => {
      const t = teamById.get(id);
      return t ? teamName(t, { short: pk }) : "（未知隊伍）";
    })
    .join(" vs ");
}

/** 場次標題：「A 九九乘法・第2時段 09:32–09:47」 */
export function assignmentTitle(ad: Pick<AssignmentDerived, "station" | "slot">): string {
  return `${ad.station.code} ${ad.station.name}・${slotLabel(ad.slot.number)} ${formatHmRange(ad.slot.scheduledStart, ad.slot.scheduledEnd)}`;
}

// =====================================================================
// 共用：填原因＋確認的操作
// =====================================================================

export interface ReasonConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: React.ReactNode;
  tone?: "primary" | "success" | "danger" | "warning";
  /** POST 的 route */
  url: string;
  /** 由原因組出 request body */
  buildBody: (reason: string) => unknown;
  /** 成功時的 Toast 標題 */
  successMessage: string;
  reasonPlaceholder?: string;
  /** 額外必勾的確認項目（例如提前排程） */
  checklist?: ReadonlyArray<ConfirmChecklistItem>;
  onDone?: () => void;
}

/** 必填原因的確認對話框：送出 → 成功 Toast → 關閉 → onDone。失敗訊息顯示在確認按鈕上方，不重試。 */
export function ReasonConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  tone = "primary",
  url,
  buildBody,
  successMessage,
  reasonPlaceholder,
  checklist,
  onDone,
}: ReasonConfirmDialogProps) {
  const req = useAdminRequest<AdminSimpleResponse>();
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
      pending={req.pending}
      error={req.error}
      checklist={checklist && checklist.length > 0 ? { items: checklist, waitingHint: () => "請勾選上面的確認項目" } : undefined}
      reason={{ label: "原因", required: true, placeholder: reasonPlaceholder ?? "請簡短說明原因" }}
      onConfirm={async ({ reason }) => {
        const r = await req.run(url, buildBody(reason));
        if (!r) return;
        pushToast({ tone: "success", title: successMessage });
        onClose();
        onDone?.();
      }}
      onCancel={() => {
        req.reset();
        onClose();
      }}
    >
      {children}
    </ConfirmDialog>
  );
}

export interface AdminReasonActionProps extends Omit<ReasonConfirmDialogProps, "open" | "onClose"> {
  /** 觸發按鈕文字 */
  label: React.ReactNode;
  icon?: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  block?: boolean;
  disabled?: boolean;
  className?: string;
}

/** 一個按鈕＋必填原因的確認對話框（撤銷取消、撤銷延長等清單列上的操作）。 */
export function AdminReasonAction({ label, icon, variant = "secondary", size = "md", block, disabled, className, ...dialog }: AdminReasonActionProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} size={size} block={block} disabled={disabled} className={className} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      <ReasonConfirmDialog {...dialog} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// =====================================================================
// 可用的總召操作
// =====================================================================

type AdminOp = "extend" | "voidOverride" | "forceEnd" | "cancelOne" | "cancelFollowing" | "voidCancel";

interface OpInfo {
  op: AdminOp;
  label: string;
  hint?: string;
  variant: NonNullable<ButtonProps["variant"]>;
  icon: React.ReactNode;
}

/** 該關從本時段起「可以取消」的場次（未取消、關主未出關；依時段），與 /api/admin/cancellations 的選取規則一致 */
function followingCancellable(snapshot: GameSnapshot, ad: AssignmentDerived): Array<{ id: string; slotNumber: number; inProgress: boolean }> {
  const idx = getIndex(snapshot);
  const list = idx.byStation.get(ad.station.id) ?? [];
  const out: Array<{ id: string; slotNumber: number; inProgress: boolean }> = [];
  for (const a of list) {
    const slot = idx.slotById.get(a.slotId);
    if (!slot || slot.number < ad.slot.number) continue;
    if (idx.cancellation.has(a.id)) continue;
    const rec = idx.records.get(a.id);
    if (rec?.stationCheckOut) continue;
    out.push({ id: a.id, slotNumber: slot.number, inProgress: !!rec?.stationCheckIn });
  }
  return out;
}

function computeOps(snapshot: GameSnapshot, ad: AssignmentDerived, now: number): OpInfo[] {
  const ops: OpInfo[] = [];
  if (ad.state === "CANCELLED" || ad.cancellation) {
    ops.push({ op: "voidCancel", label: "撤銷取消", hint: "恢復本場，隊伍照原路線前往", variant: "secondary", icon: <Undo2 className="size-6" aria-hidden /> });
    return ops;
  }
  const started = ad.stationCheckIn !== null;
  const checkedOut = ad.stationCheckOut !== null;
  const inProgress = started && !checkedOut;
  const fixedEndExpired = !started && snapshot.game.endPolicy === "FIXED_END" && now >= ad.slot.scheduledEnd;

  if (inProgress || (!checkedOut && (fixedEndExpired || ad.endOverride !== null))) {
    ops.push({
      op: "extend",
      label: ad.endOverride ? "修改延長" : "延長時間",
      hint: inProgress ? "+5 分／+10 分／補足完整時間／指定結束時間" : "時段已結束，延長後關主才能開始",
      variant: "primary",
      icon: <TimerReset className="size-6" aria-hidden />,
    });
  }
  if (ad.endOverride && !checkedOut) {
    ops.push({ op: "voidOverride", label: "撤銷延長", hint: `目前延長至 ${formatHms(ad.endOverride.officialEnd)}`, variant: "secondary", icon: <Undo2 className="size-6" aria-hidden /> });
  }
  if (inProgress) {
    ops.push({ op: "forceEnd", label: "強制結束", hint: "以現在時間新增一筆出關紀錄", variant: "danger", icon: <CircleStop className="size-6" aria-hidden /> });
  }
  if (!started) {
    ops.push({ op: "cancelOne", label: "取消本場", hint: "只取消這一個時段", variant: "danger", icon: <Ban className="size-6" aria-hidden /> });
  }
  if (!inProgress) {
    const following = followingCancellable(snapshot, ad);
    const count = following.length;
    if (count >= 2 || (checkedOut && count >= 1)) {
      ops.push({
        op: "cancelFollowing",
        label: "取消本關接下來所有時段",
        hint: `共 ${count} 場（${following.map((f) => f.slotNumber).join("、")} 時段）`,
        variant: "danger",
        icon: <Ban className="size-6" aria-hidden />,
      });
    }
  }
  return ops;
}

// =====================================================================
// AdminAssignmentActions
// =====================================================================

export interface AdminAssignmentActionsProps {
  assignment: AssignmentDerived;
  snapshot: GameSnapshot;
  /** 目前 app 時間（決定可用的操作與預設延長時間） */
  now: number;
  /** 成功後（通常是 refetch） */
  onDone?: () => void;
  /** 精簡模式（Dashboard 卡片內：只顯示「⋯ 總召操作」按鈕，展開後才看到各操作） */
  compact?: boolean;
  /** 精簡模式按鈕的額外 class */
  className?: string;
}

/**
 * 依 assignment 狀態顯示可用的總召操作（每個都需要填原因、二次確認）：
 * - 延長（end override）：+5 分／+10 分／補足完整時間／指定結束時間（已進關、或 FIXED_END 時段已結束尚未開始時）
 * - 取消本場／取消本關接下來所有時段（未進行中時）；已取消 → 撤銷取消
 * - 強制結束（進行中時，admin_force 的 station_check_out）
 * - 已有有效延長 → 撤銷延長
 */
export function AdminAssignmentActions({ assignment: ad, snapshot, now, onDone, compact = false, className }: AdminAssignmentActionsProps): React.ReactNode {
  const assignmentId = ad.assignment.id;
  // 開啟的操作綁定「開啟當下」的場次 id（第二十四之二節：取消／延長／強制結束的對象不可以被換掉）。
  // Realtime 更新讓同一個元件收到另一個場次時（呼叫端應加 key，這裡是第二道防線），已開的對話框直接關閉，不會改送到別的場次。
  const [sheet, setSheet] = React.useState<{ assignmentId: string } | null>(null);
  const [active, setActive] = React.useState<{ op: AdminOp; assignmentId: string } | null>(null);
  if (active !== null && active.assignmentId !== assignmentId) setActive(null);
  if (sheet !== null && sheet.assignmentId !== assignmentId) setSheet(null);
  const activeOp = active !== null && active.assignmentId === assignmentId ? active.op : null;
  const sheetOpen = sheet !== null && sheet.assignmentId === assignmentId;
  const setSheetOpen = (open: boolean) => setSheet(open ? { assignmentId } : null);
  const closeOp = () => setActive(null);
  const ops = computeOps(snapshot, ad, now);
  const override = ad.endOverride;
  const cancellation = ad.cancellation;
  const title = assignmentTitle(ad);
  const teams = assignmentTeamsText(snapshot, ad);

  const choose = (op: AdminOp) => {
    setSheetOpen(false);
    setActive({ op, assignmentId });
  };

  const opButtons = (
    <div className="flex flex-col gap-3">
      {ops.map((o) => (
        <Button key={o.op} variant={o.variant} size="lg" block className="h-auto min-h-16 justify-start py-2 text-left" onClick={() => choose(o.op)}>
          {o.icon}
          <span className="flex min-w-0 flex-col">
            <span>{o.label}</span>
            {o.hint && <span className="text-sm font-bold opacity-85">{o.hint}</span>}
          </span>
        </Button>
      ))}
    </div>
  );

  if (compact && ops.length === 0) return null;

  return (
    <>
      {compact ? (
        <>
          <Button variant="secondary" size="md" className={cn("border-red-600 text-red-800", className)} onClick={() => setSheetOpen(true)}>
            <Ellipsis className="size-6" aria-hidden />
            總召操作
          </Button>
          <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} placement="bottom" title="總召操作" description={`${title}・${teams}`}>
            <div className="mx-auto w-full max-w-xl">{opButtons}</div>
          </Dialog>
        </>
      ) : ops.length === 0 ? (
        <p className="text-base font-bold text-slate-600">本場目前沒有可用的總召操作。</p>
      ) : (
        opButtons
      )}

      <ExtendDialog
        open={activeOp === "extend"}
        onOpenChange={(o) => setActive(o ? { op: "extend", assignmentId } : null)}
        assignment={ad}
        snapshot={snapshot}
        now={now}
        onDone={onDone}
      />

      {override && (
        <ReasonConfirmDialog
          open={activeOp === "voidOverride"}
          onClose={closeOp}
          title="撤銷延長"
          description={`${title}・${teams}：撤銷「延長至 ${formatHms(override.officialEnd)}」，結束時間回到依遊戲規則計算的時間。`}
          confirmLabel="確定撤銷延長"
          url="/api/admin/end-override/void"
          buildBody={(reason) => ({ overrideId: override.id, reason }) satisfies AdminVoidEndOverrideRequest}
          successMessage="已撤銷延長"
          onDone={onDone}
        />
      )}

      <ReasonConfirmDialog
        open={activeOp === "forceEnd"}
        onClose={closeOp}
        title="強制結束"
        description={`${title}・${teams}：以現在時間新增一筆「強制結束」的出關紀錄？`}
        confirmLabel="確定強制結束"
        tone="danger"
        url="/api/admin/force-end"
        buildBody={(reason) => ({ assignmentId: ad.assignment.id, reason }) satisfies AdminForceEndRequest}
        successMessage={`已強制結束 ${ad.station.name}`}
        reasonPlaceholder="例如：關主手機沒電，由總召結束"
        onDone={onDone}
      >
        <ForceEndNote ad={ad} now={now} />
      </ReasonConfirmDialog>

      <ReasonConfirmDialog
        open={activeOp === "cancelOne"}
        onClose={closeOp}
        title="取消本場"
        description={`取消 ${title}・${teams}？`}
        confirmLabel="確定取消本場"
        tone="danger"
        url="/api/admin/cancellations"
        buildBody={(reason) => ({ assignmentIds: [ad.assignment.id], reason }) satisfies AdminCancelRequest}
        successMessage={`已取消 ${ad.station.name} ${slotLabel(ad.slot.number)}`}
        reasonPlaceholder="例如：下雨停辦、道具損壞"
        onDone={onDone}
      >
        <CancelNote />
      </ReasonConfirmDialog>

      <ReasonConfirmDialog
        open={activeOp === "cancelFollowing"}
        onClose={closeOp}
        title="取消本關接下來所有時段"
        description={`取消 ${ad.station.code} ${ad.station.name} ${slotLabel(ad.slot.number)}起所有尚未進行的場次？`}
        confirmLabel="確定全部取消"
        tone="danger"
        url="/api/admin/cancellations"
        buildBody={(reason) => ({ stationId: ad.station.id, fromSlotNumber: ad.slot.number, reason }) satisfies AdminCancelRequest}
        successMessage={`已取消 ${ad.station.name} ${slotLabel(ad.slot.number)}起的場次`}
        reasonPlaceholder="例如：下雨，水關停辦"
        onDone={onDone}
      >
        <FollowingList snapshot={snapshot} ad={ad} />
        <CancelNote />
      </ReasonConfirmDialog>

      {cancellation && (
        <ReasonConfirmDialog
          open={activeOp === "voidCancel"}
          onClose={closeOp}
          title="撤銷取消"
          description={`恢復 ${title}・${teams}？（原取消原因：${cancellation.reason}）`}
          confirmLabel="確定撤銷取消"
          url="/api/admin/cancellations/void"
          buildBody={(reason) => ({ cancellationId: cancellation.id, reason }) satisfies AdminVoidCancellationRequest}
          successMessage="已撤銷取消"
          onDone={onDone}
        />
      )}
    </>
  );
}

function CancelNote() {
  return (
    <p className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-base font-bold text-slate-800">
      被取消的場次顯示「已取消」、拒絕任何打卡；相關隊伍直接前往再下一個場次。會發出全場通知。取消之後可以撤銷。
    </p>
  );
}

function FollowingList({ snapshot, ad }: { snapshot: GameSnapshot; ad: AssignmentDerived }) {
  const list = followingCancellable(snapshot, ad);
  const idx = getIndex(snapshot);
  if (list.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-base font-bold text-red-950">
      {list.map((f) => {
        const a = idx.assignmentById.get(f.id);
        const pk = !!a?.teamBId;
        const names = a
          ? [a.teamAId, a.teamBId]
              .filter((x): x is string => !!x)
              .map((id) => {
                const t = idx.teamById.get(id);
                return t ? teamName(t, { short: pk }) : "";
              })
              .join(" vs ")
          : "";
        return (
          <li key={f.id}>
            {slotLabel(f.slotNumber)}　{names}
            {f.inProgress && <span className="ml-2 text-red-700">（進行中，需先出關）</span>}
          </li>
        );
      })}
    </ul>
  );
}

function ForceEndNote({ ad, now }: { ad: AssignmentDerived; now: number }) {
  return (
    <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-base font-bold text-slate-800">
      {ad.startedAt !== null && <p>開始計時：{formatHms(ad.startedAt)}</p>}
      {ad.officialEnd !== null && (
        <p>
          正式結束：{formatHms(ad.officialEnd)}
          {ad.remainingMs !== null && ad.remainingMs < 0 && <span className="ml-2 text-red-700">（已超時 {formatCountdown(now - ad.officialEnd)}）</span>}
        </p>
      )}
      <p className="mt-1 text-slate-700">強制結束是一筆來源為「強制結束」的出關紀錄，之後可在打卡紀錄撤銷。</p>
    </div>
  );
}

// =====================================================================
// ExtendDialog
// =====================================================================

export interface ExtendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: AssignmentDerived;
  snapshot: GameSnapshot;
  now: number;
  onDone?: () => void;
}

/** 延長對話框（通知中心 STATION_SHORTENED 的「延長」按鈕也用這個） */
export function ExtendDialog(props: ExtendDialogProps): React.ReactNode {
  // 關閉時卸載內容，每次開啟都重新初始化選項與原因
  if (!props.open) return null;
  return <ExtendDialogBody {...props} />;
}

/**
 * 延長對話框固定在「開啟當下」的場次：同一場次的 Realtime 更新照常反映（結束時間、延長狀態），
 * 但呼叫端若在開著時傳入另一個場次，仍沿用最後一次看到的原場次資料，送出的 assignmentId 不會被換掉。
 */
function useHeldAssignment(assignment: AssignmentDerived): AssignmentDerived {
  const [held, setHeld] = React.useState(assignment);
  const same = assignment.assignment.id === held.assignment.id;
  if (same && assignment !== held) setHeld(assignment);
  return same ? assignment : held;
}

type ExtendChoice = "plus5" | "plus10" | "full" | "custom";

const REASON_CHIPS = ["補足晚開始的時間", "等待隊伍到齊", "道具／場地問題", "天氣因素"];

function ExtendDialogBody({ onOpenChange, assignment, snapshot, now, onDone }: ExtendDialogProps) {
  const ad = useHeldAssignment(assignment);
  const started = ad.stationCheckIn !== null;
  const durationMs = snapshot.game.stationDurationMs;
  const [choice, setChoice] = React.useState<ExtendChoice>(started ? "plus5" : "full");
  const [customTime, setCustomTime] = React.useState<string>(() =>
    msToTaipeiTimeInput((ad.officialEnd ?? ad.slot.scheduledEnd) + 5 * 60_000),
  );
  const [reason, setReason] = React.useState("");
  const req = useAdminRequest<AdminEndOverrideResponse>();
  const reasonId = React.useId();
  const timeId = React.useId();

  const base = ad.officialEnd ?? now;
  const fullEnd = Math.max(now, ad.startedAt ?? now) + durationMs;
  let customEnd: number | null = null;
  try {
    customEnd = customTime ? taipeiLocalToMs(snapshot.event.eventDate, customTime) : null;
  } catch {
    customEnd = null;
  }

  const endFor = (c: ExtendChoice): number | null => {
    switch (c) {
      case "plus5":
        return base + 5 * 60_000;
      case "plus10":
        return base + 10 * 60_000;
      case "full":
        return fullEnd;
      case "custom":
        return customEnd;
    }
  };
  const newEnd = endFor(choice);

  let invalid: string | null = null;
  if (newEnd === null) invalid = "請輸入正確的結束時間（HH:mm 或 HH:mm:ss）。";
  else if (ad.startedAt !== null && newEnd <= ad.startedAt) invalid = `結束時間必須晚於開始計時 ${formatHms(ad.startedAt)}。`;
  else if (newEnd <= now) invalid = "結束時間已經過去，請選較晚的時間（要立刻結束請用「強制結束」）。";

  const canSubmit = !invalid && reason.trim().length > 0 && !req.pending;

  const submit = async () => {
    if (!canSubmit || newEnd === null) return;
    const body: AdminEndOverrideRequest =
      choice === "plus5"
        ? { assignmentId: ad.assignment.id, extendMinutes: 5, reason: reason.trim() }
        : choice === "plus10"
          ? { assignmentId: ad.assignment.id, extendMinutes: 10, reason: reason.trim() }
          : choice === "full"
            ? { assignmentId: ad.assignment.id, fullDuration: true, reason: reason.trim() }
            : { assignmentId: ad.assignment.id, officialEnd: new Date(newEnd).toISOString(), reason: reason.trim() };
    const r = await req.run("/api/admin/end-override", body);
    if (!r) return;
    pushToast({ tone: "success", title: `已延長 ${ad.station.name}`, body: `結束時間改為 ${formatHms(newEnd)}（以 server 時間為準）` });
    onOpenChange(false);
    onDone?.();
  };

  const choices: Array<{ c: ExtendChoice; label: string }> = [
    { c: "plus5", label: "延長 5 分鐘" },
    { c: "plus10", label: "延長 10 分鐘" },
    { c: "full", label: "補足完整時間" },
    { c: "custom", label: "指定結束時間" },
  ];

  return (
    <Dialog
      open
      onClose={() => onOpenChange(false)}
      dismissible={!req.pending}
      title="延長時間"
      description={`${assignmentTitle(ad)}・${assignmentTeamsText(snapshot, ad)}`}
      role="alertdialog"
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-base font-bold">
          <dt className="text-slate-600">開始計時</dt>
          <dd className="timer-digits">{ad.startedAt !== null ? formatHms(ad.startedAt) : "尚未開始"}</dd>
          <dt className="text-slate-600">目前結束</dt>
          <dd className="timer-digits">
            {ad.officialEnd !== null ? formatHms(ad.officialEnd) : `時段預定 ${formatHm(ad.slot.scheduledEnd)}`}
            {ad.endOverride && <span className="ml-2 text-blue-800">（已延長）</span>}
          </dd>
          {ad.shortenedMs !== null && ad.shortenedMs > 0 && (
            <>
              <dt className="text-slate-600">本場縮短</dt>
              <dd>
                <span className="timer-digits">{formatDuration(ad.shortenedMs)}</span>
                {ad.insufficientTime && <span className={cn("ml-2 rounded-md px-1.5 py-0.5 text-sm", INSUFFICIENT_TIME_CLASS)}>時間不足</span>}
              </dd>
            </>
          )}
        </dl>

        <div role="radiogroup" aria-label="延長方式" className="grid grid-cols-2 gap-3">
          {choices.map(({ c, label }) => {
            const end = endFor(c);
            const active = c === choice;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={req.pending}
                onClick={() => setChoice(c)}
                className={cn(
                  "flex min-h-20 flex-col items-center justify-center rounded-xl border-2 px-2 py-2 text-center",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                  active ? "border-blue-800 bg-blue-700 text-white" : "border-slate-400 bg-white text-slate-900",
                )}
              >
                <span className="text-lg font-black">{label}</span>
                <span className={cn("timer-digits text-sm font-bold", active ? "text-white" : "text-slate-600")}>
                  {c === "custom" ? "自訂時刻" : end !== null ? `至 ${formatHms(end)}` : ""}
                </span>
              </button>
            );
          })}
        </div>

        {choice === "full" && (
          <p className="text-base font-bold text-slate-700">
            從{ad.startedAt !== null && ad.startedAt > now ? "開始計時" : "現在"}起重新計完整的 {formatDurationText(durationMs)}。
          </p>
        )}

        {choice === "custom" && (
          <Field label="結束時間（活動日當天）" htmlFor={timeId} required>
            <Input id={timeId} type="time" step={1} value={customTime} onChange={(e) => setCustomTime(e.target.value)} disabled={req.pending} className="timer-digits text-2xl font-black" />
          </Field>
        )}

        <Field label="原因" htmlFor={reasonId} required>
          <Textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} rows={2} disabled={req.pending} placeholder="請簡短說明原因" />
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

        <div className="flex flex-col gap-3">
          <Button variant="primary" size="xl" block onClick={submit} disabled={!canSubmit} loading={req.pending} loadingText="送出中…">
            <Clock className="size-7" aria-hidden />
            {newEnd !== null && !invalid ? `確定延長至 ${formatHms(newEnd)}` : "確定延長"}
          </Button>
          <ErrorText message={invalid ?? req.error} />
          {!invalid && reason.trim().length === 0 && <p className="text-base font-bold text-slate-600">請填寫原因後送出。</p>}
          <Button variant="secondary" size="lg" block onClick={() => onOpenChange(false)} disabled={req.pending}>
            取消
          </Button>
        </div>
        <p className="flex items-start gap-2 text-sm font-bold text-slate-600">
          <ShieldAlert className="size-5 shrink-0" aria-hidden />
          延長會寫入 audit log；之後可以撤銷延長。延長後再次超時會重新通知。
        </p>
      </div>
    </Dialog>
  );
}
