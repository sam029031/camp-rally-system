/**
 * 隊輔頁「已離開，抵達下一關」的目標判斷（第二十一節「上一關尚未關主出關時按本關進關：允許」、第三十四節突發 2）。
 */
import { describe, expect, it } from "vitest";
import { deriveGame } from "@/lib/derive";
import { leaveToNextTarget } from "@/app/team/_components/helpers";
import { gold, t, teamId, type SnapshotBuilder } from "./fixtures/game";

/** 第2小隊黃金路線：A（第1時段 09:10）→ C（第2時段 09:32）→ B（第3時段 09:54）… */
function target(b: SnapshotBuilder, slot: number, station: string, time: string, teamCheckedOut = false): string | null {
  const now = t(time);
  const d = deriveGame(b.build(), now);
  const td = d.teams.get(teamId(2))!;
  const cur = d.assignments.get(b.aid(slot, station))!;
  const next = leaveToNextTarget(d, td, cur, teamCheckedOut, now);
  return next ? `${next.slot.number}${next.station.code}` : null;
}

describe("leaveToNextTarget", () => {
  it("關卡進行中、隊輔沒按出關 → 不顯示", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    expect(target(b, 1, "A", "09:15")).toBeNull();
  });

  it("隊輔已在本關按確認出關、關主未出關 → 下一關 C", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamOut(1, "A", 2, "09:16");
    expect(target(b, 1, "A", "09:16", true)).toBe("2C");
  });

  it("到了本場正式結束時間（延長縮短後的結束）→ 下一關；結束前 → 不顯示", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.override(1, "A", "09:20");
    expect(target(b, 1, "A", "09:19:59")).toBeNull();
    expect(target(b, 1, "A", "09:20")).toBe("2C");
  });

  it("尚未開始計時：到時段預定結束（= 下一關開始前 7 分鐘）→ 下一關", () => {
    const b = gold();
    b.teamIn(1, "A", 2, "09:09");
    expect(target(b, 1, "A", "09:24:59")).toBeNull();
    expect(target(b, 1, "A", "09:25")).toBe("2C");
  });

  it("晚開始（正式結束晚於下一關開始前 7 分鐘）：到下一關開始前 7 分鐘就顯示", () => {
    const b = gold();
    b.stationIn(1, "A", "09:13");
    // official_end = 09:28；下一關 C 09:32 − 7 分 = 09:25
    expect(target(b, 1, "A", "09:24:59")).toBeNull();
    expect(target(b, 1, "A", "09:25")).toBe("2C");
  });

  it("本關關主已出關 → 不顯示", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    expect(target(b, 1, "A", "09:26", true)).toBeNull();
  });

  it("下一關被取消 → 跳到再下一關 B", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.cancel(2, "C");
    expect(target(b, 1, "A", "09:26")).toBe("3B");
  });

  it("最後一關 → 沒有下一關", () => {
    const b = gold();
    b.stationIn(8, "H", "11:44");
    expect(target(b, 8, "H", "12:30", true)).toBeNull();
  });
});
