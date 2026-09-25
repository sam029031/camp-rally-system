import { afterEach, describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatDurationText,
  formatHm,
  formatHmRange,
  formatHms,
  formatSignedDuration,
  msToTaipeiDate,
  msToTaipeiTimeInput,
  taipeiLocalToMs,
} from "@/lib/time";

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("Asia/Taipei 格式化（第二十三節）", () => {
  it("UTC 輸入 → 台北時間 HH:mm:ss / HH:mm", () => {
    const ms = Date.UTC(2026, 9, 17, 1, 10, 5); // 2026-10-17 09:10:05 +08:00
    expect(formatHms(ms)).toBe("09:10:05");
    expect(formatHm(ms)).toBe("09:10");
    expect(msToTaipeiTimeInput(ms)).toBe("09:10:05");
    expect(msToTaipeiDate(ms)).toBe("2026-10-17");
  });

  it("跨日：UTC 16:00 = 台北隔天 00:00", () => {
    const ms = Date.UTC(2026, 9, 16, 16, 0, 0);
    expect(formatHms(ms)).toBe("00:00:00");
    expect(msToTaipeiDate(ms)).toBe("2026-10-17");
    expect(msToTaipeiDate(ms - 1)).toBe("2026-10-16");
    expect(formatHms(ms - 1000)).toBe("23:59:59");
  });

  it("不受執行環境時區影響（process.env.TZ 改成其他時區）", () => {
    const ms = Date.UTC(2026, 9, 17, 5, 29, 8);
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Europe/London"]) {
      process.env.TZ = tz;
      expect(formatHms(ms)).toBe("13:29:08");
      expect(msToTaipeiDate(ms)).toBe("2026-10-17");
      expect(taipeiLocalToMs("2026-10-17", "13:29:08")).toBe(ms);
    }
  });

  it("taipeiLocalToMs：event_date + HH:mm 視為 +08:00", () => {
    expect(taipeiLocalToMs("2026-10-17", "09:10")).toBe(Date.UTC(2026, 9, 17, 1, 10, 0));
    expect(taipeiLocalToMs("2026-10-17", "09:10:30")).toBe(Date.UTC(2026, 9, 17, 1, 10, 30));
    expect(taipeiLocalToMs("2026-10-17", "00:30")).toBe(Date.UTC(2026, 9, 16, 16, 30, 0));
    expect(taipeiLocalToMs("2026-10-17", "9:05")).toBe(Date.UTC(2026, 9, 17, 1, 5, 0));
  });

  it("taipeiLocalToMs：格式錯誤一律 throw", () => {
    expect(() => taipeiLocalToMs("2026/10/17", "09:10")).toThrow();
    expect(() => taipeiLocalToMs("2026-10-17", "9點")).toThrow();
    expect(() => taipeiLocalToMs("2026-02-30", "09:10")).toThrow();
    expect(() => taipeiLocalToMs("2026-10-17", "24:00")).toThrow();
  });

  it("formatHmRange 用 en dash", () => {
    expect(formatHmRange(taipeiLocalToMs("2026-10-17", "09:10"), taipeiLocalToMs("2026-10-17", "09:25"))).toBe(
      "09:10–09:25",
    );
  });
});

describe("formatCountdown", () => {
  it("正數 ceil 秒、0 顯示 00:00", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(1)).toBe("00:01");
    expect(formatCountdown(999)).toBe("00:01");
    expect(formatCountdown(1000)).toBe("00:01");
    expect(formatCountdown(1001)).toBe("00:02");
    expect(formatCountdown(900_000)).toBe("15:00");
    expect(formatCountdown(503_000)).toBe("08:23");
  });

  it("負數取絕對值、floor 秒（超時 0.2 秒就顯示 00:01）", () => {
    expect(formatCountdown(-1)).toBe("00:01");
    expect(formatCountdown(-1000)).toBe("00:01");
    expect(formatCountdown(-1001)).toBe("00:02");
    expect(formatCountdown(-84_000)).toBe("01:24");
  });

  it(">= 1 小時用 H:MM:SS", () => {
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
    expect(formatCountdown(-3_725_000)).toBe("1:02:05");
    expect(formatCountdown(3_599_000)).toBe("59:59");
  });

  it("非有限數字不 throw", () => {
    expect(formatCountdown(Number.NaN)).toBe("--:--");
  });
});

describe("formatSignedDuration（較預定）", () => {
  it("正數 +、負數 -、0 為 +00:00", () => {
    expect(formatSignedDuration(18_000)).toBe("+00:18");
    expect(formatSignedDuration(18_900)).toBe("+00:18");
    expect(formatSignedDuration(-65_000)).toBe("-01:05");
    expect(formatSignedDuration(0)).toBe("+00:00");
    expect(formatSignedDuration(3_725_000)).toBe("+1:02:05");
  });
});

describe("formatDurationText", () => {
  it("中文長度", () => {
    expect(formatDurationText(600_000)).toBe("10 分鐘");
    expect(formatDurationText(-600_000)).toBe("10 分鐘");
    expect(formatDurationText(90_000)).toBe("1 分 30 秒");
    expect(formatDurationText(45_000)).toBe("45 秒");
    expect(formatDurationText(3_900_000)).toBe("1 小時 5 分鐘");
    expect(formatDurationText(3_600_000)).toBe("1 小時");
  });
});
