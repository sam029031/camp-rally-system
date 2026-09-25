import { describe, expect, it, vi } from "vitest";
import { codeForStatus, isRetryable, newClientRequestId, postApi, getApi } from "@/lib/client/api";
import { ERROR_MESSAGES } from "@/lib/errors";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** 依序回傳給定的結果；"network" = 丟錯、"hang" = 永不回應（直到被 abort） */
function scriptedFetch(script: Array<Response | "network" | "hang">) {
  const calls: FetchArgs[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push([input, init]);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === "network") throw new TypeError("Failed to fetch");
    if (step === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return step.clone();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const noDelay = () => 0;

describe("client api：重試策略（第二十八節）", () => {
  it("只有網路錯誤／逾時／5xx 可重試", () => {
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("server_error")).toBe(true);
    expect(isRetryable("client_error")).toBe(false);
    expect(isRetryable("ok")).toBe(false);
    expect(isRetryable("aborted")).toBe(false);
  });

  it("成功時直接回傳 server JSON，只打一次", async () => {
    const { fn, calls } = scriptedFetch([jsonResponse(200, { ok: true, status: "created", record: { id: "r1" } })]);
    const res = await postApi<{ ok: true; status: string } | { ok: false }>("/api/check", { clientRequestId: "abc" }, { retry: true, fetchImpl: fn, retryDelayMs: noDelay });
    expect(res).toMatchObject({ ok: true, status: "created" });
    expect(calls).toHaveLength(1);
  });

  it("5xx 後重試，且每次都送出同一個 body（同一個 clientRequestId）", async () => {
    const { fn, calls } = scriptedFetch([
      jsonResponse(500, { ok: false, code: "INTERNAL_ERROR", message: "boom" }),
      jsonResponse(200, { ok: true, status: "existing" }),
    ]);
    const res = await postApi("/api/check", { clientRequestId: "same-id", assignmentId: "a1" }, { retry: true, fetchImpl: fn, retryDelayMs: noDelay });
    expect(res).toMatchObject({ ok: true, status: "existing" });
    expect(calls).toHaveLength(2);
    expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
    expect(JSON.parse(String(calls[1][1]?.body)).clientRequestId).toBe("same-id");
  });

  it("網路錯誤最多重試 2 次（共 3 次），仍失敗回傳「網路中斷，請重新送出」", async () => {
    const { fn, calls } = scriptedFetch(["network"]);
    const res = await postApi("/api/check", { clientRequestId: "x" }, { retry: true, fetchImpl: fn, retryDelayMs: noDelay });
    expect(calls).toHaveLength(3);
    expect(res).toMatchObject({ ok: false, code: "NETWORK_ERROR", message: ERROR_MESSAGES.NETWORK_ERROR, transport: "network", attempts: 3 });
  });

  it("逾時視為可重試；全部逾時回傳 NETWORK_ERROR（transport = timeout）", async () => {
    const { fn, calls } = scriptedFetch(["hang"]);
    const res = await postApi("/api/check", { clientRequestId: "x" }, { retry: true, fetchImpl: fn, timeoutMs: 20, retryDelayMs: noDelay });
    expect(calls).toHaveLength(3);
    expect(res).toMatchObject({ ok: false, code: "NETWORK_ERROR", transport: "timeout" });
  });

  it("逾時一次後成功", async () => {
    const { fn, calls } = scriptedFetch(["hang", jsonResponse(200, { ok: true, status: "existing" })]);
    const res = await postApi("/api/check", { clientRequestId: "x" }, { retry: true, fetchImpl: fn, timeoutMs: 20, retryDelayMs: noDelay });
    expect(calls).toHaveLength(2);
    expect(res).toMatchObject({ ok: true });
  });

  it("4xx 不重試，直接回傳 server 的訊息", async () => {
    const { fn, calls } = scriptedFetch([jsonResponse(409, { ok: false, code: "SLOT_ALREADY_ENDED", message: "本時段已結束，請聯絡總召延長或取消本場。" })]);
    const res = await postApi("/api/check", { clientRequestId: "x" }, { retry: true, fetchImpl: fn, retryDelayMs: noDelay });
    expect(calls).toHaveLength(1);
    expect(res).toMatchObject({ ok: false, code: "SLOT_ALREADY_ENDED", message: "本時段已結束，請聯絡總召延長或取消本場。", transport: "client_error", httpStatus: 409 });
  });

  it("4xx 附帶原紀錄（ALREADY_RECORDED）時保留 record", async () => {
    const record = { id: "r9", recorded_at: "2026-10-17T01:10:18.000Z" };
    const { fn } = scriptedFetch([jsonResponse(409, { ok: false, code: "ALREADY_RECORDED", message: "已由另一裝置記錄。", record })]);
    const res = await postApi("/api/check", { clientRequestId: "x" }, { retry: true, fetchImpl: fn });
    expect(res).toMatchObject({ ok: false, code: "ALREADY_RECORDED", record });
  });

  it("4xx 沒有 JSON body 時依 HTTP status 對應 code 與中文訊息", async () => {
    const { fn } = scriptedFetch([new Response("forbidden", { status: 403 })]);
    const res = await postApi("/api/x", {}, { retry: true, fetchImpl: fn });
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN", message: ERROR_MESSAGES.FORBIDDEN });
  });

  it("retry: false 時網路錯誤不重試", async () => {
    const { fn, calls } = scriptedFetch(["network"]);
    const res = await postApi("/api/x", {}, { retry: false, fetchImpl: fn });
    expect(calls).toHaveLength(1);
    expect(res).toMatchObject({ ok: false, code: "NETWORK_ERROR", attempts: 1 });
  });

  it("5xx 沒有可讀內容（gateway HTML）重試用完後回傳 NETWORK_ERROR", async () => {
    const { fn, calls } = scriptedFetch([new Response("<html>504</html>", { status: 504 })]);
    const res = await postApi("/api/x", {}, { retry: true, fetchImpl: fn, retryDelayMs: noDelay });
    expect(calls).toHaveLength(3);
    expect(res).toMatchObject({ ok: false, code: "NETWORK_ERROR", httpStatus: 504, transport: "server_error" });
  });

  it("GET 預設會重試，且不帶 body", async () => {
    const { fn, calls } = scriptedFetch(["network", jsonResponse(200, { ok: true, session: null, appEnv: "development" })]);
    const res = await getApi("/api/auth/me", { fetchImpl: fn, retryDelayMs: noDelay });
    expect(res).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0][1]?.method).toBe("GET");
    expect(calls[0][1]?.body).toBeUndefined();
  });

  it("onAttempt 依序回報嘗試次數", async () => {
    const { fn } = scriptedFetch(["network", "network", jsonResponse(200, { ok: true })]);
    const seen: number[] = [];
    await postApi("/api/x", {}, { retry: true, fetchImpl: fn, retryDelayMs: noDelay, onAttempt: (n) => seen.push(n) });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("codeForStatus", () => {
    expect(codeForStatus(400)).toBe("INVALID_REQUEST");
    expect(codeForStatus(401)).toBe("UNAUTHORIZED");
    expect(codeForStatus(404)).toBe("NOT_FOUND");
    expect(codeForStatus(423)).toBe("LOGIN_LOCKED");
    expect(codeForStatus(502)).toBe("INTERNAL_ERROR");
  });

  it("newClientRequestId 產生 UUID v4，且每次不同", () => {
    const a = newClientRequestId();
    const b = newClientRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
