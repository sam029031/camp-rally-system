/**
 * 前端呼叫 Route Handler 的共用函式（第二十八節）。
 *
 * - 每次嘗試 8 秒逾時（真實時間，不乘 Demo 倍速）。
 * - 網路錯誤／逾時／5xx：用「同一個 body」（含同一個 clientRequestId）自動重試，最多 2 次。
 * - 4xx（規則拒絕、權限、session）：不重試，直接回傳 server 的訊息。
 * - 最後仍失敗：回傳 NETWORK_ERROR「網路中斷，請重新送出」，由呼叫端恢復按鈕；絕不假裝成功。
 *
 * 這個檔案不依賴 React，也可以在 Node（Vitest）裡用 mock fetch 測試。
 */

import type { ApiError } from "@/lib/api/contract";
import { SUBMIT_MAX_RETRIES, SUBMIT_TIMEOUT_MS } from "@/lib/constants";
import { ERROR_MESSAGES, errorMessage, isErrorCode, type ErrorCode } from "@/lib/errors";

/** 單次嘗試的結果分類 */
export type AttemptKind = "ok" | "client_error" | "server_error" | "network" | "timeout" | "aborted";

/** 前端額外附上的傳輸資訊（不在合約內，只給 UI 判斷用） */
export type ClientApiError = ApiError & {
  /** 失敗的原因：client_error = 4xx；server_error = 5xx；network / timeout = 沒拿到回應 */
  transport: Exclude<AttemptKind, "ok">;
  /** HTTP status（沒拿到回應為 null） */
  httpStatus: number | null;
  /** 總共嘗試了幾次（含第一次） */
  attempts: number;
};

export interface RequestOptions {
  /** 是否在網路錯誤／逾時／5xx 時自動重試（POST 預設 false，GET 預設 true） */
  retry?: boolean;
  /** 單次嘗試逾時（預設 SUBMIT_TIMEOUT_MS = 8 秒） */
  timeoutMs?: number;
  /** 最多重試次數（預設 SUBMIT_MAX_RETRIES = 2） */
  maxRetries?: number;
  /** 第 n 次重試前等待的毫秒數（n 從 1 開始） */
  retryDelayMs?: (retryNumber: number) => number;
  /** 測試用：替換 fetch */
  fetchImpl?: typeof fetch;
  /** 呼叫端取消（例如元件卸載）；取消後不再重試 */
  signal?: AbortSignal;
  /** 每次嘗試開始前呼叫（attempt 從 1 開始），UI 可顯示「重試中」 */
  onAttempt?: (attempt: number) => void;
}

/** session 失效時廣播，use-session 會接收並清掉本機 session 狀態 */
export const SESSION_EXPIRED_EVENT = "camp:session-expired";

const DEFAULT_RETRY_DELAY = (n: number) => (n === 1 ? 600 : 1_500);

/** 重試策略（純函式）：只有沒拿到回應或 5xx 才重試 */
export function isRetryable(kind: AttemptKind): boolean {
  return kind === "network" || kind === "timeout" || kind === "server_error";
}

/** 4xx 沒有 JSON body 時，用 HTTP status 對應 error code */
export function codeForStatus(status: number): ErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 423) return "LOGIN_LOCKED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "INVALID_REQUEST";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface AttemptResult {
  kind: AttemptKind;
  status: number | null;
  body: unknown;
}

async function attemptOnce(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<AttemptResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      // 非 JSON（例如 gateway 的 HTML 錯誤頁）
      body = null;
    }
    if (res.status >= 500) return { kind: "server_error", status: res.status, body };
    if (res.status >= 400) return { kind: "client_error", status: res.status, body };
    if (body && typeof body === "object") return { kind: "ok", status: res.status, body };
    // 2xx 但不是 JSON：視為 server 錯誤（可重試）
    return { kind: "server_error", status: res.status, body: null };
  } catch {
    if (outer?.aborted) return { kind: "aborted", status: null, body: null };
    return { kind: timedOut ? "timeout" : "network", status: null, body: null };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

function readApiError(body: unknown): { code: ErrorCode; message: string | null; record?: ApiError["record"] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { ok?: unknown; code?: unknown; message?: unknown; record?: unknown };
  if (b.ok !== false || !isErrorCode(b.code)) return null;
  return {
    code: b.code,
    message: typeof b.message === "string" && b.message.trim() ? b.message : null,
    record: (b.record as ApiError["record"]) ?? undefined,
  };
}

function toClientError(result: AttemptResult, attempts: number): ClientApiError {
  const kind = result.kind === "ok" ? "server_error" : result.kind;
  if (kind === "network" || kind === "timeout" || kind === "aborted") {
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: ERROR_MESSAGES.NETWORK_ERROR,
      transport: kind,
      httpStatus: null,
      attempts,
    };
  }
  const parsed = readApiError(result.body);
  const status = result.status ?? 500;
  if (kind === "server_error" && !parsed) {
    // 沒有可讀的錯誤內容（例如 502/504 HTML）→ 對使用者而言就是網路問題
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: ERROR_MESSAGES.NETWORK_ERROR,
      transport: kind,
      httpStatus: status,
      attempts,
    };
  }
  const code = parsed?.code ?? codeForStatus(status);
  const err: ClientApiError = {
    ok: false,
    code,
    message: parsed?.message ?? errorMessage(code),
    transport: kind,
    httpStatus: status,
    attempts,
  };
  if (parsed?.record !== undefined) err.record = parsed.record;
  return err;
}

function broadcastSessionExpired(code: ErrorCode): void {
  if (code !== "SESSION_EXPIRED" && code !== "UNAUTHORIZED") return;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { code } }));
  } catch {
    // 忽略（非瀏覽器環境）
  }
}

/**
 * 送出請求並依第二十八節規則重試。
 * 回傳 server 的 JSON（ok: true 或 ok: false），或前端組出的 ClientApiError。
 */
export async function requestApi<T extends { ok: boolean }>(
  method: "GET" | "POST",
  url: string,
  body: unknown,
  opts: RequestOptions = {},
): Promise<T | ClientApiError> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? SUBMIT_TIMEOUT_MS;
  const retry = opts.retry ?? method === "GET";
  const maxRetries = retry ? Math.max(0, opts.maxRetries ?? SUBMIT_MAX_RETRIES) : 0;
  const delay = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY;

  // 同一個字串 body 用在每一次嘗試（重試沿用同一個 clientRequestId）
  const init: RequestInit = {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: method === "POST" ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  };

  let last: AttemptResult = { kind: "network", status: null, body: null };
  let attempts = 0;
  for (let i = 0; i <= maxRetries; i++) {
    if (i > 0) {
      await sleep(delay(i), opts.signal);
      if (opts.signal?.aborted) break;
    }
    attempts = i + 1;
    opts.onAttempt?.(attempts);
    last = await attemptOnce(fetchImpl, url, init, timeoutMs, opts.signal);
    if (last.kind === "ok") return last.body as T;
    if (last.kind === "aborted" || !isRetryable(last.kind)) break;
  }

  const err = toClientError(last, attempts);
  if (err.transport === "client_error") broadcastSessionExpired(err.code);
  return err;
}

/** POST JSON。打卡等寫入請傳 { retry: true }，並確保 body 內含固定的 clientRequestId。 */
export function postApi<T extends { ok: boolean }>(url: string, body: unknown, opts?: RequestOptions): Promise<T | ClientApiError> {
  return requestApi<T>("POST", url, body, opts);
}

/** GET JSON（預設會重試）。 */
export function getApi<T extends { ok: boolean }>(url: string, opts?: RequestOptions): Promise<T | ClientApiError> {
  return requestApi<T>("GET", url, undefined, opts);
}

/** 型別守衛：是否為前端組出的錯誤（含傳輸資訊） */
export function isClientApiError(x: unknown): x is ClientApiError {
  return !!x && typeof x === "object" && (x as { ok?: unknown }).ok === false && "transport" in (x as object);
}

/** 產生 clientRequestId（UUID v4）；舊瀏覽器沒有 randomUUID 時用 getRandomValues 組 */
export function newClientRequestId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
