"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  appNow,
  getClockState,
  getServerTick,
  getTick,
  realNow,
  retainClockSync,
  setClockEvent,
  subscribeClockState,
  subscribeTick,
  type ClockState,
} from "@/lib/client/clock-store";

export interface ClockView {
  /** app 時間（每秒更新；Demo 倍速時每 250ms） */
  now: number;
  /** 校正後真實時間（同一個 tick） */
  real: number;
  /** 事件處理用：當下的 app 時間 */
  getNow: () => number;
  /** 事件處理用：當下的校正後真實時間（撤銷 60 秒倒數） */
  realNow: () => number;
  /** 是否已經成功校時至少一次（未校時前暫用手機時間） */
  calibrated: boolean;
  /** Demo 模式（第三十一節：頂端橫幅「DEMO 模式 ×10」） */
  simEnabled: boolean;
  simSpeed: number;
}

/**
 * 統一時鐘 hook（第三十一節）。
 * @param eventId 要校時的活動 id；null / undefined = active event。
 *
 * 只要有元件使用，就會自動每 60 秒、回到前景、重新上線時重新校時。
 */
export function useClock(eventId?: string | null): ClockView {
  const tick = useSyncExternalStore(subscribeTick, getTick, getServerTick);
  const clock = useSyncExternalStore(subscribeClockState, getClockState, getClockState);

  useEffect(() => retainClockSync(), []);

  useEffect(() => {
    if (eventId !== undefined) setClockEvent(eventId);
  }, [eventId]);

  return {
    now: tick.app,
    real: tick.real,
    getNow: appNow,
    realNow,
    calibrated: clock.calibratedAt !== null,
    simEnabled: clock.settings.simEnabled,
    simSpeed: clock.settings.simSpeed,
  };
}

/** 只讀時鐘狀態（校時資訊、錯誤），不會每秒 re-render */
export function useClockState(): ClockState {
  return useSyncExternalStore(subscribeClockState, getClockState, getClockState);
}
