"use client";

import * as React from "react";
import { SELF_UNDO_WINDOW_MS } from "@/lib/constants";
import { formatHms } from "@/lib/time";
import { UndoButton } from "@/components/undo-button";
import type { OwnRecordItem } from "./station-view";

/** 過期提示（「超過 1 分鐘，請聯絡活動長由總召修正。」）在按下後多久內仍顯示（真實時間） */
const EXPIRED_HINT_KEEP_MS = 3 * 60_000;
/** 同時最多顯示幾筆可撤銷的紀錄 */
const MAX_ITEMS = 2;

export interface UndoZoneProps {
  /** 本 identity 在本關按下、仍有效的紀錄（新的在前；已經不能撤銷的由呼叫端先排除） */
  items: ReadonlyArray<OwnRecordItem>;
  /** 校正後真實時間（useLiveGame().realNow） */
  realNow: () => number;
  onUndo: (recordId: string) => void;
  /** 正在撤銷的紀錄 id */
  pendingRecordId: string | null;
  /** 撤銷失敗訊息與它屬於哪一筆 */
  error: { recordId: string; message: string } | null;
  /** 超過 60 秒的提示 */
  expiredHint: string;
}

/**
 * 現場撤銷區（第二十二節）：剛按下的確認在 60 秒內顯示 [ 撤銷（剩 45 秒）]；
 * 依 real_created_at 與校正後真實時間計算，refresh 後仍正確；超過 60 秒改顯示「請聯絡活動長」提示，幾分鐘後收起。
 */
export function UndoZone({ items, realNow, onUndo, pendingRecordId, error, expiredHint }: UndoZoneProps) {
  const [nowReal, setNowReal] = React.useState(() => realNow());

  React.useEffect(() => {
    const timer = setInterval(() => setNowReal(realNow()), 1000);
    return () => clearInterval(timer);
  }, [realNow]);

  const visible = items
    .filter((i) => nowReal - i.record.realCreatedAt < EXPIRED_HINT_KEEP_MS + SELF_UNDO_WINDOW_MS)
    .slice(0, MAX_ITEMS);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {visible.map((i) => (
        <div key={i.record.id} className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-slate-400 bg-white p-3">
          <p className="text-base font-bold text-slate-700">
            剛才：{i.label}　<span className="timer-digits">{formatHms(i.record.recordedAt)}</span>
          </p>
          <UndoButton
            record={i.record}
            realNow={realNow}
            onUndo={onUndo}
            pending={pendingRecordId === i.record.id}
            error={error && error.recordId === i.record.id ? error.message : null}
            expiredHint={expiredHint}
          />
        </div>
      ))}
    </div>
  );
}
