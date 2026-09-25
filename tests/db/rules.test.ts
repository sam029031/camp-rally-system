/**
 * record_check 的規則（SPEC 第二十、二十一、三十節；真 Postgres）：
 * 身分權限（VIEWER 禁止）、PREV_ASSIGNMENT_NOT_CHECKED_OUT（跳過大地休息與被取消的場次）、
 * TEAM_OUT_OF_ORDER、本隊未到（no_show）規則、出關前提。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDbTestEnv } from "./helpers/env";
import {
  checkCreated,
  countRows,
  createServiceClient,
  derive,
  recordCheck,
  rpc,
  undoCheck,
  validRecords,
  type StatusResult,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";

const env = loadDbTestEnv();

describe.skipIf(!env)("DB：record_check 規則", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let goldId: string;
  let landId: string;

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "rules",
      teams: ["R1", "R2", "R3", "R4", "X", "Y", "Z", "W"],
      games: [
        {
          code: "gold",
          stations: ["A1", "A2", "A3"],
          assignments: [
            { slot: 1, station: "A1", teams: ["R1"] },
            { slot: 2, station: "A1", teams: ["R2"] },
            { slot: 1, station: "A2", teams: ["R3"] },
            { slot: 1, station: "A3", teams: ["R4"] },
            { slot: 3, station: "A3", teams: ["R1"] },
          ],
        },
        {
          code: "land",
          stations: ["B1"],
          // B1：第1時段 X vs Y、第2時段休息（沒有 assignment）、第3時段 Z vs W
          assignments: [
            { slot: 1, station: "B1", teams: ["X", "Y"] },
            { slot: 3, station: "B1", teams: ["Z", "W"] },
          ],
        },
      ],
    });
    goldId = fx.game("gold").id;
    landId = fx.game("land").id;
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("身分權限：VIEWER 一律 FORBIDDEN；關主只能自己關卡的關主側、隊輔只能自己隊的隊輔側", async () => {
    await fx.at("09:12");
    const aid = fx.a(1, "A1");
    const r1 = fx.team("R1");
    const cases: Array<[string, Parameters<typeof recordCheck>[1], string]> = [
      ["VIEWER 進關", { assignmentId: aid, action: "station_check_in", identityId: fx.viewerId }, "FORBIDDEN"],
      ["VIEWER 隊輔進關", { assignmentId: aid, action: "team_check_in", teamId: r1, identityId: fx.viewerId }, "FORBIDDEN"],
      ["別關的關主", { assignmentId: aid, action: "station_check_in", identityId: fx.stationIdentity("A2") }, "FORBIDDEN"],
      ["關主按隊輔側", { assignmentId: aid, action: "team_check_in", teamId: r1, identityId: fx.stationIdentity("A1") }, "FORBIDDEN"],
      ["別隊的隊輔", { assignmentId: aid, action: "team_check_in", teamId: r1, identityId: fx.teamIdentity("R2") }, "FORBIDDEN"],
      ["隊輔按關主側", { assignmentId: aid, action: "station_check_in", identityId: fx.teamIdentity("R1") }, "FORBIDDEN"],
      [
        "關主不能強制結束",
        { assignmentId: aid, action: "station_check_out", identityId: fx.stationIdentity("A1"), source: "admin_force", reason: "x" },
        "FORBIDDEN",
      ],
      [
        "隊伍不在這一場",
        { assignmentId: aid, action: "team_check_in", teamId: fx.team("R2"), identityId: fx.adminId },
        "TEAM_NOT_IN_ASSIGNMENT",
      ],
      [
        "現場打卡不接受 client 傳入時間",
        { assignmentId: aid, action: "station_check_in", identityId: fx.stationIdentity("A1"), recordedAt: new Date().toISOString() },
        "INVALID_REQUEST",
      ],
    ];
    for (const [name, args, code] of cases) {
      expect(await recordCheck(client, args), name).toMatchObject({ status: "rejected", code });
    }
    expect(await countRows(client, "check_records", (q) => q.eq("assignment_id", aid))).toBe(0);
    // 被拒絕的打卡寫 audit log
    expect(
      await countRows(client, "audit_logs", (q) => q.eq("action", "REJECTED_CHECK").eq("target_id", aid)),
    ).toBe(cases.length);

    // VIEWER 也不能撤銷、不能調整排程
    const own = await checkCreated(client, { assignmentId: aid, action: "team_check_in", teamId: r1, identityId: fx.teamIdentity("R1") });
    expect(await undoCheck(client, own.id, fx.viewerId)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(
      await rpc<StatusResult>(client, "adjust_schedule", {
        p_game_id: goldId,
        p_from_slot_number: 5,
        p_input_mode: "DELAY",
        p_offset_seconds: 300,
        p_start_at: null,
        p_reason: "唯讀嘗試",
        p_identity_id: fx.viewerId,
      }),
    ).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect((await undoCheck(client, own.id, fx.teamIdentity("R1"))).status).toBe("voided");
  });

  it("本隊未到（no_show）：時段結束前 NO_SHOW_TOO_EARLY；隊輔的進關不算；有關主進關 → NO_SHOW_HAS_CHECK_IN；之後不能再進關", async () => {
    await fx.at("09:20");
    const a2 = fx.a(1, "A2");
    const a3 = fx.a(1, "A3");
    const noShow = (aid: string, st: string) =>
      recordCheck(client, { assignmentId: aid, action: "station_check_out", identityId: fx.stationIdentity(st), noShow: true });

    expect(await noShow(a2, "A2")).toMatchObject({ status: "rejected", code: "NO_SHOW_TOO_EARLY" });
    await checkCreated(client, { assignmentId: a2, action: "team_check_in", teamId: fx.team("R3"), identityId: fx.teamIdentity("R3") });
    await checkCreated(client, { assignmentId: a3, action: "station_check_in", identityId: fx.stationIdentity("A3") });
    // no_show 只能用在 station_check_out
    expect(
      await recordCheck(client, { assignmentId: a2, action: "station_check_in", identityId: fx.stationIdentity("A2"), noShow: true }),
    ).toMatchObject({ status: "rejected", code: "INVALID_REQUEST" });

    await fx.at("09:30");
    const ns = await noShow(a2, "A2");
    expect(ns.status).toBe("created");
    expect(ns.record?.no_show).toBe(true);
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "NO_SHOW").eq("target_id", ns.record!.id))).toBe(1);
    expect(await noShow(a3, "A3")).toMatchObject({ status: "rejected", code: "NO_SHOW_HAS_CHECK_IN" });
    expect(
      await recordCheck(client, { assignmentId: a2, action: "station_check_in", identityId: fx.stationIdentity("A2") }),
    ).toMatchObject({ status: "rejected", code: "CHECKOUT_BEFORE_CHECKIN" });

    const { d } = await derive(client, goldId);
    const ad = d.assignments.get(a2)!;
    expect(ad.state).toBe("CHECKED_OUT");
    expect(ad.noShow).toBe(true);
  });

  it("同一關卡的進關需上一場已出關（PREV_ASSIGNMENT_NOT_CHECKED_OUT）；上一場按本隊未到後即可進關", async () => {
    await fx.at("09:30");
    const s1 = fx.a(1, "A1");
    const s2 = fx.a(2, "A1");
    const sid = fx.stationIdentity("A1");
    expect(await recordCheck(client, { assignmentId: s2, action: "station_check_in", identityId: sid })).toMatchObject({
      status: "rejected",
      code: "PREV_ASSIGNMENT_NOT_CHECKED_OUT",
    });
    // 隊輔側不受「本關上一場」限制（提早到關可以先按）
    await checkCreated(client, { assignmentId: s2, action: "team_check_in", teamId: fx.team("R2"), identityId: fx.teamIdentity("R2") });

    await checkCreated(client, { assignmentId: s1, action: "station_check_out", identityId: sid, noShow: true });
    await checkCreated(client, { assignmentId: s2, action: "station_check_in", identityId: sid });
  });

  it("出關的前提：關主出關需已進關（NO_STATION_CHECK_IN）；隊輔出關需隊輔或關主已進關（TEAM_NOT_CHECKED_IN）", async () => {
    await fx.at("09:56");
    const a3s3 = fx.a(3, "A3");
    expect(
      await recordCheck(client, { assignmentId: a3s3, action: "station_check_out", identityId: fx.stationIdentity("A3") }),
    ).toMatchObject({ status: "rejected", code: "NO_STATION_CHECK_IN" });
    expect(
      await recordCheck(client, { assignmentId: a3s3, action: "team_check_out", teamId: fx.team("R1"), identityId: fx.teamIdentity("R1") }),
    ).toMatchObject({ status: "rejected", code: "TEAM_NOT_CHECKED_IN" });

    // 隊輔漏按進關，但關主已進關 → 可以出關，並標示「隊輔漏按進關」
    const a3s1 = fx.a(1, "A3");
    const r4 = fx.team("R4");
    const tco = await checkCreated(client, { assignmentId: a3s1, action: "team_check_out", teamId: r4, identityId: fx.teamIdentity("R4") });
    const { d } = await derive(client, goldId);
    expect(d.assignments.get(a3s1)!.tags).toContainEqual(
      expect.objectContaining({ kind: "TEAM_CHECK_IN_MISSING", teamId: r4, triggerRecordId: tco.id }),
    );
  });

  it("隊輔不能對比自己已有紀錄更早的 assignment 打卡（TEAM_OUT_OF_ORDER）", async () => {
    await fx.at("09:57");
    const r1 = fx.team("R1");
    const tid = fx.teamIdentity("R1");
    await checkCreated(client, { assignmentId: fx.a(3, "A3"), action: "team_check_in", teamId: r1, identityId: tid });
    expect(
      await recordCheck(client, { assignmentId: fx.a(1, "A1"), action: "team_check_in", teamId: r1, identityId: tid }),
    ).toMatchObject({ status: "rejected", code: "TEAM_OUT_OF_ORDER" });
    expect(
      await recordCheck(client, { assignmentId: fx.a(1, "A1"), action: "team_check_out", teamId: r1, identityId: tid }),
    ).toMatchObject({ status: "rejected", code: "TEAM_OUT_OF_ORDER" });
    expect(await validRecords(client, fx.a(1, "A1"), "team_check_in", r1)).toHaveLength(0);
  });

  it("「該關上一個 assignment」跳過大地休息時段與被取消的 assignment", async () => {
    await fx.at("13:58");
    const s1 = fx.a(1, "B1");
    const s3 = fx.a(3, "B1");
    const args = {
      assignmentId: s3,
      action: "station_check_in" as const,
      identityId: fx.stationIdentity("B1"),
      confirmedTeamIds: [fx.team("Z"), fx.team("W")],
    };
    // 第2時段休息被跳過 → 上一場是第1時段，尚未出關
    expect(await recordCheck(client, args)).toMatchObject({ status: "rejected", code: "PREV_ASSIGNMENT_NOT_CHECKED_OUT" });

    const c = await rpc<StatusResult>(client, "cancel_assignments", {
      p_assignment_ids: [s1],
      p_reason: "道具壞掉",
      p_identity_id: fx.adminId,
    });
    expect(c.status).toBe("ok");
    // 被取消的第1時段也跳過 → 沒有上一場
    await checkCreated(client, args);
    const { d } = await derive(client, landId);
    expect(d.assignments.get(s3)!.prevAssignmentId).toBeNull();
    expect(d.assignments.get(s1)!.state).toBe("CANCELLED");
  });
});
