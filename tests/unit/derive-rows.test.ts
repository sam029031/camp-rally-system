/**
 * Dashboard 關卡列、格子與摘要（第十一、十三節）。
 */
import { describe, expect, it } from "vitest";
import { deriveGame, stationRowsForSlot } from "@/lib/derive";
import { gold, land, t, type SnapshotBuilder } from "./fixtures/game";

function rows(b: SnapshotBuilder, time: string, slot: number) {
  const snap = b.build();
  const d = deriveGame(snap, t(time));
  return { d, rows: stationRowsForSlot(snap, d, slot) };
}

function byCode<T extends { station: { code: string } }>(list: T[], code: string): T {
  const r = list.find((x) => x.station.code === code);
  if (!r) throw new Error(`沒有 ${code}`);
  return r;
}

describe("大地休息（第十三節、第三十四節驗收 6）", () => {
  it("第1時段 E G J 休息；小字顯示下一組", () => {
    const b = land();
    const { rows: r } = rows(b, "13:10", 1);
    const rest = r.filter((x) => x.primaryAssignmentId === null).map((x) => x.station.code);
    expect(rest).toEqual(["E", "G", "J"]);
    expect(byCode(r, "E").nextAssignmentIdWhenRest).toBe(b.aid(2, "E"));
    expect(byCode(r, "J").nextAssignmentIdWhenRest).toBe(b.aid(2, "J"));
    expect(byCode(r, "A").nextAssignmentIdWhenRest).toBeNull();
  });

  it("第2時段 A B I 休息（第1時段都已出關）", () => {
    const b = land();
    for (const code of ["A", "B", "C", "D", "F", "H", "I"]) {
      b.stationIn(1, code, "13:05");
      b.stationOut(1, code, "13:25");
    }
    const { rows: r } = rows(b, "13:40", 2);
    expect(r.filter((x) => x.primaryAssignmentId === null).map((x) => x.station.code)).toEqual(["A", "B", "I"]);
    expect(byCode(r, "A").nextAssignmentIdWhenRest).toBe(b.aid(3, "A"));
    expect(byCode(r, "A").previousNoShowPendingAssignmentId).toBeNull();
    expect(byCode(r, "A").isAnomaly).toBe(false);
  });

  it("grid：沒有 assignment 的格子 = REST", () => {
    const d = deriveGame(land().build(), t("13:00"));
    expect(d.grid).toHaveLength(8);
    expect(d.grid[0]).toHaveLength(10);
    expect(d.grid[0].filter((c) => c.state === "REST").map((c) => c.stationId)).toEqual([
      "land-st-E",
      "land-st-G",
      "land-st-J",
    ]);
    expect(d.grid[3][1]).toMatchObject({ assignmentId: "land-4-B", state: "WAITING" });
  });

  it("休息時段 C（第4時段）→ 下一組是第5時段 第1小隊 vs 第6小隊", () => {
    const b = land();
    const { rows: r, d } = rows(b, "14:30", 4);
    const c = byCode(r, "C");
    expect(c.primaryAssignmentId).toBeNull();
    const next = d.assignments.get(c.nextAssignmentIdWhenRest!)!;
    expect(next.slot.number).toBe(5);
    expect(next.teamIds).toEqual(["team-1", "team-6"]);
  });
});

describe("關卡列顯示哪個 assignment（第十一節）", () => {
  it("上一場超時拖到下一時段 → 繼續顯示上一隊", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const { rows: r } = rows(b, "09:33", 2);
    const a = byCode(r, "A");
    expect(a.primaryAssignmentId).toBe(b.aid(1, "A"));
    expect(a.showingPrevious).toBe(true);
    expect(a.slotAssignmentId).toBe(b.aid(2, "A"));
    expect(a.isAnomaly).toBe(true);
  });

  it("上一場只有隊輔回報（READY）也佔住這一列", () => {
    const b = gold();
    b.teamIn(1, "A", 2, "09:20");
    const a = byCode(rows(b, "09:33", 2).rows, "A");
    expect(a.primaryAssignmentId).toBe(b.aid(1, "A"));
    expect(a.showingPrevious).toBe(true);
  });

  it("上一場仍是 WAITING → 不佔住，另標「待按本隊未到」並列入異常", () => {
    const b = gold();
    const a = byCode(rows(b, "09:33", 2).rows, "A");
    expect(a.primaryAssignmentId).toBe(b.aid(2, "A"));
    expect(a.showingPrevious).toBe(false);
    expect(a.previousNoShowPendingAssignmentId).toBe(b.aid(1, "A"));
    expect(a.isAnomaly).toBe(true);
  });

  it("上一場已出關 → 顯示本時段（含前往中的小隊）", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(1, "D", "09:10");
    b.stationOut(1, "D", "09:25");
    const { rows: r, d } = rows(b, "09:28", 2);
    const a = byCode(r, "A");
    expect(a.primaryAssignmentId).toBe(b.aid(2, "A"));
    expect(a.previousNoShowPendingAssignmentId).toBeNull();
    // 第1小隊（D → A）前往中
    expect(d.teams.get("team-1")!.state).toBe("TRANSITIONING");
    expect(d.teams.get("team-1")!.currentAssignmentId).toBe(b.aid(2, "A"));
    expect(a.isAnomaly).toBe(false);
  });

  it("瀏覽未來時段 → 只顯示該時段自己的 assignment", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const a = byCode(rows(b, "09:20", 2).rows, "A");
    expect(a.primaryAssignmentId).toBe(b.aid(2, "A"));
    expect(a.showingPrevious).toBe(false);
    expect(a.previousNoShowPendingAssignmentId).toBeNull();
  });

  it("被取消的 assignment 顯示為已取消（不是異常）", () => {
    const b = gold();
    b.cancel(1, "E", "道具壞掉");
    const { rows: r, d } = rows(b, "09:12", 1);
    const e = byCode(r, "E");
    expect(e.primaryAssignmentId).toBe(b.aid(1, "E"));
    expect(d.assignments.get(e.primaryAssignmentId!)!.state).toBe("CANCELLED");
    expect(d.assignments.get(e.primaryAssignmentId!)!.cancellation!.reason).toBe("道具壞掉");
  });

  it("未出關（隊伍已到下一關）與次要標籤列入異常", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamIn(1, "A", 2, "09:10:10");
    b.teamOut(1, "A", 2, "09:20");
    const a = byCode(rows(b, "09:21", 1).rows, "A");
    expect(a.isAnomaly).toBe(true);
  });

  it("本隊未到列入異常", () => {
    const b = gold();
    b.stationOut(1, "A", "09:26", { noShow: true });
    const a = byCode(rows(b, "09:27", 1).rows, "A");
    expect(a.isAnomaly).toBe(true);
  });
});

describe("摘要列", () => {
  it("以目前時段的關卡列計算；跑關中／逾期數隊伍", () => {
    const b = gold();
    b.stationIn(1, "A", "09:05"); // 09:10 開始 → 09:23:30 ENDING_SOON
    b.stationIn(1, "B", "09:10"); // IN_PROGRESS
    b.stationIn(1, "C", "09:06");
    b.stationOut(1, "C", "09:21"); // 第3小隊跑關中
    b.teamIn(1, "D", 1, "09:09"); // D READY 但未開始
    const d = deriveGame(b.build(), t("09:23:30"));
    expect(d.current).toMatchObject({ phase: "IN_SLOT", slotNumber: 1 });
    expect(d.summary.endingSoon).toBe(2); // A、B
    expect(d.summary.inProgress).toBe(0);
    expect(d.summary.overtime).toBe(0);
    expect(d.summary.waitingStart).toBe(10); // D READY + 其餘 9 關 WAITING
    expect(d.summary.transitioning).toBe(1);
    expect(d.summary.transitionOverdue).toBe(9); // 13 隊 − A B C D 四隊
    expect(d.summary.anomalies).toBeGreaterThan(0);
  });
});
