"use client";

import type { DerivedGame } from "@/lib/derive/types";
import { cn } from "@/lib/client/cn";
import { AlertLine, FlagChips, SideStatusBadge } from "@/app/dashboard/_components/parts";
import type { RowModel } from "@/app/dashboard/_components/row-model";
import { previousNoShowText, sideStatus, tagTexts, teamLabel, type Lookup } from "@/app/dashboard/_components/view-model";

/**
 * 關卡列的附加資訊（第十一節）：
 * - primary 是上一時段仍佔住的那一場 → 小字顯示本時段的隊伍「第1小隊 前往中 剩 03:12／已到 09:30:05」
 * - 上一時段 WAITING →「上一時段 第N小隊 未到，待按本隊未到」
 */
export function RowExtras({ m, d, lk, className }: { m: RowModel; d: DerivedGame; lk: Lookup; className?: string }) {
  const own = m.row.showingPrevious ? m.own : undefined;
  const prevText = previousNoShowText(lk, m.prevNoShow);
  if (!own && !prevText) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {prevText && <AlertLine>{prevText}</AlertLine>}
      {own && (
        <div className="flex flex-col gap-1 rounded-lg border-2 border-slate-300 bg-white/80 px-2 py-1.5">
          <p className="text-sm font-bold text-slate-700">
            本時段（第{own.slot.number}時段）{own.state === "CANCELLED" ? "：" : "隊伍："}
          </p>
          {own.state === "CANCELLED" ? (
            <p className="text-sm font-bold text-slate-600">
              已取消{own.cancellation ? `（${own.cancellation.reason}）` : ""}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {own.teamIds.map((tid) => (
                <li key={tid} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-base font-black">{teamLabel(lk, tid)}</span>
                  <SideStatusBadge status={sideStatus(d, lk, own, tid)} stationState={own.state} />
                </li>
              ))}
            </ul>
          )}
          <FlagChips tags={tagTexts(lk, own)} insufficient={false} />
        </div>
      )}
    </div>
  );
}
