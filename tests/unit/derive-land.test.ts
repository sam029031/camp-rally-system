/**
 * 狀態推導：大地遊戲（第八節 FIXED_END、第十八節 PK、SPEC 第三十節「FIXED_END／大地等人」）。
 */
import { describe, expect, it } from "vitest";
import { deriveGame, findCondition } from "@/lib/derive";
import { formatCountdown } from "@/lib/time";
import { land, routeCodes, t, teamId, type SnapshotBuilder } from "./fixtures/game";

function at(b: SnapshotBuilder, time: string) {
  return deriveGame(b.build(), t(time));
}

describe("排程資料", () => {
  it("14 隊（含幹部隊）、每時段 7 組 PK", () => {
    const snap = land().build();
    expect(snap.teams).toHaveLength(14);
    expect(snap.teams[13]).toMatchObject({ code: "S", isStaffTeam: true });
    expect(snap.assignments).toHaveLength(56);
    expect(routeCodes(snap, 6)).toEqual(["A", "D", "J", "F", "C", "B", "G", "E"]);
    expect(routeCodes(snap, 8)).toEqual(["A", "C", "G", "J", "E", "I", "B", "H"]);
  });
});

describe("大地等人（第十八節）", () => {
  it("一隊已到、一隊未到 → 只有未到的那隊逾期；先到的隊伍 ARRIVED／等待對手", () => {
    const b = land();
    b.teamIn(1, "A", 6, "13:03");
    let d = at(b, "13:04");
    expect(d.assignments.get(b.aid(1, "A"))!.state).toBe("READY");
    expect(d.teams.get(teamId(6))!).toMatchObject({ state: "ARRIVED", arrivedDetail: "WAITING_OPPONENT" });
    expect(d.teams.get(teamId(8))!.state).toBe("WAITING");

    d = at(b, "13:05");
    expect(d.teams.get(teamId(6))!).toMatchObject({ state: "ARRIVED", arrivedDetail: "WAITING_OPPONENT" });
    expect(d.teams.get(teamId(8))!).toMatchObject({ state: "TRANSITION_OVERDUE", overdueFirstStation: true });
    expect(findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: b.aid(1, "A"), teamId: teamId(8) })).not.toBeNull();
    expect(findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: b.aid(1, "A"), teamId: teamId(6) })).toBeNull();
    // 只有一隊到 → 不發關主未開始
    expect(at(b, "13:20").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(false);
    // 兩隊各自的 side
    const sides = d.assignments.get(b.aid(1, "A"))!.sides;
    expect(sides.map((s) => [s.teamId, s.teamState])).toEqual([
      [teamId(6), "ARRIVED"],
      [teamId(8), "TRANSITION_OVERDUE"],
    ]);
    expect(sides[0].arrivedAt).toBe(t("13:03"));
    expect(sides[1].arrivedAt).toBeNull();
  });

  it("兩隊到齊開始（13:08）→ 共用倒數，結束仍是 13:25（縮短 03:00）；出關後兩隊下一關不同", () => {
    const b = land();
    b.teamIn(1, "A", 6, "13:03");
    b.teamIn(1, "A", 8, "13:08");
    b.stationIn(1, "A", "13:08", { confirmedTeamIds: [teamId(6), teamId(8)] });
    let d = at(b, "13:10");
    const ad = d.assignments.get(b.aid(1, "A"))!;
    expect(ad.state).toBe("IN_PROGRESS");
    expect(ad.startedAt).toBe(t("13:08"));
    expect(ad.officialEnd).toBe(t("13:25"));
    expect(formatCountdown(ad.shortenedMs!)).toBe("03:00");
    expect(ad.insufficientTime).toBe(false);
    expect(d.teams.get(teamId(6))!.state).toBe("AT_STATION");
    expect(d.teams.get(teamId(8))!.state).toBe("AT_STATION");

    const out = b.stationOut(1, "A", "13:25");
    d = at(b, "13:26");
    const t6 = d.teams.get(teamId(6))!;
    const t8 = d.teams.get(teamId(8))!;
    expect(t6.state).toBe("TRANSITIONING");
    expect(t6.currentAssignmentId).toBe(b.aid(2, "D")); // (水)你坡我擋
    expect(t8.currentAssignmentId).toBe(b.aid(2, "C")); // 戲劇之王
    expect(t6.deadline).toBe(t("13:32"));
    expect(t8.previousCheckOut!.id).toBe(out);

    // 第6小隊到了、第8小隊沒到 → 只有第8小隊逾期
    b.teamIn(2, "D", 6, "13:30");
    d = at(b, "13:33");
    expect(d.teams.get(teamId(6))!.state).toBe("ARRIVED");
    expect(d.teams.get(teamId(8))!.state).toBe("TRANSITION_OVERDUE");
  });

  it("關主開始視為兩隊都已抵達（單隊開始亦同一筆 station_check_in）", () => {
    const b = land();
    b.teamIn(1, "A", 6, "13:03");
    b.stationIn(1, "A", "13:06", { singleTeamOverride: true, confirmedTeamIds: [teamId(6)] });
    const d = at(b, "13:07");
    const ad = d.assignments.get(b.aid(1, "A"))!;
    expect(ad.singleTeamStart).toBe(true);
    expect(d.teams.get(teamId(8))!.state).toBe("AT_STATION");
  });
});

describe("FIXED_END（第八節）", () => {
  it("第4時段 14:29 開始 → official_end 14:46，可玩 17 分鐘，縮短 03:00", () => {
    const b = land();
    b.stationIn(4, "B", "14:29");
    const ad = at(b, "14:30").assignments.get(b.aid(4, "B"))!;
    expect(ad.assignment.teamAId).toBe(teamId(2));
    expect(ad.assignment.teamBId).toBe(teamId(4));
    expect(ad.officialEnd).toBe(t("14:46"));
    expect(ad.playableMs).toBe(17 * 60_000);
    expect(ad.shortenedMs).toBe(180_000);
    expect(formatCountdown(ad.shortenedMs!)).toBe("03:00");
    expect(ad.insufficientTime).toBe(false);
  });

  it("可玩時間 < min_play_seconds → insufficientTime", () => {
    const b = land();
    b.stationIn(4, "B", "14:37");
    const ad = at(b, "14:38").assignments.get(b.aid(4, "B"))!;
    expect(ad.playableMs).toBe(9 * 60_000);
    expect(ad.insufficientTime).toBe(true);
    // 剛好 10 分鐘不算不足
    const b2 = land();
    b2.stationIn(4, "B", "14:36");
    expect(at(b2, "14:37").assignments.get(b2.aid(4, "B"))!.insufficientTime).toBe(false);
  });

  it("準時開始：兩種剩餘同時結束、不縮短", () => {
    const b = land();
    b.stationIn(4, "B", "14:25");
    const d = at(b, "14:30");
    const ad = d.assignments.get(b.aid(4, "B"))!;
    expect(ad.startedAt).toBe(t("14:26"));
    expect(ad.officialEnd).toBe(ad.slot.scheduledEnd);
    expect(ad.shortenedMs).toBeNull();
    expect(d.current.remainingMs).toBe(ad.remainingMs);
  });

  it("有 override → official_end = override（延長）", () => {
    const b = land();
    b.stationIn(4, "B", "14:40");
    const ovr = b.override(4, "B", "14:55");
    let d = at(b, "14:47");
    let ad = d.assignments.get(b.aid(4, "B"))!;
    expect(ad.officialEnd).toBe(t("14:55"));
    expect(ad.state).toBe("IN_PROGRESS");
    expect(ad.insufficientTime).toBe(false);
    d = at(b, "14:55");
    ad = d.assignments.get(b.aid(4, "B"))!;
    expect(ad.state).toBe("OVERTIME");
    expect(findCondition(d, { kind: "STATION_OVERTIME", subkind: null, assignmentId: ad.assignment.id, teamId: null })!.triggerOverrideId).toBe(ovr);
  });

  it("大地改成 FULL_DURATION（admin 設定）→ 晚開始就晚結束", () => {
    const b = land({ endPolicy: "FULL_DURATION" });
    b.stationIn(4, "B", "14:29");
    expect(at(b, "14:30").assignments.get(b.aid(4, "B"))!.officialEnd).toBe(t("14:49"));
  });
});

describe("關主未開始（STATION_NOT_STARTED，大地要兩隊都到）", () => {
  it("兩隊都到 → max(最後一隊隊輔進關, scheduled_start, 上一場出關) + 3 分", () => {
    const b = land();
    b.stationIn(3, "B", "13:59");
    b.stationOut(3, "B", "14:19");
    b.teamIn(4, "B", 2, "14:24");
    const trig = b.teamIn(4, "B", 4, "14:27"); // 最後到的那一隊
    expect(at(b, "14:29:59").conditions.some((c) => c.kind === "STATION_NOT_STARTED")).toBe(false);
    const d = at(b, "14:30");
    const c = findCondition(d, { kind: "STATION_NOT_STARTED", subkind: null, assignmentId: b.aid(4, "B"), teamId: null })!;
    expect(c).not.toBeNull();
    expect(c.triggerRecordId).toBe(trig);
  });
});
