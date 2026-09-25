/**
 * FIXED_END／大地等人（SPEC 第八、十五、十八、二十一、三十節；真 Postgres）：
 * BOTH_TEAMS_REQUIRED 與 ADMIN 單隊開始、14:29 開始的壓縮與 STATION_SHORTENED（兩側）、
 * 時段結束後 SLOT_ALREADY_ENDED 與未來的 end override、先到的隊伍不逾期。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDbTestEnv } from "./helpers/env";
import {
  checkCreated,
  countRows,
  createServiceClient,
  derive,
  notificationsOf,
  notifyLikeRoute,
  recordCheck,
  rpc,
  type StatusResult,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";
import { taipeiLocalToMs } from "@/lib/time";

const env = loadDbTestEnv();

describe.skipIf(!env)("DB：FIXED_END／大地等人", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let gameId: string;

  const both = (x: string, y: string) => [fx.team(x), fx.team(y)];

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "fixed-end",
      teams: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      games: [
        {
          code: "land",
          stations: ["L1", "L2", "L3", "L4", "L5", "L6", "L7"],
          assignments: [
            { slot: 1, station: "L1", teams: ["A", "B"] },
            { slot: 1, station: "L2", teams: ["C", "D"] },
            { slot: 1, station: "L7", teams: ["G", "H"] },
            { slot: 4, station: "L3", teams: ["E", "F"] },
            { slot: 4, station: "L4", teams: ["G", "H"] },
            { slot: 4, station: "L5", teams: ["I", "J"] },
            { slot: 4, station: "L6", teams: ["A", "B"] },
          ],
        },
      ],
    });
    gameId = fx.game("land").id;
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("confirmed_team_ids 只有一隊 → BOTH_TEAMS_REQUIRED；ADMIN 帶 single_team_override＋原因才成功", async () => {
    await fx.at("13:06");
    const aid = fx.a(1, "L1");
    const sid = fx.stationIdentity("L1");
    const onlyA = [fx.team("A")];

    expect(
      await recordCheck(client, { assignmentId: aid, action: "station_check_in", identityId: sid, confirmedTeamIds: onlyA }),
    ).toMatchObject({ status: "rejected", code: "BOTH_TEAMS_REQUIRED" });
    expect(await recordCheck(client, { assignmentId: aid, action: "station_check_in", identityId: sid })).toMatchObject({
      status: "rejected",
      code: "BOTH_TEAMS_REQUIRED",
    });
    // 關主不能單隊開始
    expect(
      await recordCheck(client, {
        assignmentId: aid,
        action: "station_check_in",
        identityId: sid,
        confirmedTeamIds: onlyA,
        singleTeamOverride: true,
        reason: "對手未到",
      }),
    ).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    // ADMIN 沒寫原因
    expect(
      await recordCheck(client, {
        assignmentId: aid,
        action: "station_check_in",
        identityId: fx.adminId,
        confirmedTeamIds: onlyA,
        singleTeamOverride: true,
      }),
    ).toMatchObject({ status: "rejected", code: "REASON_REQUIRED" });
    expect(
      await countRows(client, "audit_logs", (q) => q.eq("action", "REJECTED_CHECK").eq("target_id", aid)),
    ).toBe(4);

    const rec = await checkCreated(client, {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.adminId,
      confirmedTeamIds: onlyA,
      singleTeamOverride: true,
      reason: "B 隊人數不足，總召同意單隊開始",
    });
    expect(rec.single_team_override).toBe(true);
    expect(rec.confirmed_team_ids).toEqual(onlyA);
    expect(rec.team_id).toBeNull();
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "SINGLE_TEAM_START").eq("target_id", rec.id))).toBe(1);

    const { d } = await derive(client, gameId);
    const ad = d.assignments.get(aid)!;
    expect(ad.singleTeamStart).toBe(true);
    expect(ad.state).toBe("IN_PROGRESS");
  });

  it("兩隊都勾選 → 關主正常開始（不是單隊開始）", async () => {
    await fx.at("13:06");
    const rec = await checkCreated(client, {
      assignmentId: fx.a(1, "L2"),
      action: "station_check_in",
      identityId: fx.stationIdentity("L2"),
      confirmedTeamIds: both("C", "D"),
    });
    expect(rec.single_team_override).toBe(false);
    expect([...(rec.confirmed_team_ids ?? [])].sort()).toEqual(both("C", "D").sort());
  });

  it("一隊已到、一隊未到 → 先到的隊伍不逾期，晚到的隊伍照常逾期（TRANSITION_OVERDUE 只建在晚到的那隊）", async () => {
    await fx.at("13:06:30");
    const aid = fx.a(1, "L7");
    await checkCreated(client, {
      assignmentId: aid,
      action: "team_check_in",
      teamId: fx.team("G"),
      identityId: fx.teamIdentity("G"),
    });
    const { d } = await derive(client, gameId);
    const g = d.teams.get(fx.team("G"))!;
    const h = d.teams.get(fx.team("H"))!;
    expect(g.state).toBe("ARRIVED");
    expect(g.arrivedDetail).toBe("WAITING_OPPONENT");
    expect(h.state).toBe("TRANSITION_OVERDUE");
    expect(h.overdueFirstStation).toBe(true);
    expect(h.currentAssignmentId).toBe(aid);

    const late = await notifyLikeRoute(client, gameId, { kind: "TRANSITION_OVERDUE", assignmentId: aid, teamId: fx.team("H") });
    expect(late.result).toBe("created");
    expect(late.notification?.trigger_record_id).toBeNull();
    const early = await notifyLikeRoute(client, gameId, { kind: "TRANSITION_OVERDUE", assignmentId: aid, teamId: fx.team("G") });
    expect(early.result).toBe("not_yet");
  });

  it("第4時段 14:29 開始 → official_end = 14:46，可玩約 17 分鐘、縮短約 03:00；可玩 >= min_play 時不建立 STATION_SHORTENED", async () => {
    await fx.at("14:29:00");
    const aid = fx.a(4, "L3");
    const rec = await checkCreated(client, {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.stationIdentity("L3"),
      confirmedTeamIds: both("E", "F"),
    });
    const notes = await notificationsOf(client, gameId);
    expect(notes.filter((n) => n.kind === "STATION_SHORTENED" && n.trigger_record_id === rec.id)).toHaveLength(0);

    const { d } = await derive(client, gameId);
    const ad = d.assignments.get(aid)!;
    expect(ad.officialEnd).toBe(taipeiLocalToMs(fx.eventDate, "14:46"));
    expect(ad.officialEnd).toBe(ad.slot.scheduledEnd);
    // 按下時間是 14:29:00 加上幾百毫秒的網路／DB 時間
    expect(ad.playableMs!).toBeLessThanOrEqual(17 * 60_000);
    expect(ad.playableMs!).toBeGreaterThan(17 * 60_000 - 10_000);
    expect(ad.shortenedMs!).toBeGreaterThanOrEqual(3 * 60_000);
    expect(ad.shortenedMs!).toBeLessThan(3 * 60_000 + 10_000);
    expect(ad.insufficientTime).toBe(false);
  });

  it("可玩時間 < min_play_seconds → record_check 同一 transaction 建立 STATION_SHORTENED（調高 min_play）", async () => {
    await fx.at("14:29:00");
    const set = await rpc<StatusResult>(client, "update_game_settings", {
      p_game_id: gameId,
      p_end_policy: "FIXED_END",
      p_min_play_seconds: 18 * 60,
      p_identity_id: fx.adminId,
    });
    expect(set.status).toBe("ok");
    try {
      const aid = fx.a(4, "L4");
      const rec = await checkCreated(client, {
        assignmentId: aid,
        action: "station_check_in",
        identityId: fx.stationIdentity("L4"),
        confirmedTeamIds: both("G", "H"),
      });
      const shortened = (await notificationsOf(client, gameId)).filter(
        (n) => n.kind === "STATION_SHORTENED" && n.trigger_record_id === rec.id,
      );
      expect(shortened).toHaveLength(1);
      expect(shortened[0].assignment_id).toBe(aid);
      expect(shortened[0].message).toContain("本場只剩");
      expect(shortened[0].message).toContain("14:46");
      const { d } = await derive(client, gameId);
      expect(d.assignments.get(aid)!.insufficientTime).toBe(true);
    } finally {
      const restore = await rpc<StatusResult>(client, "update_game_settings", {
        p_game_id: gameId,
        p_end_policy: "FIXED_END",
        p_min_play_seconds: 600,
        p_identity_id: fx.adminId,
      });
      expect(restore.status).toBe("ok");
    }
  });

  it("可玩時間 < min_play_seconds → 建立 STATION_SHORTENED（晚開始：14:37，只剩約 9 分鐘）", async () => {
    await fx.at("14:37:00");
    const aid = fx.a(4, "L5");
    const rec = await checkCreated(client, {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.stationIdentity("L5"),
      confirmedTeamIds: both("I", "J"),
    });
    const shortened = (await notificationsOf(client, gameId)).filter(
      (n) => n.kind === "STATION_SHORTENED" && n.trigger_record_id === rec.id,
    );
    expect(shortened).toHaveLength(1);
    expect(shortened[0].message).toContain("本場只剩");
    const { d } = await derive(client, gameId);
    const ad = d.assignments.get(aid)!;
    expect(ad.officialEnd).toBe(taipeiLocalToMs(fx.eventDate, "14:46"));
    expect(ad.playableMs!).toBeLessThanOrEqual(9 * 60_000);
    expect(ad.insufficientTime).toBe(true);
  });

  it("14:46 之後才按開始 → SLOT_ALREADY_ENDED；過去的 override 仍拒絕；未來的 end override 才成功，official_end = override", async () => {
    await fx.at("14:47:00");
    const aid = fx.a(4, "L6");
    const args = {
      assignmentId: aid,
      action: "station_check_in" as const,
      identityId: fx.stationIdentity("L6"),
      confirmedTeamIds: both("A", "B"),
    };
    expect(await recordCheck(client, args)).toMatchObject({ status: "rejected", code: "SLOT_ALREADY_ENDED" });

    const past = await rpc<StatusResult>(client, "set_end_override", {
      p_assignment_id: aid,
      p_official_end: `${fx.eventDate}T14:46:30+08:00`,
      p_reason: "延長（已經過去的時間）",
      p_identity_id: fx.adminId,
    });
    expect(past.status).toBe("ok");
    expect(await recordCheck(client, args)).toMatchObject({ status: "rejected", code: "SLOT_ALREADY_ENDED" });

    const future = await rpc<StatusResult>(client, "set_end_override", {
      p_assignment_id: aid,
      p_official_end: `${fx.eventDate}T14:55:00+08:00`,
      p_reason: "兩隊晚到，總召延長",
      p_identity_id: fx.adminId,
    });
    expect(future.status).toBe("ok");
    expect(future.replaced_override_id).toBe(past.override_id);

    await checkCreated(client, args);
    const { d } = await derive(client, gameId);
    const ad = d.assignments.get(aid)!;
    expect(ad.endOverride?.id).toBe(future.override_id);
    expect(ad.officialEnd).toBe(taipeiLocalToMs(fx.eventDate, "14:55"));
    expect(ad.state).toBe("IN_PROGRESS");
    expect(ad.remainingMs!).toBeGreaterThan(7 * 60_000);
    expect(ad.remainingMs!).toBeLessThanOrEqual(8 * 60_000);
  });
});
