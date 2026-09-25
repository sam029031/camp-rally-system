/**
 * 撤銷重送判斷（第二十二節：回應遺失後重送，仍要回成功與提醒）。
 */
import { describe, expect, it } from "vitest";
import { isRecentOwnSelfUndo, parseUndoRetryClock, realMsSinceVoid } from "@/lib/server/undo-retry";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function clockAt(serverNow: string, extra: Partial<{ app_now: string; sim_enabled: boolean; sim_speed: number }> = {}) {
  const c = parseUndoRetryClock({
    server_now: serverNow,
    app_now: extra.app_now ?? serverNow,
    sim_enabled: extra.sim_enabled ?? false,
    sim_speed: extra.sim_speed ?? 1,
  });
  if (!c) throw new Error("clock");
  return c;
}

const voided = (at: string, by = ME, reason: string | null = "SELF_UNDO") => ({
  voided_at: at,
  voided_by: by,
  void_reason: reason,
});

describe("isRecentOwnSelfUndo", () => {
  const clock = clockAt("2026-09-26T01:30:00.000Z");

  it("本人 SELF_UNDO、90 秒內 → 視為重送成功", () => {
    expect(isRecentOwnSelfUndo(voided("2026-09-26T01:29:55.123456+00:00"), ME, clock)).toBe(true);
    expect(isRecentOwnSelfUndo(voided("2026-09-26T09:28:30+08:00"), ME, clock)).toBe(true);
  });

  it("超過 90 秒 → 維持 ALREADY_VOIDED", () => {
    expect(isRecentOwnSelfUndo(voided("2026-09-26T01:28:29.000Z"), ME, clock)).toBe(false);
  });

  it("別人撤銷、總召撤銷（理由不是 SELF_UNDO）、未撤銷 → 不算", () => {
    expect(isRecentOwnSelfUndo(voided("2026-09-26T01:29:55Z", OTHER), ME, clock)).toBe(false);
    expect(isRecentOwnSelfUndo(voided("2026-09-26T01:29:55Z", ME, "按錯"), ME, clock)).toBe(false);
    expect(isRecentOwnSelfUndo({ voided_at: null, voided_by: null, void_reason: null }, ME, clock)).toBe(false);
  });

  it("Demo 倍速：voided_at 是 app 時間，換算回真實時間", () => {
    // 10 倍速：app 經過 600 秒 = 真實 60 秒 → 算重送
    const sim = clockAt("2026-09-26T01:30:00Z", { app_now: "2026-09-26T03:00:00Z", sim_enabled: true, sim_speed: 10 });
    expect(realMsSinceVoid("2026-09-26T02:50:00Z", sim)).toBe(60_000);
    expect(isRecentOwnSelfUndo(voided("2026-09-26T02:50:00Z"), ME, sim)).toBe(true);
    // app 經過 1000 秒 = 真實 100 秒 → 不算
    expect(isRecentOwnSelfUndo(voided("2026-09-26T02:43:20Z"), ME, sim)).toBe(false);
  });

  it("get_clock 格式不對 → null", () => {
    expect(parseUndoRetryClock(null)).toBeNull();
    expect(parseUndoRetryClock({ server_now: "x", app_now: "2026-09-26T01:30:00Z" })).toBeNull();
    expect(parseUndoRetryClock([{ server_now: "2026-09-26T01:30:00Z", app_now: "2026-09-26T01:30:00Z" }])).not.toBeNull();
  });
});
