/**
 * 前端 Supabase fetch 讀取逾時（第二十七節：卡住的讀取要失敗，下一次重抓才跑得動）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimeoutFetch, ReadTimeoutError } from "@/lib/client/supabase";

/** 一個永遠不回應、但會尊重 signal 的 fetch */
function hangingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")));
    });
}

describe("createTimeoutFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常回應：內容、狀態、headers 原樣保留", async () => {
    const base = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/1" } }),
    );
    const f = createTimeoutFetch(base, 10_000);
    const res = await f("https://x.test/rest/v1/games", { method: "GET", headers: { a: "b" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBe("0-0/1");
    expect(await res.json()).toEqual({ ok: 1 });
    expect(base.mock.calls[0][1]?.headers).toEqual({ a: "b" });
    expect(base.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("204 沒有 body 也能包成 Response", async () => {
    const f = createTimeoutFetch(async () => new Response(null, { status: 204 }), 10_000);
    const res = await f("https://x.test/rest/v1/rpc/x");
    expect(res.status).toBe(204);
  });

  it("超過逾時 → 以 ReadTimeoutError（name = AbortError，postgrest 不重試）失敗", async () => {
    const f = createTimeoutFetch(hangingFetch(), 10_000);
    const p = f("https://x.test/rest/v1/games");
    const assertion = expect(p).rejects.toBeInstanceOf(ReadTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    await expect(p).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
  });

  it("body 讀到一半卡住也會逾時", async () => {
    const base: typeof fetch = async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
        },
      });
      return new Response(stream, { status: 200 });
    };
    const f = createTimeoutFetch(base, 10_000);
    const p = f("https://x.test/rest/v1/games");
    const assertion = expect(p).rejects.toBeInstanceOf(ReadTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("呼叫端 AbortSignal 會串接（不是逾時錯誤）；已中止的 signal 立即中止", async () => {
    const f = createTimeoutFetch(hangingFetch(), 10_000);
    const caller = new AbortController();
    const p = f("https://x.test/rest/v1/games", { signal: caller.signal });
    const assertion = expect(p).rejects.not.toBeInstanceOf(ReadTimeoutError);
    caller.abort();
    await assertion;

    const pre = new AbortController();
    pre.abort();
    await expect(f("https://x.test/rest/v1/games", { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("成功後清掉計時器（不殘留 timer）", async () => {
    const f = createTimeoutFetch(async () => new Response("[]", { status: 200 }), 10_000);
    await f("https://x.test/rest/v1/games");
    expect(vi.getTimerCount()).toBe(0);
  });
});
