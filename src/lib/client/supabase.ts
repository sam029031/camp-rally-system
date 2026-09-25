"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { READ_TIMEOUT_MS } from "@/lib/constants";

/**
 * 瀏覽器端 Supabase client（第二十節：前端只用 URL + anon key 做讀取與 Realtime 訂閱）。
 *
 * - 單例：整個分頁共用一個 client，也就共用一條 Realtime WebSocket。
 * - 不使用 Supabase Auth：登入走 Route Handler + cookie session，所以不保存、不刷新 auth session。
 * - 所有寫入都走 /api/*（server 用 service role），這個 client 只能讀。
 */

let browserClient: SupabaseClient | null = null;

/**
 * 讀取逾時。name 用 "AbortError"：postgrest-js 不會重試被中止的請求，
 * 直接回 { error }，讓 loadGameSnapshot / 校時失敗、釋放「同時只跑一個」的鎖，下一次重抓才跑得動。
 */
export class ReadTimeoutError extends Error {
  readonly code = "ABORT_ERR";
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`讀取逾時（超過 ${Math.round(timeoutMs / 1000)} 秒），稍後會自動重試。`);
    this.name = "AbortError";
    this.timeoutMs = timeoutMs;
  }
}

/** 沒有 body 的 HTTP 狀態（new Response 帶 body 會丟例外） */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * 包一層 fetch：整個請求（含讀完 body）超過 timeoutMs 就中止並丟 ReadTimeoutError。
 * - 呼叫端的 AbortSignal 手動串接（不用 AbortSignal.any / AbortSignal.timeout：舊版 iOS Safari 沒有）。
 * - body 在計時內讀完再包成新的 Response：只等到 headers 的話，body 卡住仍會無限期等待。
 *   Supabase REST 回應都是小 JSON，全部讀進記憶體沒有問題。
 */
export function createTimeoutFetch(baseFetch: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const callerSignal = init?.signal ?? null;
    let timedOut = false;

    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const res = await baseFetch(input, { ...init, signal: controller.signal });
      const body = NULL_BODY_STATUSES.has(res.status) ? null : await res.arrayBuffer();
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      if (timedOut) throw new ReadTimeoutError(timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}

export class SupabaseConfigError extends Error {
  constructor() {
    super("缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY，請檢查 .env.local 後重新啟動。");
    this.name = "SupabaseConfigError";
  }
}

export function getBrowserSupabase(): SupabaseClient {
  if (browserClient) return browserClient;

  // 注意：NEXT_PUBLIC_* 必須寫成完整的 process.env.X 才會在 build 時被內嵌
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new SupabaseConfigError();

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      // 全天事件只有幾百筆，收到事件一律重抓完整快照；限制一下每秒事件數避免異常時洗版
      params: { eventsPerSecond: 20 },
      // 手機網路不穩：心跳短一點，較快發現斷線並重連（重連後 SUBSCRIBED 會觸發重抓，第二十七節）
      heartbeatIntervalMs: 15_000,
      reconnectAfterMs: (tries: number) => [1_000, 2_000, 5_000, 10_000][tries - 1] ?? 10_000,
      timeout: 10_000,
    },
    global: {
      // Supabase REST 讀取一律不快取（第二節：不可看到舊狀態）；10 秒讀取逾時（第二十七節）
      fetch: createTimeoutFetch((input, init) => fetch(input, { ...init, cache: "no-store" }), READ_TIMEOUT_MS),
    },
  });
  return browserClient;
}
