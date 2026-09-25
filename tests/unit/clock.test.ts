import { describe, expect, it } from "vitest";
import {
  REAL_CLOCK,
  appDurationForReal,
  clockSettingsFromEventRow,
  clockSettingsFromRpc,
  computeAppNow,
  computeServerOffset,
  demoBannerText,
  reanchorClock,
} from "@/lib/clock";
import type { ClockSettings, EventRow } from "@/lib/types";
import { deriveGame } from "@/lib/derive";
import { gold, t } from "./fixtures/game";

const REAL0 = Date.UTC(2026, 8, 1, 0, 0, 0); // 彩排當下的真實時間（任意）

describe("computeAppNow（第三十一節）", () => {
  it("Demo 關閉 → app 時間 = 真實時間", () => {
    expect(computeAppNow(REAL0, REAL_CLOCK)).toBe(REAL0);
    // 開關關閉時即使留有 anchor 也不採用
    expect(
      computeAppNow(REAL0 + 5000, { simEnabled: false, simSpeed: 10, simAnchorReal: REAL0, simAnchorVirtual: t("09:08") }),
    ).toBe(REAL0 + 5000);
  });

  it("Demo 開啟：anchor_virtual + (real − anchor_real) × speed", () => {
    const clock: ClockSettings = { simEnabled: true, simSpeed: 10, simAnchorReal: REAL0, simAnchorVirtual: t("09:08") };
    expect(computeAppNow(REAL0, clock)).toBe(t("09:08"));
    // 1 real minute = 10 simulated minutes
    expect(computeAppNow(REAL0 + 60_000, clock)).toBe(t("09:18"));
    expect(computeAppNow(REAL0 + 1_500, clock)).toBe(t("09:08:15"));
    expect(appDurationForReal(60_000, clock)).toBe(600_000);
    expect(appDurationForReal(60_000, REAL_CLOCK)).toBe(60_000);
  });

  it("改倍速時重設 anchor → 時間連續不跳動", () => {
    const x10: ClockSettings = { simEnabled: true, simSpeed: 10, simAnchorReal: REAL0, simAnchorVirtual: t("09:08") };
    const changeAt = REAL0 + 30_000; // app 09:13
    const before = computeAppNow(changeAt, x10);
    expect(before).toBe(t("09:13"));

    const x5 = reanchorClock(x10, changeAt, { enabled: true, speed: 5 });
    expect(x5.simAnchorReal).toBe(changeAt);
    expect(x5.simAnchorVirtual).toBe(before);
    expect(computeAppNow(changeAt, x5)).toBe(before);
    expect(computeAppNow(changeAt + 12_000, x5)).toBe(t("09:14"));

    // 跳到指定時刻
    const jumped = reanchorClock(x5, changeAt + 12_000, { enabled: true, speed: 10, jumpTo: t("13:03") });
    expect(computeAppNow(changeAt + 12_000, jumped)).toBe(t("13:03"));
    expect(computeAppNow(changeAt + 18_000, jumped)).toBe(t("13:04"));

    // 關閉 Demo → 回到真實時間
    const off = reanchorClock(jumped, changeAt + 20_000, { enabled: false, speed: 1 });
    expect(computeAppNow(changeAt + 25_000, off)).toBe(changeAt + 25_000);
  });

  it("Demo 倍速下推導正確（同一個 app 時鐘）", () => {
    const b = gold();
    b.stationIn(1, "A", "09:08:30");
    const snap = b.build();
    const clock: ClockSettings = { simEnabled: true, simSpeed: 10, simAnchorReal: REAL0, simAnchorVirtual: t("09:08") };
    // 真實 12 秒後 = app 09:10 → 開始計時
    let d = deriveGame(snap, computeAppNow(REAL0 + 12_000, clock));
    expect(d.assignments.get(b.aid(1, "A"))!.state).toBe("IN_PROGRESS");
    // 真實 1:42 後 = app 09:25 → 超時
    d = deriveGame(snap, computeAppNow(REAL0 + 102_000, clock));
    expect(d.assignments.get(b.aid(1, "A"))!.state).toBe("OVERTIME");
    // 真實 1:30 後 = app 09:23 → 即將結束
    d = deriveGame(snap, computeAppNow(REAL0 + 90_000, clock));
    expect(d.assignments.get(b.aid(1, "A"))!.state).toBe("ENDING_SOON");
  });
});

describe("設定轉換與校時", () => {
  it("clockSettingsFromEventRow / clockSettingsFromRpc", () => {
    const row = {
      sim_enabled: true,
      sim_speed: 10,
      sim_anchor_real: "2026-09-01T00:00:00Z",
      sim_anchor_virtual: "2026-10-17T01:08:00Z",
    } as unknown as EventRow;
    expect(clockSettingsFromEventRow(row)).toEqual({
      simEnabled: true,
      simSpeed: 10,
      simAnchorReal: Date.UTC(2026, 8, 1),
      simAnchorVirtual: t("09:08"),
    });
    expect(
      clockSettingsFromRpc({
        server_now: "2026-09-01T00:00:00Z",
        event_id: "e",
        app_now: "2026-09-01T00:00:00Z",
        sim_enabled: false,
        sim_speed: 1,
        sim_anchor_real: null,
        sim_anchor_virtual: null,
      }),
    ).toEqual(REAL_CLOCK);
  });

  it("computeServerOffset 以 RTT/2 修正", () => {
    // 本機 1000 送出、1200 收到，server 在中點 1100（本機時間）時是 5100 → offset = 4000
    expect(computeServerOffset(new Date(5100).toISOString(), 1000, 1200)).toBe(4000);
    expect(() => computeServerOffset("not-a-date", 0, 0)).toThrow();
  });

  it("DEMO 橫幅文字", () => {
    expect(demoBannerText(REAL_CLOCK)).toBeNull();
    expect(demoBannerText({ simEnabled: true, simSpeed: 10, simAnchorReal: 0, simAnchorVirtual: 0 })).toBe("DEMO 模式 ×10");
  });
});
