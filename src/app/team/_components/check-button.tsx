"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import type { CheckStatus } from "@/lib/api/contract";
import type { CheckRecordRow } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { useCheckAction } from "@/lib/client/use-check-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";

export interface CheckConfirmSpec {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
}

export interface TeamCheckButtonProps {
  assignmentId: string;
  action: "team_check_in" | "team_check_out";
  teamId: string;
  /** 「確認進關」「確認出關」 */
  label: string;
  /** 已完成（快照或本機剛按下的紀錄時間）：按鈕 disabled，下方顯示 doneText */
  doneAt: number | null;
  /** 例：「隊輔確認：09:10:23」 */
  doneText: string | null;
  /** 只有本隊隊輔與 ADMIN 可以按；false 時只顯示狀態文字 */
  canOperate: boolean;
  variant?: "primary" | "success" | "secondary";
  size?: "md" | "lg" | "xl";
  /** 按下時才判斷是否需要先確認（例如太早進關）；回傳 null = 直接送出 */
  getConfirm?: () => CheckConfirmSpec | null;
  refetch: () => Promise<void>;
  onRecorded: (record: CheckRecordRow, status: CheckStatus) => void;
  className?: string;
}

/**
 * 隊輔側的一個打卡按鈕（第十六、二十一節）：
 * 按下立即 disabled、同一個 clientRequestId 自動重試、錯誤訊息直接顯示在按鈕下方、
 * 別台先按 →「已由另一裝置於 HH:mm:ss 記錄」並進入完成狀態。
 */
export function TeamCheckButton({
  assignmentId,
  action,
  teamId,
  label,
  doneAt,
  doneText,
  canOperate,
  variant = "primary",
  size = "xl",
  getConfirm,
  refetch,
  onRecorded,
  className,
}: TeamCheckButtonProps) {
  const check = useCheckAction({ assignmentId, action, teamId }, { refetch, onSuccess: onRecorded });
  const [confirm, setConfirm] = React.useState<CheckConfirmSpec | null>(null);
  const done = doneAt !== null;

  const send = () => {
    void check.submit();
  };

  const handleClick = () => {
    const spec = getConfirm?.() ?? null;
    if (spec) setConfirm(spec);
    else send();
  };

  if (!canOperate) {
    return (
      <p className={cn("text-lg font-bold", done ? "text-slate-900" : "text-slate-600", className)}>
        {done ? doneText : `隊輔尚未${label}`}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button
        variant={done ? "secondary" : variant}
        size={size}
        block
        disabled={done}
        loading={check.pending}
        loadingText={check.attempt > 1 ? `重新送出中…（第 ${check.attempt} 次）` : "送出中…"}
        onClick={handleClick}
      >
        {done && <CheckCircle2 className="size-7 text-emerald-700" aria-hidden />}
        {label}
      </Button>
      {done && doneText && <p className="text-xl font-black text-slate-900">{doneText}</p>}
      <ErrorText message={check.error} />
      <ErrorText tone="notice" message={check.notice} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel ?? label}
        tone="primary"
        onConfirm={() => {
          setConfirm(null);
          send();
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
