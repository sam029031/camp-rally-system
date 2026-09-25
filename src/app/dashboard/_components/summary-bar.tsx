"use client";

import type { GameSummary } from "@/lib/derive/types";
import { STATION_STATE_CLASS, slotLabel, teamStateClasses, type StateClassSet } from "@/lib/labels";
import { cn } from "@/lib/client/cn";
import { Switch } from "@/components/ui/switch";

const GRAY = STATION_STATE_CLASS.WAITING;
const TRANSITIONING = teamStateClasses({ state: "TRANSITIONING", arrivedDetail: null, transitionWarning: false });
const OVERDUE = teamStateClasses({ state: "TRANSITION_OVERDUE", arrivedDetail: null, transitionWarning: false });

interface Item {
  key: keyof GameSummary;
  label: string;
  cls: StateClassSet;
}

/** 摘要列（第十一節）：本時段 進行中／將結束／超時／等待開始／跑關中／跑關逾期 */
const ITEMS: Item[] = [
  { key: "inProgress", label: "進行中", cls: STATION_STATE_CLASS.IN_PROGRESS },
  { key: "endingSoon", label: "將結束", cls: STATION_STATE_CLASS.ENDING_SOON },
  { key: "overtime", label: "超時", cls: STATION_STATE_CLASS.OVERTIME },
  { key: "waitingStart", label: "等待開始", cls: STATION_STATE_CLASS.READY },
  { key: "transitioning", label: "跑關中", cls: TRANSITIONING },
  { key: "transitionOverdue", label: "跑關逾期", cls: OVERDUE },
];

export interface SummaryBarProps {
  summary: GameSummary;
  currentSlotNumber: number;
  anomaliesOnly: boolean;
  onAnomaliesOnlyChange: (v: boolean) => void;
  /** 正在瀏覽的時段中異常的關卡數 */
  anomalyCount: number;
}

export function SummaryBar({ summary, currentSlotNumber, anomaliesOnly, onAnomaliesOnlyChange, anomalyCount }: SummaryBarProps) {
  return (
    <section aria-label="摘要" className="flex flex-col gap-2 rounded-2xl border-2 border-slate-300 bg-white p-3">
      <p className="text-sm font-bold text-slate-600">本時段（{slotLabel(currentSlotNumber)}）摘要</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ITEMS.map((it) => {
          const n = summary[it.key];
          const cls = n > 0 ? it.cls : GRAY;
          return (
            <li key={it.key} className={cn("flex flex-col items-center rounded-xl border-2 px-1 py-1.5", cls.card)}>
              <span className="timer-digits text-3xl font-black leading-none">{n}</span>
              <span className="mt-1 text-sm font-bold">{it.label}</span>
            </li>
          );
        })}
      </ul>
      <Switch
        checked={anomaliesOnly}
        onCheckedChange={onAnomaliesOnlyChange}
        label={<span className="text-lg font-black">只看異常</span>}
        description={
          anomalyCount > 0
            ? `${anomalyCount} 關有異常（超時、跑關逾期、未出關、未到、紀錄異常）`
            : "目前沒有異常（超時、跑關逾期、未出關、未到、紀錄異常）"
        }
      />
    </section>
  );
}
