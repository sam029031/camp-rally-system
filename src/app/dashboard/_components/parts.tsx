"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { AssignmentDerived } from "@/lib/derive/types";
import type { CheckRecord, GameSnapshot } from "@/lib/types";
import { INSUFFICIENT_TIME_CLASS, NO_SHOW_LABEL, SECONDARY_TAG_CLASS } from "@/lib/labels";
import { formatHms } from "@/lib/time";
import { cn } from "@/lib/client/cn";
import { TONE_CLASSES } from "@/lib/client/state-colors";
import { AdminAssignmentActions } from "@/components/admin-actions";
import { StationStateBadge, TeamStateBadge } from "@/components/state-badges";
import { Badge } from "@/components/ui/badge";
import { stationStateText, type SideStatus } from "@/app/dashboard/_components/view-model";

/** 某隊在某場的狀態徽章 */
export function SideStatusBadge({
  status,
  stationState,
  size = "sm",
  className,
}: {
  status: SideStatus;
  stationState: AssignmentDerived["state"] | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (status.kind === "plain") {
    return (
      <Badge tone={status.tone} size={size} className={cn("whitespace-normal text-left", className)}>
        {status.label}
      </Badge>
    );
  }
  const td = status.td;
  return (
    <TeamStateBadge
      state={td.state}
      arrivedDetail={td.arrivedDetail}
      overdueFirstStation={td.overdueFirstStation}
      transitionWarning={td.transitionWarning}
      stationState={stationState}
      label={status.label}
      size={size}
      className={cn("whitespace-normal text-left", className)}
    />
  );
}

/** 關卡狀態徽章（含「已取消（原因）」「已到，等待對手」「未到」） */
export function StationBadge({ ad, size = "md", className }: { ad: AssignmentDerived; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <StationStateBadge
      state={ad.state}
      noShow={ad.noShow}
      label={stationStateText(ad)}
      size={size}
      solid={ad.state === "OVERTIME"}
      className={cn("whitespace-normal text-left", className)}
    />
  );
}

/** 打卡時間（HH:mm:ss）；沒有 → 「--」；本隊未到 → 「未到」；強制結束另外標示 */
export function RecordTime({ record, className }: { record: CheckRecord | null; className?: string }) {
  if (!record) return <span className={cn("text-slate-500", className)}>--</span>;
  if (record.noShow) return <span className={cn("font-black text-red-700", className)}>{NO_SHOW_LABEL}</span>;
  return (
    <span className={cn("timer-digits font-bold", className)}>
      {record.source === "admin_force" && <span className="mr-1 text-sm font-black text-red-700">強制結束</span>}
      {formatHms(record.recordedAt)}
    </span>
  );
}

/** 橘色次要標籤角標（不蓋掉主色）＋「時間不足」黃色標籤 */
export function FlagChips({ tags, insufficient, className }: { tags: string[]; insufficient: boolean; className?: string }) {
  if (tags.length === 0 && !insufficient) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {insufficient && (
        <span className={cn("inline-flex items-center rounded-lg px-2 py-1 text-sm font-black", INSUFFICIENT_TIME_CLASS)}>時間不足</span>
      )}
      {tags.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold", SECONDARY_TAG_CLASS)}
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {t}
        </span>
      ))}
    </div>
  );
}

/** 醒目警示列（例如「上一時段 第N小隊 未到，待按本隊未到」） */
export function AlertLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("rounded-lg border-2 px-2 py-1 text-sm font-black leading-snug", TONE_CLASSES.orange.soft, className)}>{children}</p>
  );
}

/** 總召快捷操作（延長／取消／強制結束）：只有 ADMIN 看得到 */
export function AdminActions({
  isAdmin,
  ad,
  snapshot,
  now,
  onDone,
}: {
  isAdmin: boolean;
  ad: AssignmentDerived | undefined;
  snapshot: GameSnapshot;
  now: number;
  onDone: () => void;
}) {
  if (!isAdmin || !ad) return null;
  return <AdminAssignmentActions key={ad.assignment.id} compact assignment={ad} snapshot={snapshot} now={now} onDone={onDone} />;
}
