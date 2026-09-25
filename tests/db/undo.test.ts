/**
 * 現場撤銷（SPEC 第二十二、三十節；真 Postgres）：
 * 59 秒可撤銷、76 秒拒絕（真實時間，Demo 倍速下也一樣）、別的 identity 不能撤銷、
 * 已出關後撤銷進關拒絕、隊伍已到下一關／下一隊已進關後撤銷出關拒絕、
 * 撤銷進關後狀態回到 READY／ARRIVED 且對應的超時通知標記 invalidated。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDbTestEnv } from "./helpers/env";
import {
  adminVoidRecord,
  backdateRealCreatedAt,
  checkCreated,
  countRows,
  createServiceClient,
  derive,
  must,
  notificationsOf,
  notifyLikeRoute,
  undoCheck,
  validRecords,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";
import type { NotificationRow } from "@/lib/types";

const env = loadDbTestEnv();

describe.skipIf(!env)("DB：現場撤銷", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let gameId: string;

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "undo",
      teams: ["T1", "T2", "T3", "T4", "T5", "T6"],
      games: [
        {
          code: "gold",
          stations: ["S1", "S2", "S3", "S4", "S5"],
          assignments: [
            { slot: 1, station: "S1", teams: ["T1"] },
            { slot: 1, station: "S2", teams: ["T2"] },
            { slot: 1, station: "S3", teams: ["T3"] },
            { slot: 1, station: "S4", teams: ["T4"] },
            { slot: 1, station: "S5", teams: ["T6"] },
            // 第3小隊的下一關；S3 的下一場是 T5
            { slot: 2, station: "S4", teams: ["T3"] },
            { slot: 2, station: "S3", teams: ["T5"] },
          ],
        },
      ],
    });
    gameId = fx.game("gold").id;
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  async function selfUndoNotes(recordId: string): Promise<NotificationRow[]> {
    return (await notificationsOf(client, gameId)).filter((n) => n.kind === "SELF_UNDO" && n.trigger_record_id === recordId);
  }

  it("59 秒可撤銷、76 秒拒絕（real_created_at 用真實時間；倍速 1）；超過之後只能由 ADMIN 撤銷", async () => {
    await fx.at("09:12");
    const aid = fx.a(1, "S1");
    const sid = fx.stationIdentity("S1");

    const first = await checkCreated(client, { assignmentId: aid, action: "station_check_in", identityId: sid });
    await backdateRealCreatedAt(client, first.id, 59);
    const ok = await undoCheck(client, first.id, sid);
    expect(ok.status).toBe("voided");
    expect(ok.record?.void_reason).toBe("SELF_UNDO");
    expect(ok.record?.voided_by).toBe(sid);
    expect(await selfUndoNotes(first.id)).toHaveLength(1);
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "SELF_UNDO").eq("target_id", first.id))).toBe(1);
    expect(await validRecords(client, aid, "station_check_in")).toHaveLength(0);

    const second = await checkCreated(client, { assignmentId: aid, action: "station_check_in", identityId: sid });
    await backdateRealCreatedAt(client, second.id, 76);
    expect(await undoCheck(client, second.id, sid)).toMatchObject({ status: "rejected", code: "UNDO_WINDOW_EXPIRED" });
    expect(await validRecords(client, aid, "station_check_in")).toHaveLength(1);

    // 60 秒後由 ADMIN 修正（原因必填）
    expect(await adminVoidRecord(client, second.id, fx.adminId, "  ")).toMatchObject({ status: "rejected", code: "REASON_REQUIRED" });
    const adminVoid = await adminVoidRecord(client, second.id, fx.adminId, "關主按錯，總召撤銷");
    expect(adminVoid.status).toBe("voided");
    expect(adminVoid.record?.void_reason).toBe("關主按錯，總召撤銷");
  });

  it("Demo 倍速 ×10 下結果相同：59 秒可撤銷、76 秒拒絕（不乘倍速）", async () => {
    await fx.at("09:12", 10);
    const aid = fx.a(1, "S2");
    const teamId = fx.team("T2");
    const tid = fx.teamIdentity("T2");

    const first = await checkCreated(client, { assignmentId: aid, action: "team_check_in", teamId, identityId: tid });
    await backdateRealCreatedAt(client, first.id, 59);
    expect((await undoCheck(client, first.id, tid)).status).toBe("voided");

    const second = await checkCreated(client, { assignmentId: aid, action: "team_check_in", teamId, identityId: tid });
    await backdateRealCreatedAt(client, second.id, 76);
    expect(await undoCheck(client, second.id, tid)).toMatchObject({ status: "rejected", code: "UNDO_WINDOW_EXPIRED" });

    // 剛按下（真實 0 秒）就撤銷：倍速下 app 時間跑得快，但仍可撤銷
    const third = await checkCreated(client, {
      assignmentId: fx.a(1, "S4"),
      action: "team_check_in",
      teamId: fx.team("T4"),
      identityId: fx.teamIdentity("T4"),
    });
    expect((await undoCheck(client, third.id, fx.teamIdentity("T4"))).status).toBe("voided");
  });

  it("別的 identity 不能撤銷（UNDO_NOT_OWNER）；唯讀 FORBIDDEN", async () => {
    await fx.at("09:13");
    const aid = fx.a(1, "S3");
    const sci = await checkCreated(client, { assignmentId: aid, action: "station_check_in", identityId: fx.stationIdentity("S3") });
    expect(await undoCheck(client, sci.id, fx.stationIdentity("S1"))).toMatchObject({ status: "rejected", code: "UNDO_NOT_OWNER" });
    // 總召也不能用「現場撤銷」撤別人的紀錄（要走 admin_void_record）
    expect(await undoCheck(client, sci.id, fx.adminId)).toMatchObject({ status: "rejected", code: "UNDO_NOT_OWNER" });
    expect(await undoCheck(client, sci.id, fx.viewerId)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });

    const tci = await checkCreated(client, {
      assignmentId: aid,
      action: "team_check_in",
      teamId: fx.team("T3"),
      identityId: fx.teamIdentity("T3"),
    });
    expect(await undoCheck(client, tci.id, fx.teamIdentity("T4"))).toMatchObject({ status: "rejected", code: "UNDO_NOT_OWNER" });

    expect(await validRecords(client, aid, "station_check_in")).toHaveLength(1);
    expect(await validRecords(client, aid, "team_check_in", fx.team("T3"))).toHaveLength(1);
  });

  it("已出關後撤銷進關 → UNDO_CHECKIN_HAS_CHECKOUT（關主側與隊輔側）", async () => {
    await fx.at("09:26");
    const aid = fx.a(1, "S3");
    const sid = fx.stationIdentity("S3");
    const [sci] = await validRecords(client, aid, "station_check_in");
    const [tci] = await validRecords(client, aid, "team_check_in", fx.team("T3"));

    await checkCreated(client, { assignmentId: aid, action: "station_check_out", identityId: sid });
    expect(await undoCheck(client, sci.id, sid)).toMatchObject({ status: "rejected", code: "UNDO_CHECKIN_HAS_CHECKOUT" });

    await checkCreated(client, {
      assignmentId: aid,
      action: "team_check_out",
      teamId: fx.team("T3"),
      identityId: fx.teamIdentity("T3"),
    });
    expect(await undoCheck(client, tci.id, fx.teamIdentity("T3"))).toMatchObject({
      status: "rejected",
      code: "UNDO_CHECKIN_HAS_CHECKOUT",
    });
  });

  it("隊伍已到下一關 → 現場撤銷出關拒絕（UNDO_TEAM_ARRIVED_NEXT）；下一隊已進關 → 拒絕（UNDO_NEXT_CHECKED_IN，ADMIN 也一樣）", async () => {
    await fx.at("09:27");
    const aid = fx.a(1, "S3");
    const sid = fx.stationIdentity("S3");
    const [sco] = await validRecords(client, aid, "station_check_out");

    // 第3小隊在下一關（S4 第2時段）按確認進關
    await checkCreated(client, {
      assignmentId: fx.a(2, "S4"),
      action: "team_check_in",
      teamId: fx.team("T3"),
      identityId: fx.teamIdentity("T3"),
    });
    expect(await undoCheck(client, sco.id, sid)).toMatchObject({ status: "rejected", code: "UNDO_TEAM_ARRIVED_NEXT" });

    // 同一關的下一隊（T5）已進關
    await checkCreated(client, { assignmentId: fx.a(2, "S3"), action: "station_check_in", identityId: sid });
    expect(await undoCheck(client, sco.id, sid)).toMatchObject({ status: "rejected", code: "UNDO_NEXT_CHECKED_IN" });
    expect(await adminVoidRecord(client, sco.id, fx.adminId, "總召修正")).toMatchObject({
      status: "rejected",
      code: "UNDO_NEXT_CHECKED_IN",
    });
    expect(await validRecords(client, aid, "station_check_out")).toHaveLength(1);
  });

  it("撤銷進關 → 狀態回到 READY／ARRIVED，對應的 STATION_OVERTIME 通知標記 invalidated，並建立 SELF_UNDO", async () => {
    await fx.at("09:12");
    const aid = fx.a(1, "S5");
    const sid = fx.stationIdentity("S5");
    const t6 = fx.team("T6");
    await checkCreated(client, { assignmentId: aid, action: "team_check_in", teamId: t6, identityId: fx.teamIdentity("T6") });
    const sci = await checkCreated(client, { assignmentId: aid, action: "station_check_in", identityId: sid });

    // 09:12 開始 → 09:27 時間到；09:28 已超時
    await fx.at("09:28");
    const before = await derive(client, gameId);
    expect(before.d.assignments.get(aid)!.state).toBe("OVERTIME");
    const overtime = await notifyLikeRoute(client, gameId, { kind: "STATION_OVERTIME", assignmentId: aid });
    expect(overtime.result).toBe("created");
    expect(overtime.notification?.trigger_record_id).toBe(sci.id);
    expect(overtime.notification?.invalidated_at).toBeNull();

    expect((await undoCheck(client, sci.id, sid)).status).toBe("voided");

    const rows = await must<NotificationRow[]>(
      "讀取 notifications",
      client.from("notifications").select("*").eq("id", overtime.notification!.id),
    );
    expect(rows[0].invalidated_at).not.toBeNull();
    expect(await selfUndoNotes(sci.id)).toHaveLength(1);

    const after = await derive(client, gameId);
    const ad = after.d.assignments.get(aid)!;
    expect(ad.state).toBe("READY");
    expect(ad.startedAt).toBeNull();
    const team = after.d.teams.get(t6)!;
    expect(team.state).toBe("ARRIVED");
    expect(team.arrivedDetail).toBe("TEAM_REPORTED");
    expect(after.d.conditions.some((c) => c.kind === "STATION_OVERTIME" && c.assignmentId === aid)).toBe(false);
    expect((await notifyLikeRoute(client, gameId, { kind: "STATION_OVERTIME", assignmentId: aid })).result).toBe("not_yet");
  });
});
