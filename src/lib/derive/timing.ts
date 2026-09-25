/**
 * 正式計時（第八節）與跑關期限（第九節）的純計算，deriveGame 與通知失效判斷共用。
 */

import type { CheckRecord, EndOverride, GameInfo, Slot } from "@/lib/types";

export interface StationTiming {
  /** started_at = max(station_check_in.recorded_at, slot.scheduled_start) */
  startedAt: number;
  /** override → override；FULL_DURATION → startedAt + duration；FIXED_END → min(startedAt + duration, scheduledEnd) */
  officialEnd: number;
  /** 可玩時間 = officialEnd − startedAt */
  playableMs: number;
  /** duration − playableMs（> 0 才有值） */
  shortenedMs: number | null;
  /** FIXED_END 壓縮後可玩時間 < min_play_seconds（「時間不足」） */
  insufficientTime: boolean;
}

export function computeStationTiming(
  game: GameInfo,
  slot: Slot,
  stationCheckIn: CheckRecord,
  endOverride: EndOverride | null,
): StationTiming {
  const startedAt = Math.max(stationCheckIn.recordedAt, slot.scheduledStart);
  let officialEnd: number;
  if (endOverride) {
    officialEnd = endOverride.officialEnd;
  } else if (game.endPolicy === "FIXED_END") {
    officialEnd = Math.min(startedAt + game.stationDurationMs, slot.scheduledEnd);
  } else {
    officialEnd = startedAt + game.stationDurationMs;
  }
  const playableMs = officialEnd - startedAt;
  const shortBy = game.stationDurationMs - playableMs;
  return {
    startedAt,
    officialEnd,
    playableMs,
    shortenedMs: shortBy > 0 ? shortBy : null,
    insufficientTime: game.endPolicy === "FIXED_END" && playableMs < game.minPlayMs,
  };
}

/** 跑關期限：deadline = max(上一關出關 + 跑關時間, 目標 scheduled_start)；第一關 = 目標 scheduled_start */
export function transitionDeadline(game: GameInfo, previousCheckOut: CheckRecord | null, target: Slot): number {
  if (!previousCheckOut) return target.scheduledStart;
  return Math.max(previousCheckOut.recordedAt + game.transitionDurationMs, target.scheduledStart);
}
