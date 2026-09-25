"use client";

import * as React from "react";
import { Copy, CheckCircle2 } from "lucide-react";
import type { UndoReminder } from "@/lib/api/contract";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export interface UndoReminderDialogProps {
  /** useUndo().reminder；null = 不顯示（ADMIN 自己撤銷時 server 回傳 null） */
  reminder: UndoReminder | null;
  /** 按「我知道了」（useUndo().dismissReminder） */
  onClose: () => void;
}

/** 把「【…】」包起來的字加粗（例如【活動組群】【活動長】） */
function emphasize(text: string): React.ReactNode[] {
  return text.split(/(【[^】]*】)/g).map((part, i) =>
    part.startsWith("【") ? (
      <strong key={i} className="text-red-700">
        {part}
      </strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

function ReminderBody({ reminder, onClose }: { reminder: UndoReminder; onClose: () => void }) {
  const [copy, setCopy] = React.useState<"idle" | "done" | "failed">("idle");
  const textRef = React.useRef<HTMLTextAreaElement>(null);

  const doCopy = async () => {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(reminder.copyText);
      setCopy("done");
    } catch {
      // 失敗：改顯示可長按選取的文字框（第二十二節）
      setCopy("failed");
      requestAnimationFrame(() => {
        textRef.current?.focus();
        textRef.current?.select();
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-2xl font-black leading-relaxed text-slate-950">{emphasize(reminder.title)}</p>

      <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3">
        <p className="text-sm font-bold text-slate-600">要貼到【{reminder.groupLabel}】的訊息</p>
        {copy === "failed" ? (
          <>
            <p className="mt-1 text-base font-bold text-red-700">無法自動複製，請長按下面的文字框全選後複製。</p>
            <Textarea
              ref={textRef}
              readOnly
              value={reminder.copyText}
              rows={4}
              className="mt-2 select-all text-lg"
              onFocus={(e) => e.currentTarget.select()}
            />
          </>
        ) : (
          <p className="mt-1 select-all text-lg font-bold leading-relaxed text-slate-900">{reminder.copyText}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Button variant="secondary" size="lg" block onClick={doCopy}>
          {copy === "done" ? <CheckCircle2 className="size-6 text-emerald-700" aria-hidden /> : <Copy className="size-6" aria-hidden />}
          {copy === "done" ? "已複製" : "複製訊息"}
        </Button>
        <Button variant="primary" size="xl" block onClick={onClose} data-autofocus>
          我知道了
        </Button>
      </div>
    </div>
  );
}

/**
 * 撤銷後的提醒（第二十二節）：全螢幕、不能點背景或按 Escape 關閉，要按「我知道了」。
 * 內含「複製訊息」（navigator.clipboard.writeText；失敗改顯示可長按選取的文字框）。
 */
export function UndoReminderDialog({ reminder, onClose }: UndoReminderDialogProps) {
  return (
    <Dialog open={reminder !== null} onClose={onClose} dismissible={false} size="full" role="alertdialog" title="已撤銷，請立即說明">
      {reminder && <ReminderBody key={`${reminder.title}|${reminder.copyText}`} reminder={reminder} onClose={onClose} />}
    </Dialog>
  );
}
