import { describe, expect, it } from "vitest";
import {
  endOfTaipeiDayMs,
  formatDbTimestampTaipei,
  formatTaipeiDateTime,
  isValidDateString,
  parseDbTimestamp,
  parseTimeOfDay,
  resolveJumpTo,
  taipeiDateTimeToIso,
  taipeiDateTimeToMs,
} from "@/lib/server/time-input";

describe("START_AT / 跳時間：活動日 'HH:mm' 一律視為 +08:00（第二十三節）", () => {
  it("第1時段從 09:20 開始 → UTC 01:20", () => {
    expect(taipeiDateTimeToIso("2026-10-17", "09:20")).toBe("2026-10-17T01:20:00.000Z");
  });

  it("接受 HH:mm:ss", () => {
    expect(taipeiDateTimeToMs("2026-10-17", "13:03:30")).toBe(Date.parse("2026-10-17T05:03:30Z"));
  });

  it("台北凌晨 → UTC 前一天", () => {
    expect(taipeiDateTimeToIso("2026-10-17", "00:30")).toBe("2026-10-16T16:30:00.000Z");
  });

  it("格式錯誤丟錯", () => {
    expect(() => taipeiDateTimeToMs("2026-10-17", "9:20")).toThrow();
    expect(() => taipeiDateTimeToMs("2026-10-17", "24:00")).toThrow();
    expect(() => taipeiDateTimeToMs("2026/10/17", "09:20")).toThrow();
  });

  it("resolveJumpTo：HH:mm 或 ISO", () => {
    expect(resolveJumpTo("2026-10-17", "09:08")).toBe("2026-10-17T01:08:00.000Z");
    expect(resolveJumpTo("2026-10-17", "2026-10-17T13:03:00+08:00")).toBe("2026-10-17T05:03:00.000Z");
  });

  it("活動日最後一秒", () => {
    expect(endOfTaipeiDayMs("2026-10-17")).toBe(Date.parse("2026-10-17T15:59:59Z"));
  });
});

describe("parseTimeOfDay / isValidDateString", () => {
  it("時間", () => {
    expect(parseTimeOfDay("09:54")).toEqual({ h: 9, m: 54, s: 0 });
    expect(parseTimeOfDay(" 23:59:59 ")).toEqual({ h: 23, m: 59, s: 59 });
    expect(parseTimeOfDay("9:54")).toBeNull();
    expect(parseTimeOfDay("12:60")).toBeNull();
    expect(parseTimeOfDay("2026-10-17T09:00:00Z")).toBeNull();
  });

  it("日期", () => {
    expect(isValidDateString("2026-10-17")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2026-1-7")).toBe(false);
  });
});

describe("DB 時間解析與 CSV 顯示（Asia/Taipei）", () => {
  it("6 位小數與空白分隔都能解析", () => {
    expect(parseDbTimestamp("2026-10-17T01:10:18.123456+00:00")).toBe(Date.parse("2026-10-17T01:10:18.123Z"));
    expect(parseDbTimestamp("2026-10-17 01:10:18+00:00")).toBe(Date.parse("2026-10-17T01:10:18Z"));
    expect(parseDbTimestamp(null)).toBeNull();
    expect(parseDbTimestamp("garbage")).toBeNull();
  });

  it("formatTaipeiDateTime 不受執行環境時區影響", () => {
    expect(formatTaipeiDateTime(Date.parse("2026-10-17T01:10:18Z"))).toBe("2026-10-17 09:10:18");
    expect(formatTaipeiDateTime(Date.parse("2026-10-17T16:00:00Z"))).toBe("2026-10-18 00:00:00");
    expect(formatDbTimestampTaipei("2026-10-17T05:05:00+00:00")).toBe("2026-10-17 13:05:00");
    expect(formatDbTimestampTaipei(null)).toBe("");
  });
});
