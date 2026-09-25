import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { STATION_STATE_LABEL, TEAM_STATE_LABEL } from "@/lib/labels";
import type { ArrivedDetail, SecondaryTag, StationSlotState, TeamState } from "@/lib/derive/types";
import { cn } from "@/lib/client/cn";
import { stationStateTone, teamStateTone } from "@/lib/client/state-colors";
import { Badge } from "@/components/ui/badge";

type BadgeSize = "sm" | "md" | "lg";

export interface StationStateBadgeProps {
  /** 關卡時段狀態（第十節 A） */
  state: StationSlotState;
  /** CHECKED_OUT 且 no_show → 顯示「未到」（灰底紅字，第十四節） */
  noShow?: boolean;
  /** 覆寫顯示文字（例如「已取消（下雨）」）；顏色仍依 state */
  label?: React.ReactNode;
  size?: BadgeSize;
  /** 實心底色（醒目） */
  solid?: boolean;
  className?: string;
}

/** 關卡時段狀態徽章：文字 + 顏色。 */
export function StationStateBadge({ state, noShow = false, label, size = "md", solid = false, className }: StationStateBadgeProps) {
  const isNoShow = state === "CHECKED_OUT" && noShow;
  const text = label ?? (isNoShow ? "未到" : STATION_STATE_LABEL[state]);
  return (
    <Badge tone={stationStateTone(state, noShow)} size={size} solid={solid && !isNoShow} className={className}>
      {text}
    </Badge>
  );
}

/** ARRIVED 的顯示細分（第十節 B） */
export const ARRIVED_DETAIL_LABEL: Record<ArrivedDetail, string> = {
  TEAM_REPORTED: "已到（隊輔回報）",
  WAITING_START: "已到，等待開始",
  WAITING_OPPONENT: "已到，等待對手",
  QUEUED: "已到，排隊中",
};

export interface TeamStateBadgeProps {
  /** 小隊狀態（第十節 B） */
  state: TeamState;
  /** ARRIVED 的細分；TEAM_REPORTED 用紫色虛線框 */
  arrivedDetail?: ArrivedDetail | null;
  /** TRANSITION_OVERDUE 且沒有上一關 →「未到第一關」 */
  overdueFirstStation?: boolean;
  /** 跑關剩餘 <= 2:00（藍轉黃） */
  transitionWarning?: boolean;
  /** AT_STATION 時跟隨的關卡狀態（顏色） */
  stationState?: StationSlotState | null;
  /** 文字後面接的補充，例如「剩 03:12」「+01:10」 */
  suffix?: React.ReactNode;
  /** 覆寫主文字 */
  label?: React.ReactNode;
  size?: BadgeSize;
  solid?: boolean;
  className?: string;
}

/** 小隊狀態文字（不含 suffix），給需要純文字的地方使用 */
export function teamStateText(
  state: TeamState,
  opts: { arrivedDetail?: ArrivedDetail | null; overdueFirstStation?: boolean } = {},
): string {
  if (state === "ARRIVED" && opts.arrivedDetail) return ARRIVED_DETAIL_LABEL[opts.arrivedDetail];
  if (state === "TRANSITION_OVERDUE" && opts.overdueFirstStation) return "未到第一關";
  return TEAM_STATE_LABEL[state];
}

/** 小隊狀態徽章：文字 + 顏色（藍／紅／紫／灰；AT_STATION 跟隨關卡顏色）。 */
export function TeamStateBadge({
  state,
  arrivedDetail = null,
  overdueFirstStation = false,
  transitionWarning = false,
  stationState = null,
  suffix,
  label,
  size = "md",
  solid = false,
  className,
}: TeamStateBadgeProps) {
  const tone = teamStateTone(state, { stationState, transitionWarning });
  const dashed = state === "ARRIVED" && arrivedDetail === "TEAM_REPORTED";
  return (
    <Badge tone={tone} size={size} solid={solid && !dashed} dashed={dashed} className={className}>
      <span className="truncate">{label ?? teamStateText(state, { arrivedDetail, overdueFirstStation })}</span>
      {suffix !== undefined && suffix !== null && <span className="timer-digits font-black">{suffix}</span>}
    </Badge>
  );
}

export interface SecondaryTagChipsProps {
  /** 第十節 C 的次要標籤（推導結果）或直接給文字 */
  tags: ReadonlyArray<SecondaryTag | string>;
  size?: BadgeSize;
  className?: string;
}

/** 次要標籤：橘色小標籤，不蓋掉主色（第十四節）。沒有標籤時不渲染。 */
export function SecondaryTagChips({ tags, size = "sm", className }: SecondaryTagChipsProps) {
  if (tags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((t, i) => {
        const text = typeof t === "string" ? t : t.label;
        const key = typeof t === "string" ? `${t}-${i}` : `${t.kind}-${t.assignmentId}-${t.teamId}`;
        return (
          <Badge key={key} tone="orange" size={size} className="whitespace-normal text-left">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {text}
          </Badge>
        );
      })}
    </div>
  );
}
