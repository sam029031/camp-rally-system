"use client";

import * as React from "react";
import { Undo2 } from "lucide-react";
import { SELF_UNDO_WINDOW_MS, UNDO_EXPIRED_HINT_MS } from "@/lib/constants";
import { cn } from "@/lib/client/cn";
import { toEpochMs, undoButtonLabel, undoRemainingSeconds } from "@/lib/client/undo-window";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/error-text";

/** UndoButton 需要的紀錄欄位：DB row（real_created_at ISO）或正規化後（realCreatedAt ms）皆可 */
export type UndoableRecord = { id: string; real_created_at: string } | { id: string; realCreatedAt: number };

export interface UndoButtonProps {
  /** 剛按下的那筆紀錄（本 identity 自己按的）；null = 不顯示 */
  record: UndoableRecord | null;
  /** 校正後真實時間（useLiveGame().realNow）；60 秒一律用真實時間，不受 Demo 倍速影響 */
  realNow: () => number;
  /** 按下撤銷（通常是 useUndo().undo） */
  onUndo: (recordId: string) => void | Promise<unknown>;
  /** 撤銷送出中 */
  pending?: boolean;
  /** 撤銷失敗訊息 */
  error?: string | null;
  /**
   * 超過 60 秒後顯示的提示，例如 `undoExpiredMessage(snapshot.event.leadTitle)`
   * →「超過 1 分鐘，請聯絡活動長由總召修正。」；null = 過期後不顯示任何東西。
   * 提示只在過期後 UNDO_EXPIRED_HINT_MS（真實時間 3 分鐘）內顯示，之後隱藏。
   */
  expiredHint?: string | null;
  className?: string;
}

function realCreatedAtOf(r: UndoableRecord): number {
  return "realCreatedAt" in r ? r.realCreatedAt : toEpochMs(r.real_created_at);
}

/**
 * 現場撤銷按鈕（第十六、十七、二十二節）：按下任何確認後 60 秒內顯示 [ 撤銷（剩 45 秒）]，
 * 依 real_created_at 與校正後真實時間倒數，refresh 後仍正確；超過 60 秒改顯示提示文字（再顯示 3 分鐘後隱藏）。
 */
export function UndoButton({ record, realNow, onUndo, pending = false, error, expiredHint = null, className }: UndoButtonProps) {
  const [nowReal, setNowReal] = React.useState(() => realNow());
  const createdAt = record ? realCreatedAtOf(record) : null;

  React.useEffect(() => {
    if (createdAt === null || Number.isNaN(createdAt)) return;
    const timer = setInterval(() => {
      const t = realNow();
      setNowReal(t);
      // 撤銷視窗 + 過期提示都結束後就不必再更新
      if (t - createdAt >= SELF_UNDO_WINDOW_MS + UNDO_EXPIRED_HINT_MS) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [createdAt, realNow]);

  if (!record || createdAt === null || Number.isNaN(createdAt)) return null;

  const seconds = undoRemainingSeconds(createdAt, nowReal);
  if (seconds <= 0) {
    if (nowReal - createdAt >= SELF_UNDO_WINDOW_MS + UNDO_EXPIRED_HINT_MS) return null;
    return expiredHint ? <p className={cn("text-base font-bold text-slate-700", className)}>{expiredHint}</p> : null;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        variant="secondary"
        size="md"
        block
        loading={pending}
        loadingText="撤銷中…"
        onClick={() => void onUndo(record.id)}
        className="border-slate-600"
      >
        <Undo2 className="size-6" aria-hidden />
        <span className="timer-digits">{undoButtonLabel(seconds)}</span>
      </Button>
      <ErrorText message={error} />
    </div>
  );
}
