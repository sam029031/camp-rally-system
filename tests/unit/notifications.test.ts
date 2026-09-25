/**
 * 通知：失效判斷、文字、對象分類（第十五節）。
 */
import { describe, expect, it } from "vitest";
import { deriveGame, findCondition } from "@/lib/derive";
import { notificationsToInvalidate, notificationsToRevalidate } from "@/lib/notifications/validity";
import { buildConditionMessage, buildToastSummary } from "@/lib/notifications/messages";
import { isConditionRelevant, isRelevantNotification, isToastNotification } from "@/lib/notifications/classify";
import type { AppNotification, GameSnapshot, NotificationKind } from "@/lib/types";
import { gold, land, t, teamId } from "./fixtures/game";

function invalid(snap: GameSnapshot, time: string): string[] {
  return notificationsToInvalidate(snap, t(time));
}

describe("notificationsToInvalidate", () => {
  it("撤銷進關 → 對應的超時通知失效", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const n = b.notify({ kind: "STATION_OVERTIME", assignmentId: b.aid(1, "A"), triggerRecordId: sci, createdAt: "09:25" });
    expect(invalid(b.build(), "09:30")).toEqual([]);
    b.voidRecord(sci, "09:30");
    expect(invalid(b.build(), "09:31")).toEqual([n]);
  });

  it("出關時間修正到 official_end 之前 → 超時通知失效；修正後仍超時 → 保留", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const sco = b.stationOut(1, "A", "09:27");
    const n = b.notify({ kind: "STATION_OVERTIME", assignmentId: b.aid(1, "A"), triggerRecordId: sci, createdAt: "09:25" });
    expect(invalid(b.build(), "09:40")).toEqual([]);
    b.correctRecord(sco, "09:24:50");
    expect(invalid(b.build(), "09:40")).toEqual([n]);

    const b2 = gold();
    const sci2 = b2.stationIn(1, "A", "09:10");
    const sco2 = b2.stationOut(1, "A", "09:27");
    b2.notify({ kind: "STATION_OVERTIME", assignmentId: b2.aid(1, "A"), triggerRecordId: sci2, createdAt: "09:25" });
    b2.correctRecord(sco2, "09:26");
    expect(invalid(b2.build(), "09:40")).toEqual([]);
  });

  it("延長（override id 不同）→ 舊的超時通知失效；延長後再超時的新通知保留", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const old = b.notify({ kind: "STATION_OVERTIME", assignmentId: b.aid(1, "A"), triggerRecordId: sci, createdAt: "09:25" });
    const ovr = b.override(1, "A", "09:30");
    expect(invalid(b.build(), "09:26")).toEqual([old]);
    const again = b.notify({
      kind: "STATION_OVERTIME",
      assignmentId: b.aid(1, "A"),
      triggerRecordId: sci,
      triggerOverrideId: ovr,
      createdAt: "09:30",
    });
    expect(invalid(b.build(), "09:31")).toEqual([old]);
    // 撤銷延長 → 延長後那一則失效；原本那一則（沒有 override）的條件又成立
    b.voidOverride(ovr);
    expect(invalid(b.build(), "09:32")).toEqual([again]);
  });

  it("TRANSITION_OVERDUE：抵達時間 > deadline 保留；修正成 <= deadline 失效；目標被取消失效", () => {
    const b = gold();
    b.stationIn(1, "A", "09:13");
    const out = b.stationOut(1, "A", "09:28");
    const arrival = b.teamIn(2, "C", 2, "09:36");
    const n = b.notify({ kind: "TRANSITION_OVERDUE", assignmentId: b.aid(2, "C"), teamId: teamId(2), triggerRecordId: out, createdAt: "09:35" });
    expect(invalid(b.build(), "09:40")).toEqual([]);
    b.correctRecord(arrival, "09:35");
    expect(invalid(b.build(), "09:40")).toEqual([n]);

    const c = gold();
    c.stationIn(1, "A", "09:10");
    const out2 = c.stationOut(1, "A", "09:25");
    const n2 = c.notify({ kind: "TRANSITION_OVERDUE", assignmentId: c.aid(2, "C"), teamId: teamId(2), triggerRecordId: out2, createdAt: "09:32" });
    expect(invalid(c.build(), "09:33")).toEqual([]);
    c.cancel(2, "C");
    expect(invalid(c.build(), "09:33")).toEqual([n2]);
  });

  it("TRANSITION_OVERDUE：上一關出關被撤銷 → 失效；未到第一關（trigger null）照常判斷", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const out = b.stationOut(1, "A", "09:25");
    const n = b.notify({ kind: "TRANSITION_OVERDUE", assignmentId: b.aid(2, "C"), teamId: teamId(2), triggerRecordId: out, createdAt: "09:32" });
    // 第4小隊「未到第一關」（trigger null）：09:10 時 B 沒有任何紀錄
    b.notify({ kind: "TRANSITION_OVERDUE", assignmentId: b.aid(1, "B"), teamId: teamId(4), createdAt: "09:10" });
    b.voidRecord(out, "09:33");
    expect(invalid(b.build(), "09:34")).toEqual([n]);
    // 第4小隊 09:12 才到 B → 仍是真的逾期
    b.teamIn(1, "B", 4, "09:12");
    expect(invalid(b.build(), "09:34")).toEqual([n]);
    // 修正成 09:10 前到 → 失效
    const b2 = gold();
    const early = b2.teamIn(1, "B", 4, "09:12");
    const f2 = b2.notify({ kind: "TRANSITION_OVERDUE", assignmentId: b2.aid(1, "B"), teamId: teamId(4), createdAt: "09:10" });
    b2.correctRecord(early, "09:09:30");
    expect(invalid(b2.build(), "09:34")).toEqual([f2]);
  });

  it("PREV_NOT_CHECKED_OUT：補登出關早於抵達 → 失效；晚於抵達 → 保留", () => {
    const mk = (checkout: string) => {
      const b = gold();
      b.stationIn(1, "A", "09:10");
      b.stationIn(1, "C", "09:10");
      b.stationOut(1, "C", "09:25");
      const arrival = b.teamIn(2, "C", 2, "09:30");
      const n = b.notify({ kind: "PREV_NOT_CHECKED_OUT", assignmentId: b.aid(1, "A"), teamId: teamId(2), triggerRecordId: arrival, createdAt: "09:30" });
      b.stationOut(1, "A", checkout, { source: "admin_correction" });
      return { snap: b.build(), n };
    };
    const early = mk("09:25");
    expect(invalid(early.snap, "09:40")).toEqual([early.n]);
    const late = mk("09:31");
    expect(invalid(late.snap, "09:40")).toEqual([]);
  });

  it("RECORD_MISMATCH TEAM_OUT_STATION_NOT_OUT：關主出關修正到隊輔出關 15 秒內 → 失效", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamIn(1, "A", 2, "09:10:05");
    const tco = b.teamOut(1, "A", 2, "09:25:10");
    const sco = b.stationOut(1, "A", "09:27");
    const n = b.notify({
      kind: "RECORD_MISMATCH",
      subkind: "TEAM_OUT_STATION_NOT_OUT",
      assignmentId: b.aid(1, "A"),
      teamId: teamId(2),
      triggerRecordId: tco,
      createdAt: "09:25:25",
    });
    expect(invalid(b.build(), "09:30")).toEqual([]);
    b.correctRecord(sco, "09:25:20");
    expect(invalid(b.build(), "09:30")).toEqual([n]);
  });

  it("RECORD_MISMATCH 其他 subkind 依目前紀錄重算", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const tci = b.teamIn(1, "A", 2, "09:12");
    const sco = b.stationOut(1, "A", "09:25");
    const tco = b.teamOut(1, "A", 2, "09:26:30");
    const notIn = b.notify({ kind: "RECORD_MISMATCH", subkind: "TEAM_NOT_CHECKED_IN", assignmentId: b.aid(1, "A"), teamId: teamId(2), triggerRecordId: sci });
    const diff = b.notify({ kind: "RECORD_MISMATCH", subkind: "CHECKOUT_TIME_DIFF", assignmentId: b.aid(1, "A"), teamId: teamId(2), triggerRecordId: tco });
    const notOut = b.notify({ kind: "RECORD_MISMATCH", subkind: "TEAM_NOT_CHECKED_OUT", assignmentId: b.aid(1, "A"), teamId: teamId(2), triggerRecordId: sco });
    // 09:12 > 09:11:30 → 隊輔未確認進關確實成立過；差 90 秒 > 60 → 紀錄不一致成立；09:26:30 <= 09:26:30 → 未確認出關沒成立
    expect(invalid(b.build(), "09:40")).toEqual([notOut]);
    b.correctRecord(tci, "09:10:30");
    b.correctRecord(tco, "09:25:30");
    expect(invalid(b.build(), "09:40").sort()).toEqual([notIn, diff, notOut].sort());
  });

  it("TEAM_CHECK_IN_MISSING：補登進關（早於出關）→ 失效", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const tco = b.teamOut(1, "A", 2, "09:25");
    const n = b.notify({ kind: "RECORD_MISMATCH", subkind: "TEAM_CHECK_IN_MISSING", assignmentId: b.aid(1, "A"), teamId: teamId(2), triggerRecordId: tco });
    expect(invalid(b.build(), "09:30")).toEqual([]);
    b.record("team_check_in", 1, "A", "09:10:10", { team: 2, source: "admin_correction" });
    expect(invalid(b.build(), "09:30")).toEqual([n]);
  });

  it("STATION_NOT_STARTED：關主在門檻前其實已進關（修正時間）→ 失效", () => {
    const b = gold();
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    const tci = b.teamIn(2, "C", 2, "09:30");
    const sci = b.stationIn(2, "C", "09:36");
    const n = b.notify({ kind: "STATION_NOT_STARTED", assignmentId: b.aid(2, "C"), triggerRecordId: tci, createdAt: "09:35" });
    expect(invalid(b.build(), "09:40")).toEqual([]);
    b.correctRecord(sci, "09:34");
    expect(invalid(b.build(), "09:40")).toEqual([n]);
  });

  it("STATION_SHORTENED 只看 trigger；SCHEDULE_ADJUSTED / SELF_UNDO 不處理；已失效的不回傳", () => {
    const b = land();
    const sci = b.stationIn(4, "B", "14:37");
    const shortened = b.notify({ kind: "STATION_SHORTENED", assignmentId: b.aid(4, "B"), triggerRecordId: sci });
    b.notify({ kind: "SCHEDULE_ADJUSTED" });
    b.notify({ kind: "SELF_UNDO", assignmentId: b.aid(4, "B"), triggerRecordId: sci });
    expect(invalid(b.build(), "14:40")).toEqual([]);
    b.voidRecord(sci, "14:38");
    expect(invalid(b.build(), "14:40")).toEqual([shortened]);
    const snap = b.build();
    snap.notifications = snap.notifications.map((x) => (x.id === shortened ? { ...x, invalidatedAt: t("14:39") } : x));
    expect(notificationsToInvalidate(snap, t("14:40"))).toEqual([]);
  });

  it("目前成立的條件建立的通知全部有效（與 deriveGame 一致）", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamOut(1, "A", 2, "09:24");
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    const now = "09:40";
    const d = deriveGame(b.build(), t(now));
    expect(d.conditions.length).toBeGreaterThan(5);
    for (const c of d.conditions) {
      b.notify({
        kind: c.kind,
        subkind: c.subkind,
        assignmentId: c.assignmentId,
        teamId: c.teamId,
        triggerRecordId: c.triggerRecordId,
        triggerOverrideId: c.triggerOverrideId,
        createdAt: now,
      });
    }
    expect(invalid(b.build(), now)).toEqual([]);
  });
});

/** 模擬 server 已把這些通知標為失效（invalidate_notifications） */
function withInvalidated(snap: GameSnapshot, ids: string[], at = "09:00"): GameSnapshot {
  const set = new Set(ids);
  return {
    ...snap,
    notifications: snap.notifications.map((x) => (set.has(x.id) ? { ...x, invalidatedAt: t(at) } : x)),
  };
}

function revalid(snap: GameSnapshot, time: string): string[] {
  return notificationsToRevalidate(snap, t(time));
}

describe("notificationsToRevalidate", () => {
  it("撤銷延長 → 原本（無 override）的超時通知恢復，延長後那一則失效", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const old = b.notify({ kind: "STATION_OVERTIME", assignmentId: b.aid(1, "A"), triggerRecordId: sci, createdAt: "09:25" });
    const ovr = b.override(1, "A", "09:30");
    const again = b.notify({
      kind: "STATION_OVERTIME",
      assignmentId: b.aid(1, "A"),
      triggerRecordId: sci,
      triggerOverrideId: ovr,
      createdAt: "09:30",
    });
    // 延長後：舊的被解除（server 已標記）
    let snap = withInvalidated(b.build(), [old], "09:26");
    expect(invalid(snap, "09:31")).toEqual([]);
    expect(revalid(snap, "09:31")).toEqual([]);
    // 撤銷延長
    b.voidOverride(ovr);
    snap = withInvalidated(b.build(), [old], "09:26");
    expect(invalid(snap, "09:32")).toEqual([again]);
    expect(revalid(snap, "09:32")).toEqual([old]);
  });

  it("撤銷取消 → 被取消解除的跑關逾期恢復", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    const out = b.stationOut(1, "A", "09:25");
    const n = b.notify({ kind: "TRANSITION_OVERDUE", assignmentId: b.aid(2, "C"), teamId: teamId(2), triggerRecordId: out, createdAt: "09:32" });
    const cid = b.cancel(2, "C");
    expect(invalid(b.build(), "09:33")).toEqual([n]);
    expect(revalid(withInvalidated(b.build(), [n], "09:33"), "09:34")).toEqual([]);
    b.voidCancellation(cid);
    const snap = withInvalidated(b.build(), [n], "09:33");
    expect(revalid(snap, "09:34")).toEqual([n]);
    expect(invalid(snap, "09:34")).toEqual([]);
  });

  it("出關時間修正後又改回來 → 超時通知恢復", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const sco = b.stationOut(1, "A", "09:27");
    const n = b.notify({ kind: "STATION_OVERTIME", assignmentId: b.aid(1, "A"), triggerRecordId: sci, createdAt: "09:25" });
    const fixed = b.correctRecord(sco, "09:24:50");
    expect(invalid(b.build(), "09:40")).toEqual([n]);
    expect(revalid(withInvalidated(b.build(), [n]), "09:40")).toEqual([]);
    b.correctRecord(fixed, "09:27");
    expect(revalid(withInvalidated(b.build(), [n]), "09:40")).toEqual([n]);
  });

  it("trigger 已撤銷的不恢復；SCHEDULE_ADJUSTED / SELF_UNDO / STATION_SHORTENED 不恢復", () => {
    const b = land();
    const sci = b.stationIn(4, "B", "14:26");
    const over = b.notify({ kind: "STATION_OVERTIME", assignmentId: b.aid(4, "B"), triggerRecordId: sci, createdAt: "14:47" });
    const shortened = b.notify({ kind: "STATION_SHORTENED", assignmentId: b.aid(4, "B"), triggerRecordId: sci });
    const adj = b.notify({ kind: "SCHEDULE_ADJUSTED" });
    const undo = b.notify({ kind: "SELF_UNDO", assignmentId: b.aid(4, "B"), triggerRecordId: sci });
    // 條件其實成立，但這幾種不由推導恢復
    const snap = withInvalidated(b.build(), [shortened, adj, undo]);
    expect(revalid(snap, "14:50")).toEqual([]);
    // trigger 撤銷 → 失效且不恢復
    b.voidRecord(sci, "14:48");
    const snap2 = withInvalidated(b.build(), [over]);
    expect(revalid(snap2, "14:50")).toEqual([]);
  });

  it("RECORD_MISMATCH 未知 subkind 不恢復（保守）", () => {
    const b = gold();
    const sci = b.stationIn(1, "A", "09:10");
    const n = b.notify({ kind: "RECORD_MISMATCH", subkind: "SOMETHING_NEW", assignmentId: b.aid(1, "A"), teamId: teamId(2), triggerRecordId: sci });
    expect(revalid(withInvalidated(b.build(), [n]), "09:40")).toEqual([]);
  });

  it("失效與恢復互斥，且兩者合起來 = 依目前紀錄的正確狀態（重複執行不會來回跳）", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.teamOut(1, "A", 2, "09:24");
    b.stationIn(1, "C", "09:10");
    b.stationOut(1, "C", "09:25");
    const now = "09:40";
    const d = deriveGame(b.build(), t(now));
    const ids: string[] = [];
    for (const c of d.conditions) {
      ids.push(
        b.notify({
          kind: c.kind,
          subkind: c.subkind,
          assignmentId: c.assignmentId,
          teamId: c.teamId,
          triggerRecordId: c.triggerRecordId,
          triggerOverrideId: c.triggerOverrideId,
          createdAt: now,
        }),
      );
    }
    // 全部誤標失效 → 全部恢復；恢復後不再失效
    const all = withInvalidated(b.build(), ids);
    const back = revalid(all, now);
    expect(back.sort()).toEqual([...ids].sort());
    expect(invalid(all, now)).toEqual([]);
    const restored = withInvalidated(b.build(), []);
    expect(invalid(restored, now)).toEqual([]);
    expect(revalid(restored, now)).toEqual([]);
  });
});

describe("buildConditionMessage", () => {
  it("關卡超時：黃金一隊、大地兩隊", () => {
    const g = gold();
    g.stationIn(1, "A", "09:10");
    let snap = g.build();
    let d = deriveGame(snap, t("09:26"));
    let c = findCondition(d, { kind: "STATION_OVERTIME", subkind: null, assignmentId: g.aid(1, "A"), teamId: null })!;
    expect(buildConditionMessage(c, snap, d)).toBe("九九乘法－第2小隊已超時");

    const l = land();
    l.stationIn(4, "B", "14:26");
    snap = l.build();
    d = deriveGame(snap, t("14:47"));
    c = findCondition(d, { kind: "STATION_OVERTIME", subkind: null, assignmentId: l.aid(4, "B"), teamId: null })!;
    expect(buildConditionMessage(c, snap, d)).toBe("歐北共－第2小隊、第4小隊已超時");
  });

  it("跑關逾期與未到第一關", () => {
    const g = gold();
    g.stationIn(1, "A", "09:10");
    g.stationOut(1, "A", "09:25");
    let snap = g.build();
    let d = deriveGame(snap, t("09:33"));
    let c = findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: g.aid(2, "C"), teamId: teamId(2) })!;
    expect(buildConditionMessage(c, snap, d)).toBe("第2小隊 跑關逾期（前往 3的倍數）");

    const l = land();
    snap = l.build();
    d = deriveGame(snap, t("13:05"));
    c = findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: l.aid(1, "A"), teamId: teamId(8) })!;
    expect(buildConditionMessage(c, snap, d)).toBe("第8小隊 未到第一關（ㄇㄉㄈㄎ）");
    c = findCondition(d, { kind: "TRANSITION_OVERDUE", subkind: null, assignmentId: l.aid(1, "B"), teamId: teamId("S") })!;
    expect(buildConditionMessage(c, snap, d)).toBe("幹部隊 未到第一關（歐北共）");
  });

  it("關主未開始（大地兩隊）", () => {
    const l = land();
    l.stationIn(3, "B", "13:59");
    l.stationOut(3, "B", "14:19");
    l.teamIn(4, "B", 2, "14:24");
    l.teamIn(4, "B", 4, "14:25");
    const snap = l.build();
    const d = deriveGame(snap, t("14:30"));
    const c = findCondition(d, { kind: "STATION_NOT_STARTED", subkind: null, assignmentId: l.aid(4, "B"), teamId: null })!;
    expect(buildConditionMessage(c, snap, d)).toBe("歐北共：第2小隊、第4小隊都已到關超過 3 分鐘，關主尚未開始");
  });

  it("漏按出關", () => {
    const g = gold();
    g.stationIn(1, "H", "09:10"); // 鐵頭功 第9小隊
    g.stationIn(1, "I", "09:10");
    g.stationOut(1, "I", "09:25");
    g.teamIn(2, "I", 9, "09:30"); // 第9小隊到節奏達人
    const snap = g.build();
    const d = deriveGame(snap, t("09:31"));
    const c = findCondition(d, { kind: "PREV_NOT_CHECKED_OUT", subkind: null, assignmentId: g.aid(1, "H"), teamId: teamId(9) })!;
    expect(buildConditionMessage(c, snap, d)).toBe("第9小隊已到下一關，鐵頭功尚未按出關");
  });

  it("隊輔已出關，關主未出關", () => {
    const g = gold();
    g.stationIn(1, "A", "09:10");
    g.teamIn(1, "A", 2, "09:10:23");
    g.teamOut(1, "A", 2, "09:25:10");
    const snap = g.build();
    const d = deriveGame(snap, t("09:25:30"));
    const c = findCondition(d, { kind: "RECORD_MISMATCH", subkind: "TEAM_OUT_STATION_NOT_OUT", assignmentId: g.aid(1, "A"), teamId: teamId(2) })!;
    expect(buildConditionMessage(c, snap, d)).toBe("第2小隊隊輔已於 09:25:10 回報出關，九九乘法關主尚未確認出關");
  });

  it("合併 Toast", () => {
    const n = (kind: NotificationKind, message: string) => ({ kind, message });
    expect(buildToastSummary([])).toBe("");
    expect(buildToastSummary([n("STATION_OVERTIME", "九九乘法－第2小隊已超時")])).toBe("九九乘法－第2小隊已超時");
    expect(
      buildToastSummary([
        n("STATION_OVERTIME", "a"),
        n("STATION_OVERTIME", "b"),
        n("STATION_OVERTIME", "c"),
        n("TRANSITION_OVERDUE", "第2小隊 跑關逾期（前往 3的倍數）"),
      ]),
    ).toBe("3 關超時；第2小隊 跑關逾期（前往 3的倍數）");
  });
});

describe("classify（通知對象）", () => {
  function notif(partial: Partial<AppNotification> & { kind: NotificationKind }): AppNotification {
    return {
      id: "n",
      subkind: null,
      assignmentId: null,
      teamId: null,
      triggerRecordId: null,
      triggerAdjustmentId: null,
      triggerCancellationId: null,
      triggerOverrideId: null,
      triggerPhase: "CREATE",
      message: "",
      invalidatedAt: null,
      createdAt: 0,
      ...partial,
    };
  }
  const b = land();
  const snap = b.build();
  const B4 = b.aid(4, "B"); // 歐北共 第2小隊 vs 第4小隊
  const stB = { page: "station" as const, stationId: "land-st-B" };
  const stA = { page: "station" as const, stationId: "land-st-A" };
  const team2 = { page: "team" as const, teamId: teamId(2) };
  const team4 = { page: "team" as const, teamId: teamId(4) };
  const team6 = { page: "team" as const, teamId: teamId(6) };
  const dash = { page: "dashboard" as const };
  const admin = { page: "admin" as const };

  it("STATION_OVERTIME / STATION_NOT_STARTED → Dashboard、該關關主頁、相關兩隊隊輔頁（A 類）", () => {
    for (const kind of ["STATION_OVERTIME", "STATION_NOT_STARTED"] as const) {
      const n = notif({ kind, assignmentId: B4 });
      expect(isToastNotification(n, snap, dash)).toBe(true);
      expect(isToastNotification(n, snap, stB)).toBe(true);
      expect(isToastNotification(n, snap, stA)).toBe(false);
      expect(isToastNotification(n, snap, team2)).toBe(true);
      expect(isToastNotification(n, snap, team4)).toBe(true);
      expect(isToastNotification(n, snap, team6)).toBe(false);
    }
  });

  it("TRANSITION_OVERDUE → Dashboard、該隊隊輔頁、目標關卡關主頁", () => {
    const n = notif({ kind: "TRANSITION_OVERDUE", assignmentId: B4, teamId: teamId(4) });
    expect(isToastNotification(n, snap, dash)).toBe(true);
    expect(isToastNotification(n, snap, stB)).toBe(true);
    expect(isToastNotification(n, snap, team4)).toBe(true);
    expect(isToastNotification(n, snap, team2)).toBe(false);
  });

  it("PREV_NOT_CHECKED_OUT → Dashboard、X 的關主頁、該隊隊輔頁", () => {
    const n = notif({ kind: "PREV_NOT_CHECKED_OUT", assignmentId: B4, teamId: teamId(2) });
    expect(isToastNotification(n, snap, stB)).toBe(true);
    expect(isToastNotification(n, snap, team2)).toBe(true);
    expect(isToastNotification(n, snap, team4)).toBe(false);
    expect(isToastNotification(n, snap, stA)).toBe(false);
  });

  it("STATION_SHORTENED → Dashboard、admin", () => {
    const n = notif({ kind: "STATION_SHORTENED", assignmentId: B4 });
    expect(isToastNotification(n, snap, dash)).toBe(true);
    expect(isToastNotification(n, snap, admin)).toBe(true);
    expect(isRelevantNotification(n, snap, stB)).toBe(false);
    expect(isRelevantNotification(n, snap, team2)).toBe(false);
  });

  it("SCHEDULE_ADJUSTED → 全部頁面", () => {
    const n = notif({ kind: "SCHEDULE_ADJUSTED" });
    for (const ctx of [dash, admin, stA, stB, team2, team6]) expect(isToastNotification(n, snap, ctx)).toBe(true);
  });

  it("SCHEDULE_ADJUSTED 在尚未選隊伍／關卡的頁面也要列出並跳 Toast", () => {
    const n = notif({ kind: "SCHEDULE_ADJUSTED" });
    const noTeam = { page: "team" as const, teamId: null };
    const noStation = { page: "station" as const, stationId: null };
    const bare = [noTeam, noStation, { page: "team" as const }, { page: "station" as const }];
    for (const ctx of bare) {
      expect(isRelevantNotification(n, snap, ctx)).toBe(true);
      expect(isToastNotification(n, snap, ctx)).toBe(true);
    }
    // 其他種類在這些頁面仍不相關
    const over = notif({ kind: "STATION_OVERTIME", assignmentId: B4 });
    for (const ctx of bare) expect(isRelevantNotification(over, snap, ctx)).toBe(false);
    // 已解除的一樣不跳
    expect(isToastNotification(notif({ kind: "SCHEDULE_ADJUSTED", invalidatedAt: 1 }), snap, noTeam)).toBe(false);
  });

  it("SELF_UNDO 與一般 RECORD_MISMATCH 只進通知中心；TEAM_OUT_STATION_NOT_OUT 只對該關關主頁跳 Toast", () => {
    const undo = notif({ kind: "SELF_UNDO", assignmentId: B4 });
    expect(isRelevantNotification(undo, snap, dash)).toBe(true);
    expect(isRelevantNotification(undo, snap, stB)).toBe(true);
    expect(isToastNotification(undo, snap, dash)).toBe(false);
    expect(isToastNotification(undo, snap, stB)).toBe(false);

    const diff = notif({ kind: "RECORD_MISMATCH", subkind: "CHECKOUT_TIME_DIFF", assignmentId: B4, teamId: teamId(2) });
    expect(isRelevantNotification(diff, snap, dash)).toBe(true);
    expect(isToastNotification(diff, snap, stB)).toBe(false);

    const out = notif({ kind: "RECORD_MISMATCH", subkind: "TEAM_OUT_STATION_NOT_OUT", assignmentId: B4, teamId: teamId(2) });
    expect(isToastNotification(out, snap, stB)).toBe(true);
    expect(isToastNotification(out, snap, stA)).toBe(false);
    expect(isToastNotification(out, snap, dash)).toBe(false);
    expect(isToastNotification(out, snap, team2)).toBe(false);
    expect(isRelevantNotification(out, snap, team2)).toBe(true);
  });

  it("已解除的通知不跳 Toast", () => {
    const n = notif({ kind: "STATION_OVERTIME", assignmentId: B4, invalidatedAt: 1 });
    expect(isRelevantNotification(n, snap, dash)).toBe(true);
    expect(isToastNotification(n, snap, dash)).toBe(false);
  });

  it("isConditionRelevant：頁面只偵測自己的條件", () => {
    const c = { kind: "STATION_OVERTIME" as const, subkind: null, assignmentId: B4, teamId: null, triggerRecordId: "r", triggerOverrideId: null };
    expect(isConditionRelevant(c, snap, dash)).toBe(true);
    expect(isConditionRelevant(c, snap, stB)).toBe(true);
    expect(isConditionRelevant(c, snap, stA)).toBe(false);
    expect(isConditionRelevant(c, snap, team4)).toBe(true);
    expect(isConditionRelevant(c, snap, team6)).toBe(false);
    expect(isConditionRelevant(c, snap, { page: "station", stationId: null })).toBe(false);
  });
});
