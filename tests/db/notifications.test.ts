/**
 * 通知（SPEC 第十、十五、三十節；真 Postgres）：
 * 與 /api/notifications/check 相同的 server 流程（快照 → deriveGame → findCondition → create_notification）。
 * 同一事件多次 insert 只留一筆、條件不成立時不寫入（not_yet）、PREV_NOT_CHECKED_OUT、
 * TEAM_OUT_STATION_NOT_OUT（隊輔已出關，關主未出關）、CHECKOUT_TIME_DIFF（出關時間差 > 60 秒）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notificationsToInvalidate } from "@/lib/notifications/validity";
import { loadDbTestEnv } from "./helpers/env";
import {
  checkCreated,
  countRows,
  createServiceClient,
  derive,
  notifyLikeRoute,
  rpc,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";

const env = loadDbTestEnv();

describe.skipIf(!env)("DB：通知", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let gameId: string;

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "notifications",
      teams: ["N1", "N3", "N4"],
      games: [
        {
          code: "gold",
          stations: ["K1", "K2", "K3", "K4"],
          assignments: [
            { slot: 1, station: "K1", teams: ["N1"] },
            { slot: 2, station: "K2", teams: ["N1"] },
            { slot: 1, station: "K3", teams: ["N3"] },
            { slot: 1, station: "K4", teams: ["N4"] },
          ],
        },
      ],
    });
    gameId = fx.game("gold").id;

    // 三關都在 09:12 開始（K3、K4 的隊輔也確認進關）
    await fx.at("09:12");
    await checkCreated(client, { assignmentId: fx.a(1, "K1"), action: "station_check_in", identityId: fx.stationIdentity("K1") });
    for (const [st, team] of [
      ["K3", "N3"],
      ["K4", "N4"],
    ] as const) {
      await checkCreated(client, { assignmentId: fx.a(1, st), action: "station_check_in", identityId: fx.stationIdentity(st) });
      await checkCreated(client, {
        assignmentId: fx.a(1, st),
        action: "team_check_in",
        teamId: fx.team(team),
        identityId: fx.teamIdentity(team),
      });
    }
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("條件不成立時 server 不寫入（not_yet）", async () => {
    await fx.at("09:20");
    const k3 = fx.a(1, "K3");
    const n3 = fx.team("N3");
    const before = await countRows(client, "notifications", (q) => q.eq("game_id", gameId));

    expect((await notifyLikeRoute(client, gameId, { kind: "STATION_OVERTIME", assignmentId: k3 })).result).toBe("not_yet");
    expect(
      (
        await notifyLikeRoute(client, gameId, {
          kind: "RECORD_MISMATCH",
          subkind: "TEAM_OUT_STATION_NOT_OUT",
          assignmentId: k3,
          teamId: n3,
        })
      ).result,
    ).toBe("not_yet");
    expect((await notifyLikeRoute(client, gameId, { kind: "TRANSITION_OVERDUE", assignmentId: k3, teamId: n3 })).result).toBe(
      "not_yet",
    );
    expect(
      (await notifyLikeRoute(client, gameId, { kind: "PREV_NOT_CHECKED_OUT", assignmentId: fx.a(1, "K1"), teamId: fx.team("N1") }))
        .result,
    ).toBe("not_yet");

    expect(await countRows(client, "notifications", (q) => q.eq("game_id", gameId))).toBe(before);
  });

  it("隊輔已出關、關主未出關 → 標籤立即出現；寬限後建立 RECORD_MISMATCH / TEAM_OUT_STATION_NOT_OUT", async () => {
    await fx.at("09:20:00");
    const k3 = fx.a(1, "K3");
    const n3 = fx.team("N3");
    const tco = await checkCreated(client, {
      assignmentId: k3,
      action: "team_check_out",
      teamId: n3,
      identityId: fx.teamIdentity("N3"),
    });

    const { d } = await derive(client, gameId);
    const tag = d.assignments.get(k3)!.tags.find((t) => t.kind === "TEAM_OUT_STATION_NOT_OUT");
    expect(tag).toBeDefined();
    expect(tag!.teamId).toBe(n3);
    expect(tag!.triggerRecordId).toBe(tco.id);

    await fx.at("09:20:30");
    const r = await notifyLikeRoute(client, gameId, {
      kind: "RECORD_MISMATCH",
      subkind: "TEAM_OUT_STATION_NOT_OUT",
      assignmentId: k3,
      teamId: n3,
    });
    expect(r.result).toBe("created");
    expect(r.notification).toMatchObject({
      kind: "RECORD_MISMATCH",
      subkind: "TEAM_OUT_STATION_NOT_OUT",
      assignment_id: k3,
      team_id: n3,
      trigger_record_id: tco.id,
      invalidated_at: null,
    });
    expect(r.notification!.message).toContain("回報出關");
  });

  it("雙方出關時間差 > 60 秒 → 「紀錄不一致」（CHECKOUT_TIME_DIFF）；先前的 TEAM_OUT_STATION_NOT_OUT 不會被判定失效", async () => {
    await fx.at("09:21:40");
    const k3 = fx.a(1, "K3");
    const n3 = fx.team("N3");
    await checkCreated(client, { assignmentId: k3, action: "station_check_out", identityId: fx.stationIdentity("K3") });

    const { snap, d, now } = await derive(client, gameId);
    const tags = d.assignments.get(k3)!.tags.map((t) => t.kind);
    expect(tags).toContain("CHECKOUT_TIME_DIFF");
    expect(tags).not.toContain("TEAM_OUT_STATION_NOT_OUT");

    const r = await notifyLikeRoute(client, gameId, {
      kind: "RECORD_MISMATCH",
      subkind: "CHECKOUT_TIME_DIFF",
      assignmentId: k3,
      teamId: n3,
    });
    expect(r.result).toBe("created");
    expect(r.notification?.subkind).toBe("CHECKOUT_TIME_DIFF");

    // 關主補按出關後，隊輔已出關的條件不再「目前成立」（不會再建立），但它確實發生過 → 不標記失效
    expect(
      (
        await notifyLikeRoute(client, gameId, {
          kind: "RECORD_MISMATCH",
          subkind: "TEAM_OUT_STATION_NOT_OUT",
          assignmentId: k3,
          teamId: n3,
        })
      ).result,
    ).toBe("not_yet");
    const outNotice = snap.notifications.find((n) => n.subkind === "TEAM_OUT_STATION_NOT_OUT" && n.assignmentId === k3)!;
    expect(outNotice).toBeDefined();
    expect(notificationsToInvalidate(snap, now)).not.toContain(outNotice.id);
  });

  it("雙方出關時間差 <= 60 秒 → 不建立 CHECKOUT_TIME_DIFF", async () => {
    const k4 = fx.a(1, "K4");
    const n4 = fx.team("N4");
    await fx.at("09:22:00");
    await checkCreated(client, { assignmentId: k4, action: "team_check_out", teamId: n4, identityId: fx.teamIdentity("N4") });
    await fx.at("09:22:30");
    await checkCreated(client, { assignmentId: k4, action: "station_check_out", identityId: fx.stationIdentity("K4") });

    const { d } = await derive(client, gameId);
    const tags = d.assignments.get(k4)!.tags.map((t) => t.kind);
    expect(tags).not.toContain("CHECKOUT_TIME_DIFF");
    expect(tags).not.toContain("TEAM_OUT_STATION_NOT_OUT");
    for (const subkind of ["CHECKOUT_TIME_DIFF", "TEAM_OUT_STATION_NOT_OUT"]) {
      expect((await notifyLikeRoute(client, gameId, { kind: "RECORD_MISMATCH", subkind, assignmentId: k4, teamId: n4 })).result).toBe(
        "not_yet",
      );
    }
  });

  it("上一關漏按出關、隊伍在下一關打卡 → 小隊狀態在下一關；建立 PREV_NOT_CHECKED_OUT（多台同時偵測只有一筆）", async () => {
    await fx.at("09:30");
    const k1 = fx.a(1, "K1");
    const k2 = fx.a(2, "K2");
    const n1 = fx.team("N1");
    // 上一關（K1）還沒按出關，也不會擋住下一關的進關
    const tci = await checkCreated(client, { assignmentId: k2, action: "team_check_in", teamId: n1, identityId: fx.teamIdentity("N1") });

    const { d } = await derive(client, gameId);
    const team = d.teams.get(n1)!;
    expect(team.state).toBe("ARRIVED");
    expect(team.currentAssignmentId).toBe(k2);
    const tag = d.assignments.get(k1)!.tags.find((t) => t.kind === "PREV_NOT_CHECKED_OUT");
    expect(tag).toMatchObject({ teamId: n1, triggerRecordId: tci.id });
    expect(d.conditions).toContainEqual({
      kind: "PREV_NOT_CHECKED_OUT",
      subkind: null,
      assignmentId: k1,
      teamId: n1,
      triggerRecordId: tci.id,
      triggerOverrideId: null,
    });

    // 5 台裝置同時偵測到 → 只建立一筆
    const results = await Promise.all(
      Array.from({ length: 5 }, () => notifyLikeRoute(client, gameId, { kind: "PREV_NOT_CHECKED_OUT", assignmentId: k1, teamId: n1 })),
    );
    expect(results.filter((r) => r.result === "created")).toHaveLength(1);
    expect(results.filter((r) => r.result === "exists")).toHaveLength(4);
    const ids = new Set(results.map((r) => r.notification?.id));
    expect(ids.size).toBe(1);
    const created = results.find((r) => r.result === "created")!.notification!;
    expect(created.trigger_record_id).toBe(tci.id);
    expect(created.message).toContain("已到下一關");
    expect(
      await countRows(client, "notifications", (q) => q.eq("kind", "PREV_NOT_CHECKED_OUT").eq("assignment_id", k1)),
    ).toBe(1);
  });

  it("同一事件多次 insert（create_notification 同一組 key）只留一筆", async () => {
    await fx.at("09:30");
    const k1 = fx.a(1, "K1");
    const first = await notifyLikeRoute(client, gameId, { kind: "STATION_OVERTIME", assignmentId: k1 });
    expect(first.result).toBe("created");
    const c = first.condition!;

    const params = {
      p_kind: c.kind,
      p_subkind: c.subkind,
      p_game_id: gameId,
      p_assignment_id: c.assignmentId,
      p_team_id: c.teamId,
      p_trigger_record_id: c.triggerRecordId,
      p_trigger_override_id: c.triggerOverrideId,
      p_message: "重複 insert",
    };
    const again = await Promise.all([
      rpc<{ result: string; notification: { id: string } }>(client, "create_notification", params),
      rpc<{ result: string; notification: { id: string } }>(client, "create_notification", params),
    ]);
    for (const r of again) {
      expect(r.result).toBe("exists");
      expect(r.notification.id).toBe(first.notification!.id);
    }
    expect(
      await countRows(client, "notifications", (q) => q.eq("kind", "STATION_OVERTIME").eq("assignment_id", k1)),
    ).toBe(1);
  });
});
