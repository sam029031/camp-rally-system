"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { deriveGame } from "@/lib/derive";
import type { DerivedGame } from "@/lib/derive/types";
import { loadGameSnapshot } from "@/lib/data/snapshot";
import { POLL_INTERVAL_MS, REFETCH_DEBOUNCE_MS } from "@/lib/constants";
import type { GameCode, GameSnapshot } from "@/lib/types";
import { applyClockSettings, realNow as clockRealNow } from "@/lib/client/clock-store";
import { isDataStale, type ChannelStatus, type LiveStatus } from "@/lib/client/live-status";
import { getBrowserSupabase } from "@/lib/client/supabase";
import { useClock } from "@/lib/client/use-clock";
import { useOnline } from "@/lib/client/use-online";

export type { ChannelStatus, LiveStatus } from "@/lib/client/live-status";

/** useLiveGame 的回傳（docs/ARCHITECTURE.md 第 6 節） */
export interface LiveGame {
  /** 最近一次成功抓到的完整快照；第一次載入完成前為 null */
  snapshot: GameSnapshot | null;
  /** deriveGame(snapshot, now)，每個 tick 重算 */
  derived: DerivedGame | null;
  /** app 時間（每秒更新） */
  now: number;
  /** 事件處理用：當下 app 時間 */
  getNow: () => number;
  /** 校正後真實時間（撤銷 60 秒倒數用） */
  realNow: () => number;
  status: LiveStatus;
  /** 立即重抓完整快照（打卡成功後、通知建立後可呼叫） */
  refetch: () => Promise<void>;
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return msg ? `讀取資料失敗：${msg}` : "讀取資料失敗，稍後會自動重試。";
}

/**
 * 即時遊戲資料（第二十七、二十八節）。
 *
 * - 一個 hook = 一個 Realtime channel（整頁只呼叫一次；不要每張卡片各開一個）。
 * - postgres_changes：check_records、notifications、schedule_adjustments、assignment_cancellations、
 *   assignment_end_overrides 不加 filter；games 用 id=eq.<gameId>；events 用 id=eq.<eventId>。
 * - 收到事件 / channel SUBSCRIBED（含 reconnect）/ 回到前景 / 重新上線 → debounce 後重抓完整快照；
 *   另外每 30 秒輪詢一次。Realtime payload 只當「有變動」的提示，不做增量修改。
 * - 狀態一律由 deriveGame(snapshot, appNow) 推導。
 */
export function useLiveGame(gameCode: GameCode): LiveGame {
  const [data, setData] = useState<{ code: GameCode; snapshot: GameSnapshot } | null>(null);
  const [fetchInfo, setFetchInfo] = useState<{ code: GameCode; lastOkAt: number | null; error: string | null }>({
    code: gameCode,
    lastOkAt: null,
    error: null,
  });
  const [channelInfo, setChannelInfo] = useState<{ key: string; status: ChannelStatus } | null>(null);
  const [startedAt] = useState(() => clockRealNow());
  const online = useOnline();

  // 切換遊戲時，舊遊戲的快照不再顯示（不在 effect 裡 setState，直接在 render 判斷）
  const snapshot = data && data.code === gameCode ? data.snapshot : null;
  const gameId = snapshot?.game.id ?? null;
  const eventId = snapshot?.event.id ?? null;

  const clock = useClock(eventId);

  // ---- 抓取（每個 gameCode 一組控制器） ----
  const loaderRef = useRef<{ code: GameCode; request: () => Promise<void> } | null>(null);

  useEffect(() => {
    let disposed = false;
    let running: Promise<void> | null = null;
    let queued = false;

    const runOnce = async (): Promise<void> => {
      try {
        const snap = await loadGameSnapshot(getBrowserSupabase(), { gameCode });
        if (disposed) return;
        applyClockSettings(snap.event.clock);
        setData({ code: gameCode, snapshot: snap });
        setFetchInfo({ code: gameCode, lastOkAt: clockRealNow(), error: null });
      } catch (e) {
        if (disposed) return;
        console.error("[useLiveGame] 快照讀取失敗", e);
        setFetchInfo((prev) => ({
          code: gameCode,
          lastOkAt: prev.code === gameCode ? prev.lastOkAt : null,
          error: describeError(e),
        }));
      }
    };

    // 同時只跑一個請求；跑的期間又被要求重抓 → 結束後再抓一次（合併成一次）
    const request = (): Promise<void> => {
      if (disposed) return Promise.resolve();
      if (running) {
        queued = true;
        return running;
      }
      running = (async () => {
        do {
          queued = false;
          await runOnce();
        } while (queued && !disposed);
        running = null;
      })();
      return running;
    };

    loaderRef.current = { code: gameCode, request };
    void request();

    const poll = setInterval(() => void request(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    const onOnline = () => void request();
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      disposed = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      if (loaderRef.current?.request === request) loaderRef.current = null;
    };
  }, [gameCode]);

  const refetch = useCallback((): Promise<void> => {
    const loader = loaderRef.current;
    return loader ? loader.request() : Promise.resolve();
  }, []);

  // ---- Realtime：一個 channel ----
  const channelKey = gameId && eventId ? `${gameId}:${eventId}` : null;

  useEffect(() => {
    if (!gameId || !eventId) return;
    const key = `${gameId}:${eventId}`;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const scheduleRefetch = () => {
      if (disposed) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void loaderRef.current?.request();
      }, REFETCH_DEBOUNCE_MS);
    };

    const supabase = getBrowserSupabase();
    // topic 加亂數：同一分頁切換遊戲時，新舊 channel 不會撞名
    const topic = `live:${gameId}:${Math.random().toString(36).slice(2, 10)}`;
    const channel: RealtimeChannel = supabase.channel(topic);
    const unfilteredTables = [
      "check_records",
      "notifications",
      "schedule_adjustments",
      "assignment_cancellations",
      "assignment_end_overrides",
    ] as const;
    for (const table of unfilteredTables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefetch);
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, scheduleRefetch);
    channel.on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `id=eq.${eventId}` }, scheduleRefetch);

    channel.subscribe((status, err) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        setChannelInfo({ key, status: "subscribed" });
        // 第一次訂閱與每次重連都重抓（重連期間漏掉的事件不會補送）
        scheduleRefetch();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (err) console.warn("[useLiveGame] Realtime 錯誤", err);
        setChannelInfo({ key, status: "error" });
      } else if (status === "CLOSED") {
        setChannelInfo({ key, status: "closed" });
      }
    });

    return () => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [gameId, eventId]);

  // ---- 推導 ----
  const now = clock.now;
  const derivedResult = useMemo((): { derived: DerivedGame | null; error: string | null } => {
    if (!snapshot || now <= 0) return { derived: null, error: null };
    try {
      return { derived: deriveGame(snapshot, now), error: null };
    } catch (e) {
      return { derived: null, error: `狀態計算失敗：${e instanceof Error ? e.message : String(e)}` };
    }
  }, [snapshot, now]);

  // 每秒重算：同一個推導錯誤只記錄一次，避免洗版
  const deriveError = derivedResult.error;
  useEffect(() => {
    if (deriveError) console.error("[useLiveGame]", deriveError);
  }, [deriveError]);

  const lastOkAt = fetchInfo.code === gameCode ? fetchInfo.lastOkAt : null;
  const fetchError = fetchInfo.code === gameCode ? fetchInfo.error : null;
  const channel: ChannelStatus = channelInfo && channelInfo.key === channelKey ? channelInfo.status : "connecting";
  // 切換遊戲、新遊戲還沒抓到時，以上一次任何成功抓取的時間為基準，避免一瞬間誤顯示「資料可能過期」
  const stale = !online || isDataStale(lastOkAt ?? fetchInfo.lastOkAt, clock.real, startedAt);

  const status: LiveStatus = {
    online,
    channel,
    lastFetchOkAt: lastOkAt,
    stale,
    error: fetchError ?? derivedResult.error,
  };

  return {
    snapshot,
    derived: derivedResult.derived,
    now,
    getNow: clock.getNow,
    realNow: clock.realNow,
    status,
    refetch,
  };
}

/**
 * 一次性讀取另一個遊戲的快照（不開 channel、不輪詢）。
 * 用途：隊輔頁在黃金完成後顯示「下午大地第一站」（第十六節，只顯示不倒數）。
 *
 * @param gameCode 要讀的遊戲
 * @param enabled false 時不讀取（例如還不需要顯示時）
 */
export function useSchedulePeek(
  gameCode: GameCode,
  enabled = true,
): { snapshot: GameSnapshot | null; loading: boolean; error: string | null; refetch: () => void } {
  const [result, setResult] = useState<{ code: GameCode; snapshot: GameSnapshot | null; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    loadGameSnapshot(getBrowserSupabase(), { gameCode })
      .then((snap) => {
        if (!disposed) setResult({ code: gameCode, snapshot: snap, error: null });
      })
      .catch((e: unknown) => {
        if (!disposed) setResult({ code: gameCode, snapshot: null, error: describeError(e) });
      });
    return () => {
      disposed = true;
    };
  }, [gameCode, enabled, nonce]);

  const current = result && result.code === gameCode ? result : null;
  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return {
    snapshot: current?.snapshot ?? null,
    loading: enabled && !current,
    error: current?.error ?? null,
    refetch,
  };
}
