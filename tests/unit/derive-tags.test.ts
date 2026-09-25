/**
 * 次要標籤與通知條件（第十節 C、第十五節；ARCHITECTURE 第 3 節第 9、10 點）。
 */
import { describe, expect, it } from "vitest";
import { deriveGame, findCondition } from "@/lib/derive";
import type { SecondaryTagKind } from "@/lib/derive";
import { gold, land, t, teamId, type SnapshotBuilder } from "./fixtures/game";

function at(b: SnapshotBuilder, time: string) {
  return deriveGame(b.build(), t(time));
}

function tagKinds(b: SnapshotBuilder, time: string, slot: number, station: string): SecondaryTagKind[] {
  return at(b, time)
    .assignments.get(b.aid(slot, station))!
    .tags.map((x) => x.kind);
}

function mismatch(b: SnapshotBuilder, time: string, subkind: SecondaryTagKind, slot = 1, station = "A", team = 2) {
  return findCondition(at(b, time), {
    kind: "RECORD_MISMATCH",
    subkind,
    assignmentId: b.aid(slot, station),
    teamId: teamId(team),
  });
}

describe("TEAM_NOT_CHECKED_IN（計時已開始 90 秒，隊輔仍未按進關）", () => {
  it("09:11:30 起出現；trigger = 關主進關", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:09");
    expect(tagKinds(b, "09:11:29", 1, "A")).toEqual([]);
    expect(tagKinds(b, "09:11:30", 1, "A")).toEqual(["TEAM_NOT_CHECKED_IN"]);
    const c = mismatch(b, "09:11:30", "TEAM_NOT_CHECKED_IN")!;
    expect(c.triggerRecordId).toBe(sci);
  });

  it("隊輔已進關 → 不出現", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamIn(1, "A", 2, "09:10:23");
    expect(tagKinds(b, "09:15", 1, "A")).toEqual([]);
  });
});

describe("TEAM_NOT_CHECKED_OUT（關主出關 90 秒後，隊輔仍未按出關）", () => {
  it("09:26:30 起出現；本隊未到不算", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamIn(1, "A", 2, "09:10:05");
    const sco = b.stationOut(1, "A", "09:25");
    expect(tagKinds(b, "09:26:29", 1, "A")).toEqual([]);
    expect(tagKinds(b, "09:26:30", 1, "A")).toEqual(["TEAM_NOT_CHECKED_OUT"]);
    expect(mismatch(b, "09:26:30", "TEAM_NOT_CHECKED_OUT")!.triggerRecordId).toBe(sco);

    const ns = gold();
    ns.stationOut(1, "A", "09:25", { noShow: true });
    const d = at(ns, "09:40");
    const ad = d.assignments.get(ns.aid(1, "A"))!;
    expect(ad.state).toBe("CHECKED_OUT");
    expect(ad.noShow).toBe(true);
    expect(ad.tags).toEqual([]);
  });
});

describe("TEAM_OUT_STATION_NOT_OUT（隊輔已出關，關主未出關）", () => {
  it("標籤立即顯示；通知要 15 秒寬限", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamIn(1, "A", 2, "09:10:05");
    const tco = b.teamOut(1, "A", 2, "09:25:10");
    let d = at(b, "09:25:10");
    let tag = d.assignments.get(b.aid(1, "A"))!.tags.find((x) => x.kind === "TEAM_OUT_STATION_NOT_OUT")!;
    expect(tag.notify).toBe(false);
    expect(tag.label).toBe("隊輔已出關，關主未出關");
    expect(mismatch(b, "09:25:24", "TEAM_OUT_STATION_NOT_OUT")).toBeNull();
    d = at(b, "09:25:25");
    tag = d.assignments.get(b.aid(1, "A"))!.tags.find((x) => x.kind === "TEAM_OUT_STATION_NOT_OUT")!;
    expect(tag.notify).toBe(true);
    expect(mismatch(b, "09:25:25", "TEAM_OUT_STATION_NOT_OUT")!.triggerRecordId).toBe(tco);
    // 關主出關後解除
    b.stationOut(1, "A", "09:25:30");
    expect(tagKinds(b, "09:26", 1, "A")).toEqual([]);
  });
});

describe("CHECKOUT_TIME_DIFF（雙方出關時間差 > 60 秒）", () => {
  it("差 61 秒 → 紀錄不一致；差 60 秒 → 沒有", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamIn(1, "A", 2, "09:10:05");
    b.stationOut(1, "A", "09:25:00");
    const tco = b.teamOut(1, "A", 2, "09:26:01");
    const d = at(b, "09:27");
    const tag = d.assignments.get(b.aid(1, "A"))!.tags.find((x) => x.kind === "CHECKOUT_TIME_DIFF")!;
    expect(tag.label).toContain("紀錄不一致");
    expect(tag.triggerRecordId).toBe(tco);
    expect(mismatch(b, "09:27", "CHECKOUT_TIME_DIFF")).not.toBeNull();

    const ok = gold();
    ok.stationIn(1, "A", "09:10");
    ok.teamIn(1, "A", 2, "09:10:05");
    ok.stationOut(1, "A", "09:25:00");
    ok.teamOut(1, "A", 2, "09:26:00");
    expect(tagKinds(ok, "09:27", 1, "A")).toEqual([]);

    // 隊輔比關主早 61 秒出關也算
    const early = gold();
    early.stationIn(1, "A", "09:10");
    early.teamIn(1, "A", 2, "09:10:05");
    early.teamOut(1, "A", 2, "09:23:59");
    early.stationOut(1, "A", "09:25:00");
    expect(tagKinds(early, "09:25:30", 1, "A")).toEqual(["CHECKOUT_TIME_DIFF"]);
  });
});

describe("TEAM_CHECK_IN_MISSING（隊輔漏按進關）", () => {
  it("有隊輔出關、沒有隊輔進關", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10:30");
    const tco = b.teamOut(1, "A", 2, "09:24");
    const kinds = tagKinds(b, "09:24:30", 1, "A");
    expect(kinds).toContain("TEAM_CHECK_IN_MISSING");
    expect(kinds).toContain("TEAM_NOT_CHECKED_IN");
    expect(kinds).toContain("TEAM_OUT_STATION_NOT_OUT");
    expect(mismatch(b, "09:24:30", "TEAM_CHECK_IN_MISSING")!.triggerRecordId).toBe(tco);
  });
});

describe("標籤每隊各自算（大地）", () => {
  it("第6小隊隊輔已出關、第8小隊沒有 → 只有第6小隊的標籤", () => {
    const b = land();
    b.teamIn(1, "A", 6, "13:03");
    b.teamIn(1, "A", 8, "13:04");
    b.stationIn(1, "A", "13:04");
    b.teamOut(1, "A", 6, "13:25");
    const tags = at(b, "13:25:20").assignments.get(b.aid(1, "A"))!.tags;
    expect(tags.map((x) => [x.kind, x.teamId])).toEqual([["TEAM_OUT_STATION_NOT_OUT", teamId(6)]]);
  });

  it("被取消的 assignment 不算標籤", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamOut(1, "A", 2, "09:20");
    b.cancel(1, "A");
    expect(tagKinds(b, "09:30", 1, "A")).toEqual([]);
  });
});

describe("STATION_NOT_STARTED（黃金）", () => {
  function setup() {
    const b = gold();
    b.stationIn(1, "C", "09:10");
    return b;
  }

  it("上一場已出關：max(隊輔進關, scheduled_start, 上一場出關) + 3 分", () => {
    const b = setup();
    b.stationOut(1, "C", "09:25");
    const tci = b.teamIn(2, "C", 2, "09:30");
    expect(at(b, "09:34:59").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(false);
    const c = findCondition(at(b, "09:35"), { kind: "STATION_NOT_STARTED", subkind: null, assignmentId: b.aid(2, "C"), teamId: null })!;
    expect(c.triggerRecordId).toBe(tci);
    // 關主進關後不再成立
    b.stationIn(2, "C", "09:36");
    expect(at(b, "09:37").conditions.some((c2) => c2.kind === "STATION_NOT_STARTED")).toBe(false);
  });

  it("隊輔晚到 09:40 → 09:43 起；上一場晚出關 09:45 → 09:48 起", () => {
    const b = setup();
    b.stationOut(1, "C", "09:25");
    b.teamIn(2, "C", 2, "09:40");
    expect(at(b, "09:42:59").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(false);
    expect(at(b, "09:43").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(true);

    const late = setup();
    late.teamIn(2, "C", 2, "09:30");
    late.stationOut(1, "C", "09:45");
    expect(at(late, "09:47:59").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(false);
    expect(at(late, "09:48").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(true);
  });

  it("上一場尚未出關（排隊中）→ 不發", () => {
    const b = setup();
    b.teamIn(2, "C", 2, "09:30");
    const d = at(b, "09:50");
    expect(d.assignments.get(b.aid(2, "C"))!.queueBlocked).toBe(true);
    expect(d.conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(false);
  });
});

describe("條件總表", () => {
  it("STATION_OVERTIME 在大地一組 PK 一筆（teamId null）", () => {
    const b = land();
    const sci = b.stationIn(1, "A", "13:05");
    const d = at(b, "13:26");
    const overtime = d.conditions.filter((c) => c.kind === "STATION_OVERTIME");
    expect(overtime).toEqual([
      { kind: "STATION_OVERTIME", subkind: null, assignmentId: b.aid(1, "A"), teamId: null, triggerRecordId: sci, triggerOverrideId: null },
    ]);
  });

  it("撤銷後重做 = 新 trigger（新事件）", () => {
    const b = gold();
    const first = b.stationIn(1, "A", "09:10");
    b.voidRecord(first, "09:10:30");
    const second = b.stationIn(1, "A", "09:10:40");
    const c = findCondition(at(b, "09:26"), { kind: "STATION_OVERTIME", subkind: null, assignmentId: b.aid(1, "A"), teamId: null })!;
    expect(c.triggerRecordId).toBe(second);
  });
});
