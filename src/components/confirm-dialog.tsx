"use client";

import * as React from "react";
import { CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorText } from "@/components/error-text";

export interface ConfirmChecklistItem {
  id: string;
  /** 勾選列文字，例如「第2小隊已到場」 */
  label: React.ReactNode;
  /** 預設勾選（例如隊輔已回報到關，第十八節）；關主仍要看一眼 */
  defaultChecked?: boolean;
  /** 未勾時提示用的名稱，例如「第4小隊」→「等待第4小隊抵達」 */
  waitingLabel?: string;
  /** 列下方小字，例如「隊輔已回報 13:04:10」 */
  hint?: React.ReactNode;
}

export interface ConfirmDialogResult {
  /** 勾選的項目 id（checklist 時） */
  checkedIds: string[];
  /** 輸入的原因（reason 時，已 trim） */
  reason: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  /** 主要說明（大字），例如「尚未到時段，確定小隊已經到了？」「本場只剩 08:30，確定開始？」 */
  description?: React.ReactNode;
  /** 其他自訂內容 */
  children?: React.ReactNode;
  /** 確認按鈕文字，例如「確定開始」 */
  confirmLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** 確認按鈕顏色；危險動作（本隊未到、單隊開始、取消、Reset）用 danger */
  tone?: "primary" | "success" | "danger" | "warning";
  /** 送出中：按鈕轉圈、不能關閉 */
  pending?: boolean;
  /** 送出失敗訊息（顯示在按鈕上方） */
  error?: string | null;
  /**
   * 必勾清單（第十八節「雙方到齊，開始」）：全部勾選前確認按鈕 disabled，並顯示「等待第N小隊抵達」。
   * 沒有「仍要開始」的選項。
   */
  checklist?: {
    items: ReadonlyArray<ConfirmChecklistItem>;
    /** 清單上方的標題 */
    heading?: React.ReactNode;
    /** 自訂未勾齊時的提示；預設「等待{waitingLabel…}抵達」 */
    waitingHint?: (unchecked: ReadonlyArray<ConfirmChecklistItem>) => string;
  };
  /** 原因輸入框（管理操作、單隊開始）；required 時未填不能送出 */
  reason?: {
    label: React.ReactNode;
    placeholder?: string;
    required?: boolean;
    defaultValue?: string;
    maxLength?: number;
  };
  /** 需要輸入確認字（例如 RESET）才能送出 */
  typedConfirmation?: {
    text: string;
    label?: React.ReactNode;
  };
  onConfirm: (result: ConfirmDialogResult) => void | Promise<unknown>;
  onCancel: () => void;
}

function defaultWaitingHint(unchecked: ReadonlyArray<ConfirmChecklistItem>): string {
  const names = unchecked.map((i) => i.waitingLabel).filter((x): x is string => !!x);
  return names.length > 0 ? `等待${names.join("、")}抵達` : "請逐一勾選確認";
}

function ConfirmBody(props: ConfirmDialogProps) {
  const { description, children, confirmLabel, cancelLabel = "取消", tone = "primary", pending = false, error, checklist, reason, typedConfirmation, onConfirm, onCancel } =
    props;
  const reasonId = React.useId();
  const typedId = React.useId();

  const [checked, setChecked] = React.useState<Set<string>>(
    () => new Set((checklist?.items ?? []).filter((i) => i.defaultChecked).map((i) => i.id)),
  );
  const [reasonText, setReasonText] = React.useState(reason?.defaultValue ?? "");
  const [typed, setTyped] = React.useState("");

  const unchecked = (checklist?.items ?? []).filter((i) => !checked.has(i.id));
  const checklistOk = unchecked.length === 0;
  const reasonOk = !reason?.required || reasonText.trim().length > 0;
  const typedOk = !typedConfirmation || typed.trim() === typedConfirmation.text;
  const canConfirm = checklistOk && reasonOk && typedOk && !pending;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    if (!canConfirm) return;
    void onConfirm({ checkedIds: [...checked], reason: reasonText.trim() });
  };

  return (
    <div className="flex flex-col gap-5">
      {description && <div className="text-xl font-bold leading-relaxed text-slate-950">{description}</div>}
      {children}

      {checklist && (
        <fieldset className="flex flex-col gap-3">
          {checklist.heading && <legend className="mb-2 text-lg font-bold text-slate-900">{checklist.heading}</legend>}
          {checklist.items.map((item) => {
            const on = checked.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(item.id)}
                disabled={pending}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                  on ? "border-emerald-600 bg-emerald-50" : "border-slate-400 bg-white",
                )}
              >
                {on ? (
                  <CheckSquare className="size-8 shrink-0 text-emerald-700" aria-hidden />
                ) : (
                  <Square className="size-8 shrink-0 text-slate-500" aria-hidden />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="text-xl font-bold text-slate-950">{item.label}</span>
                  {item.hint && <span className="text-base text-slate-700">{item.hint}</span>}
                </span>
              </button>
            );
          })}
          {!checklistOk && (
            <p role="status" className="text-lg font-bold text-orange-800">
              {(checklist.waitingHint ?? defaultWaitingHint)(unchecked)}
            </p>
          )}
        </fieldset>
      )}

      {reason && (
        <Field label={reason.label} htmlFor={reasonId} required={reason.required}>
          <Textarea
            id={reasonId}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder={reason.placeholder}
            maxLength={reason.maxLength ?? 200}
            disabled={pending}
            rows={2}
          />
        </Field>
      )}

      {typedConfirmation && (
        <Field label={typedConfirmation.label ?? `請輸入 ${typedConfirmation.text} 確認`} htmlFor={typedId} required>
          <Input
            id={typedId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={typedConfirmation.text}
            disabled={pending}
          />
        </Field>
      )}

      <ErrorText message={error} />

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Button variant={tone} size="xl" className="sm:flex-1" onClick={submit} disabled={!canConfirm} loading={pending} loadingText="送出中…">
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="lg" className="sm:flex-1 sm:self-stretch sm:h-auto" onClick={onCancel} disabled={pending} data-autofocus>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * 確認對話框（第十七、十八、二十九節：大按鈕、危險動作二次確認）。
 * 每次開啟都重新初始化勾選、原因與確認字。
 *
 * 例：大地「雙方到齊，開始」
 * ```tsx
 * <ConfirmDialog open={open} title="雙方到齊，開始" confirmLabel="開始"
 *   checklist={{ items: [
 *     { id: teamA.id, label: "第2小隊已到場", waitingLabel: "第2小隊", defaultChecked: aReported },
 *     { id: teamB.id, label: "第4小隊已到場", waitingLabel: "第4小隊", defaultChecked: bReported } ] }}
 *   onConfirm={({ checkedIds }) => start.submit({ confirmedTeamIds: checkedIds })}
 *   onCancel={() => setOpen(false)} pending={start.pending} error={start.error} />
 * ```
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, title, pending = false, onCancel } = props;
  // Dialog 關閉時會卸載內容，所以每次開啟 ConfirmBody 的 state 都是新的
  return (
    <Dialog open={open} onClose={onCancel} dismissible={!pending} title={title} role="alertdialog">
      <ConfirmBody {...props} />
    </Dialog>
  );
}
