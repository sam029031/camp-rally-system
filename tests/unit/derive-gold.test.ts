/**
 * 狀態推導：黃金傳奇（第八、九、十節；SPEC 第三十節「Timer／狀態推導」）。
 */
import { describe, expect, it } from "vitest";
import {
  computeCurrentSlot,
  conditionKey,
  deriveGame,
  findCondition,
  stationAssignments,
  stationFocusAssignment,
  teamAssignments,
} from "@/lib/derive";
import { formatCountdown, formatSignedDuration } from "@/lib/time";
import { PREV_NOT_CHECKED_IN_LABEL } from "@/lib/labels";
import { gold, routeCodes, t, teamId, type SnapshotBuilder } from "./fixtures/game";

function at(b: SnapshotBuilder, time: string) {
  return deriveGame(b.build(), t(time));
}

describe("排程資料（fixture 與已驗證事實一致）", () => {
  it("第2小隊路線 A C B M K L J H；第1小隊 D A C B M K L J", () => {
    const snap = gold().build();
    expect(routeCodes(snap, 2)).toEqual(["A", "C", "B", "M", "K", "L", "J", "H"]);
    expect(routeCodes(snap, 1)).toEqual(["D", "A", "C", "B", "M", "K", "L", "J"]);
    expect(snap.teams).toHaveLength(13);
    expect(snap.teams.some((x) => x.isStaffTeam)).toBe(false);
  });
});

describe("關卡計時（第八節）", () => {
  it("第2時段 09:30 關主進關 → 09:31 READY、09:32 IN_PROGRESS、09:45 起 ENDING_SOON、09:47 起 OVERTIME", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "A", "09:30");
    const id = b.aid(2, "A");

    let d = at(b, "09:31");
    let ad = d.assignments.get(id)!;
    expect(ad.state).toBe("READY");
    expect(ad.startedAt).toBe(t("09:32"));
    expect(ad.officialEnd).toBe(t("09:47"));
    expect(ad.untilStartMs).toBe(60_000);
    expect(ad.remainingMs).toBeNull();
    expect(d.teams.get(teamId(1))!.state).toBe("ARRIVED");
    expect(d.teams.get(teamId(1))!.arrivedDetail).toBe("WAITING_START");

    d = at(b, "09:32");
    ad = d.assignments.get(id)!;
    expect(ad.state).toBe("IN_PROGRESS");
    expect(formatCountdown(ad.remainingMs!)).toBe("15:00");
    expect(ad.deltaVsScheduledMs).toBe(0);
    expect(d.teams.get(teamId(1))!.state).toBe("AT_STATION");

    expect(at(b, "09:44:59").assignments.get(id)!.state).toBe("IN_PROGRESS");
    expect(at(b, "09:45").assignments.get(id)!.state).toBe("ENDING_SOON");
    expect(at(b, "09:46:59").assignments.get(id)!.state).toBe("ENDING_SOON");

    const d47 = at(b, "09:47");
    expect(d47.assignments.get(id)!.state).toBe("OVERTIME");
    expect(d47.assignments.get(id)!.remainingMs).toBe(0);
    expect(d47.conditions.some((c) => c.kind === "STATION_OVERTIME" && c.assignmentId === id)).toBe(true);
    expect(at(b, "09:46:59").conditions.some((c) => c.kind === "STATION_OVERTIME")).toBe(false);
  });

  it("09:13 才進關（第1時段 FULL_DURATION）→ 09:28 結束；09:26 不是 OVERTIME", () => {
    const b = gold();
    b.stationIn(1, "A", "09:13");
    const id = b.aid(1, "A");
    const d = at(b, "09:26");
    const ad = d.assignments.get(id)!;
    expect(ad.officialEnd).toBe(t("09:28"));
    expect(ad.state).not.toBe("OVERTIME");
    expect(ad.state).toBe("ENDING_SOON");
    expect(formatSignedDuration(ad.deltaVsScheduledMs!)).toBe("+03:00");
    expect(ad.shortenedMs).toBeNull();
    expect(ad.insufficientTime).toBe(false);
    // 時段剩餘（排程）與關卡剩餘不同：09:25 後時段已進入跑關
    expect(d.current.phase).toBe("TRANSITION");
    expect(at(b, "09:27:59").conditions.some((c) => c.kind === "STATION_OVERTIME")).toBe(false);
    expect(at(b, "09:28").assignments.get(id)!.state).toBe("OVERTIME");
  });

  it("override 取代正式結束時間", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const ovr = b.override(1, "A", "09:30");
    const id = b.aid(1, "A");
    expect(at(b, "09:26").assignments.get(id)!.state).toBe("IN_PROGRESS");
    const d = at(b, "09:30");
    expect(d.assignments.get(id)!.officialEnd).toBe(t("09:30"));
    expect(d.assignments.get(id)!.state).toBe("OVERTIME");
    const c = findCondition(d, { kind: "STATION_OVERTIME", subkind: null, assignmentId: id, teamId: null })!;
    expect(c.triggerOverrideId).toBe(ovr);
  });

  it("撤銷進關 → 回到等待，超時條件消失", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    b.voidRecord(sci, "09:10:20");
    const d = at(b, "09:30");
    expect(d.assignments.get(b.aid(1, "A"))!.state).toBe("WAITING");
    expect(d.conditions.some((c) => c.kind === "STATION_OVERTIME")).toBe(false);
  });

  it("隊輔先按進關 → 關卡 READY；關主出關後 CHECKED_OUT", () => {
    const b = gold();
    b.teamIn(1, "A", 2, "09:09");
    expect(at(b, "09:09:30").assignments.get(b.aid(1, "A"))!.state).toBe("READY");
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    const ad = at(b, "09:26").assignments.get(b.aid(1, "A"))!;
    expect(ad.state).toBe("CHECKED_OUT");
    expect(ad.remainingMs).toBeNull();
  });
});

describe("跑關 7 分鐘（第九節）", () => {
  it("09:20 提早出關 → 09:30 仍 TRANSITIONING，09:32 起 TRANSITION_OVERDUE", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const out = b.stationOut(1, "A", "09:20");

    let td = at(b, "09:29:59").teams.get(teamId(2))!;
    expect(td.state).toBe("TRANSITIONING");
    expect(td.currentAssignmentId).toBe(b.aid(2, "C"));
    expect(td.deadline).toBe(t("09:32"));
    expect(td.transitionWarning).toBe(false);

    td = at(b, "09:30").teams.get(teamId(2))!;
    expect(td.state).toBe("TRANSITIONING");
    expect(td.transitionWarning).toBe(true); // 剩 2:00 → 黃色
    expect(td.previousCheckOut!.id).toBe(out);
    expect(td.previousAssignmentId).toBe(b.aid(1, "A"));

    const d = at(b, "09:32");
    td = d.teams.get(teamId(2))!;
    expect(td.state).toBe("TRANSITION_OVERDUE");
    expect(td.overdueFirstStation).toBe(false);
    const c = findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: b.aid(2, "C"), teamId: teamId(2) })!;
    expect(c.triggerRecordId).toBe(out);
  });

  it("09:28 出關 → deadline 09:35；09:36 才抵達 → 09:35–09:36 為逾期", () => {
    const b = gold();
    b.stationIn(1, "A", "09:13");
    b.stationOut(1, "A", "09:28");
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    expect(at(b, "09:34:59").teams.get(teamId(2))!.state).toBe("TRANSITIONING");
    expect(at(b, "09:34:59").teams.get(teamId(2))!.deadline).toBe(t("09:35"));
    const overdue = at(b, "09:35:30").teams.get(teamId(2))!;
    expect(overdue.state).toBe("TRANSITION_OVERDUE");
    expect(formatCountdown(overdue.transitionRemainingMs!)).toBe("00:30");

    expect(at(b, "09:35:59").teams.get(teamId(2))!.state).toBe("TRANSITION_OVERDUE");
    b.teamIn(2, "C", 2, "09:36");
    const arrived = at(b, "09:36:30").teams.get(teamId(2))!;
    expect(arrived.state).toBe("ARRIVED");
    expect(arrived.arrivedDetail).toBe("TEAM_REPORTED");
    expect(arrived.deadline).toBeNull();
    expect(arrived.arrivedAt).toBe(t("09:36"));
  });

  it("隊輔先確認進關 → 立即 ARRIVED（隊輔回報），跑關停止", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    b.teamIn(2, "C", 2, "09:27");
    for (const time of ["09:27", "09:33", "09:40"]) {
      const td = at(b, time).teams.get(teamId(2))!;
      expect(td.state).toBe("ARRIVED");
      expect(td.arrivedDetail).toBe("TEAM_REPORTED");
      expect(td.transitionRemainingMs).toBeNull();
    }
    // 關主確認後、未到 09:32 → 已到，等待開始
    b.stationIn(2, "C", "09:30");
    expect(at(b, "09:31").teams.get(teamId(2))!.arrivedDetail).toBe("WAITING_START");
  });

  it("下一關上一隊還沒出關 → 已到，排隊中", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(1, "C", "09:10"); // C 第1時段（第3小隊）超時未出關
    b.teamIn(2, "C", 2, "09:30");
    const d = at(b, "09:33");
    const td = d.teams.get(teamId(2))!;
    expect(td.state).toBe("ARRIVED");
    expect(td.arrivedDetail).toBe("QUEUED");
    expect(d.assignments.get(b.aid(2, "C"))!.queueBlocked).toBe(true);
    expect(d.conditions.some((c) => c.kind === "TRANSITION_OVERDUE" && c.teamId === teamId(2))).toBe(false);
  });

  it("上一關關主忘記出關、隊輔已在下一關確認進關 → 小隊狀態在下一關，上一關標示未出關", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    const arrival = b.teamIn(2, "C", 2, "09:30");
    const d = at(b, "09:31");
    const td = d.teams.get(teamId(2))!;
    expect(td.state).toBe("ARRIVED");
    expect(td.currentAssignmentId).toBe(b.aid(2, "C"));
    expect(td.lastAssignmentId).toBe(b.aid(2, "C"));

    const a1 = d.assignments.get(b.aid(1, "A"))!;
    expect(a1.state).toBe("OVERTIME");
    const tag = a1.tags.find((x) => x.kind === "PREV_NOT_CHECKED_OUT")!;
    expect(tag).toBeDefined();
    expect(tag.teamId).toBe(teamId(2));
    expect(tag.label).toBe("未出關（隊伍已到下一關）");
    expect(tag.triggerRecordId).toBe(arrival);
    const c = findCondition(d, { kind: "PREV_NOT_CHECKED_OUT", subkind: null, assignmentId: b.aid(1, "A"), teamId: teamId(2) })!;
    expect(c.triggerRecordId).toBe(arrival);
  });

  it("上一關完全沒有進關、隊伍已在下一關 → 「未到（隊伍已在下一關），待按本隊未到」", () => {
    const b = gold();
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    b.teamIn(2, "C", 2, "09:30");
    const d = at(b, "09:31");
    const tag = d.assignments.get(b.aid(1, "A"))!.tags.find((x) => x.kind === "PREV_NOT_CHECKED_OUT")!;
    expect(tag.label).toBe(PREV_NOT_CHECKED_IN_LABEL);
    expect(d.teams.get(teamId(2))!.state).toBe("ARRIVED");
  });

  it("第1時段沒有任何紀錄：09:10 前 WAITING，09:10 起「未到第一關」", () => {
    const b = gold();
    let td = at(b, "09:09:59").teams.get(teamId(2))!;
    expect(td.state).toBe("WAITING");
    expect(td.deadline).toBe(t("09:10"));
    expect(td.currentAssignmentId).toBe(b.aid(1, "A"));
    const d = at(b, "09:10");
    td = d.teams.get(teamId(2))!;
    expect(td.state).toBe("TRANSITION_OVERDUE");
    expect(td.overdueFirstStation).toBe(true);
    const c = findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: b.aid(1, "A"), teamId: teamId(2) })!;
    expect(c.triggerRecordId).toBeNull();
    // 13 隊都未到第一關
    expect(d.conditions.filter((x) => x.kind === "TRANSITION_OVERDUE")).toHaveLength(13);
    expect(d.summary.transitionOverdue).toBe(13);
  });

  it("第8時段出關 → COMPLETED", () => {
    const b = gold();
    const route = routeCodes(b.build(), 2);
    route.forEach((code, i) => {
      b.stationIn(i + 1, code, ["09:10", "09:32", "09:54", "10:16", "10:38", "11:00", "11:22", "11:44"][i]);
      b.teamIn(i + 1, code, 2, ["09:10:05", "09:32:05", "09:54:05", "10:16:05", "10:38:05", "11:00:05", "11:22:05", "11:44:05"][i]);
      if (i < 7) {
        b.stationOut(i + 1, code, ["09:25", "09:47", "10:09", "10:31", "10:53", "11:15", "11:37"][i]);
      }
    });
    expect(at(b, "11:50").teams.get(teamId(2))!.state).toBe("AT_STATION");
    b.stationOut(8, "H", "11:59");
    const td = at(b, "12:00").teams.get(teamId(2))!;
    expect(td.state).toBe("COMPLETED");
    expect(td.currentAssignmentId).toBe(b.aid(8, "H"));
    expect(td.deadline).toBeNull();
  });

  it("refresh 不重置：同一組紀錄＋同一個 now，結果一樣", () => {
    const build = () => {
      const b = gold();
      b.stationIn(1, "A", "09:10");
      b.teamIn(1, "A", 2, "09:10:23");
      b.stationOut(1, "A", "09:25:31");
      b.stationIn(1, "B", "09:12");
      b.teamOut(1, "D", 1, "09:24");
      return b.build();
    };
    const d1 = deriveGame(build(), t("09:29"));
    const d2 = deriveGame(build(), t("09:29"));
    expect(d2).toEqual(d1);
    // 同一份快照重算（索引快取）也一樣
    const snap = build();
    expect(deriveGame(snap, t("09:29"))).toEqual(deriveGame(snap, t("09:29")));
  });

  it("延後排程 10 分鐘後，started_at 下限與 deadline 一起移動", () => {
    const b = gold();
    b.adjust(3, 10);
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "C", "09:32");
    b.stationOut(2, "C", "09:47");
    let d = at(b, "09:50");
    expect(d.activeAdjustmentLabel).toBe("第3時段起已延後 10 分鐘");
    const td = d.teams.get(teamId(2))!;
    expect(td.currentAssignmentId).toBe(b.aid(3, "B"));
    expect(td.deadline).toBe(t("10:04"));
    expect(at(b, "10:03").teams.get(teamId(2))!.state).toBe("TRANSITIONING");
    expect(at(b, "10:04").teams.get(teamId(2))!.state).toBe("TRANSITION_OVERDUE");

    b.stationIn(3, "B", "10:00");
    d = at(b, "10:02");
    const ad = d.assignments.get(b.aid(3, "B"))!;
    expect(ad.state).toBe("READY");
    expect(ad.startedAt).toBe(t("10:04"));
    expect(ad.officialEnd).toBe(t("10:19"));
    // 第1、2時段不受影響
    expect(d.assignments.get(b.aid(2, "C"))!.slot.scheduledStart).toBe(t("09:32"));
    expect(ad.slot.originalStart).toBe(t("09:54"));
  });

  it("撤銷調整後回到原本時間，標籤消失", () => {
    const b = gold();
    const adj = b.adjust(3, 10);
    b.voidAdjustment(adj);
    const d = at(b, "09:00");
    expect(d.activeAdjustmentLabel).toBeNull();
    expect(d.assignments.get(b.aid(3, "B"))!.slot.scheduledStart).toBe(t("09:54"));
  });

  it("提前的標籤", () => {
    const b = gold();
    b.adjust(4, -5);
    expect(at(b, "09:00").activeAdjustmentLabel).toBe("第4時段起已提前 5 分鐘");
    b.adjust(2, 10);
    expect(at(b, "09:00").activeAdjustmentLabel).toBe("第2時段起已延後 10 分鐘");
  });
});

describe("關卡取消（第二十四節之二）", () => {
  it("取消第3時段 → 第2時段出關後目標是第4時段，deadline = max(出關 + 7, 第4時段開始)", () => {
    const b = gold();
    b.cancel(3, "B");
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "C", "09:32");
    b.stationOut(2, "C", "09:47");
    const d = at(b, "09:50");
    const td = d.teams.get(teamId(2))!;
    expect(td.state).toBe("TRANSITIONING");
    expect(td.currentAssignmentId).toBe(b.aid(4, "M"));
    expect(td.deadline).toBe(t("10:16"));
    expect(td.skippedCancelledAssignmentIds).toEqual([b.aid(3, "B")]);
    expect(td.cancelledAssignmentIds).toEqual([b.aid(3, "B")]);
    expect(td.routeAssignmentIds).toHaveLength(7);
    expect(d.assignments.get(b.aid(3, "B"))!.state).toBe("CANCELLED");
  });

  it("出關很晚時 deadline = 出關 + 7 分鐘", () => {
    const b = gold();
    b.cancel(3, "B");
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "C", "09:32");
    b.stationOut(2, "C", "10:12");
    expect(at(b, "10:13").teams.get(teamId(2))!.deadline).toBe(t("10:19"));
  });

  it("被取消 assignment 上的紀錄不影響小隊狀態；狀態仍是 CANCELLED", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "C", "09:32");
    b.stationOut(2, "C", "09:47");
    b.teamIn(3, "B", 2, "09:50");
    b.stationIn(3, "B", "09:51");
    b.cancel(3, "B");
    const d = at(b, "09:55");
    expect(d.assignments.get(b.aid(3, "B"))!.state).toBe("CANCELLED");
    expect(d.assignments.get(b.aid(3, "B"))!.remainingMs).toBeNull();
    expect(d.teams.get(teamId(2))!.state).toBe("TRANSITIONING");
    expect(d.teams.get(teamId(2))!.currentAssignmentId).toBe(b.aid(4, "M"));
    expect(d.conditions.some((c) => c.assignmentId === b.aid(3, "B"))).toBe(false);
  });

  it("撤銷取消 → 回到原路線", () => {
    const b = gold();
    const c = b.cancel(3, "B");
    b.voidCancellation(c);
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "C", "09:32");
    b.stationOut(2, "C", "09:47");
    expect(at(b, "09:50").teams.get(teamId(2))!.currentAssignmentId).toBe(b.aid(3, "B"));
  });

  it("關主頁主卡片跳過被取消的 assignment；上一場／下一場也跳過", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.cancel(2, "A");
    const snap = b.build();
    const d = deriveGame(snap, t("09:30"));
    expect(stationFocusAssignment(snap, d, "gold-st-A")!.assignment.id).toBe(b.aid(3, "A"));
    const a3 = d.assignments.get(b.aid(3, "A"))!;
    expect(a3.prevAssignmentId).toBe(b.aid(1, "A"));
    expect(a3.queueBlocked).toBe(false);
    expect(d.assignments.get(b.aid(1, "A"))!.nextAssignmentId).toBe(b.aid(3, "A"));
    expect(stationAssignments(snap, d, "gold-st-A")).toHaveLength(8);
    expect(teamAssignments(snap, d, teamId(2)).map((x) => x.station.code)).toEqual(["A", "C", "B", "M", "K", "L", "J", "H"]);
  });
});

describe("關主頁主卡片（第十七節）", () => {
  it("最早一個尚未關主出關的 assignment；全部完成 → null", () => {
    const b = gold();
    const snap0 = b.build();
    expect(stationFocusAssignment(snap0, deriveGame(snap0, t("09:00")), "gold-st-A")!.assignment.id).toBe(b.aid(1, "A"));
    for (let s = 1; s <= 8; s++) {
      b.stationIn(s, "A", ["09:10", "09:32", "09:54", "10:16", "10:38", "11:00", "11:22", "11:44"][s - 1]);
      b.stationOut(s, "A", ["09:25", "09:47", "10:09", "10:31", "10:53", "11:15", "11:37", "11:59"][s - 1]);
    }
    const snap = b.build();
    expect(stationFocusAssignment(snap, deriveGame(snap, t("12:00")), "gold-st-A")).toBeNull();
  });

  it("超時未出關時停在同一隊（不依時鐘）", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const snap = b.build();
    expect(stationFocusAssignment(snap, deriveGame(snap, t("09:40")), "gold-st-A")!.assignment.id).toBe(b.aid(1, "A"));
  });
});

describe("目前時段（第十一節）", () => {
  it("BEFORE_START / IN_SLOT / TRANSITION / ENDED", () => {
    const slots = gold().build().slots;
    expect(computeCurrentSlot(slots, t("09:00"))).toMatchObject({ phase: "BEFORE_START", slotNumber: 1, remainingMs: 600_000 });
    expect(computeCurrentSlot(slots, t("09:16:37"))).toMatchObject({ phase: "IN_SLOT", slotNumber: 1, remainingMs: 503_000 });
    expect(computeCurrentSlot(slots, t("09:25"))).toMatchObject({ phase: "TRANSITION", slotNumber: 2, remainingMs: 420_000 });
    expect(computeCurrentSlot(slots, t("09:27:50"))).toMatchObject({ phase: "TRANSITION", slotNumber: 2, remainingMs: 250_000 });
    expect(computeCurrentSlot(slots, t("09:32"))).toMatchObject({ phase: "IN_SLOT", slotNumber: 2 });
    expect(computeCurrentSlot(slots, t("11:59"))).toMatchObject({ phase: "ENDED", slotNumber: 8, remainingMs: null });
  });
});

describe("通知 key", () => {
  it("conditionKey：kind|subkind|assignment|team|trigger|override", () => {
    expect(
      conditionKey({
        kind: "STATION_OVERTIME",
        subkind: null,
        assignmentId: "a1",
        teamId: null,
        triggerRecordId: "r1",
        triggerOverrideId: null,
      }),
    ).toBe("STATION_OVERTIME||a1||r1|");
    expect(
      conditionKey({
        kind: "RECORD_MISMATCH",
        subkind: "CHECKOUT_TIME_DIFF",
        assignmentId: "a1",
        teamId: "t2",
        triggerRecordId: "r9",
        triggerOverrideId: null,
      }),
    ).toBe("RECORD_MISMATCH|CHECKOUT_TIME_DIFF|a1|t2|r9|");
  });

  it("findCondition 找不到 → null", () => {
    const d = at(gold(), "09:00");
    expect(findCondition(d, { kind: "STATION_OVERTIME", subkind: null, assignmentId: "x", teamId: null })).toBeNull();
  });
});
