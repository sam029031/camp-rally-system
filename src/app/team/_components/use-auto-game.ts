"use client";

import * as React from "react";
import { dashboardGameForNow } from "@/lib/schedule";
import type { GameCode, Slot } from "@/lib/types";

/**
 * 依時間自動選遊戲（第十六節：規則同 /dashboard）時，頁面開著跨過黃金最後時段結束 → 自動換到大地。
 *
 * 用法（整頁仍只呼叫一次 useLiveGame）：
 * ```ts
 * const [autoGame, setAutoGame] = React.useState(initialAutoGame);
 * const gameCode = explicitGame ?? autoGame;
 * const live = useLiveGame(gameCode);
 * useFollowAutoGame({ explicitGame, gameCode, live, serverGoldSlots, setAutoGame });
 * ```
 *
 * - 「現在」用 app 時鐘（live.getNow，Demo 倍速也跟著走）；要等第一份快照載入（時鐘設定已套用）才開始判斷，
 *   避免 Demo 模式在校時前用手機時間誤判。
 * - 黃金時段以最新看到的黃金快照為準（含整場延後）；還沒看過黃金快照時用 server 傳來的時段。
 * - 手動切換（explicitGame）時不動作。
 */
export function useFollowAutoGame({
  explicitGame,
  gameCode,
  live,
  serverGoldSlots,
  setAutoGame,
}: {
  explicitGame: GameCode | null;
  gameCode: GameCode;
  live: { snapshot: { slots: Slot[] } | null; getNow: () => number };
  serverGoldSlots: Slot[];
  setAutoGame: React.Dispatch<React.SetStateAction<GameCode>>;
}): void {
  const goldSlotsRef = React.useRef<Slot[]>(serverGoldSlots);
  const liveGoldSlots = gameCode === "gold" && live.snapshot ? live.snapshot.slots : null;

  React.useEffect(() => {
    if (liveGoldSlots) goldSlotsRef.current = liveGoldSlots;
  }, [liveGoldSlots]);

  const ready = live.snapshot !== null;
  const { getNow } = live;

  React.useEffect(() => {
    if (explicitGame !== null || !ready) return;
    const check = () => {
      const next = dashboardGameForNow(goldSlotsRef.current, getNow());
      setAutoGame((prev) => (prev === next ? prev : next));
    };
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [explicitGame, ready, getNow, setAutoGame]);
}
