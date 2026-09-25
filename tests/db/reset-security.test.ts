/**
 * Reset 與權限（SPEC 第二十、二十二、二十五、三十節；真 Postgres）：
 * reset_game_records 只刪除指定遊戲的執行期資料（其他遊戲、其他活動、排程與身分都不動），
 * anon key 不能執行寫入用 RPC、不能直接寫入 table（有 SUPABASE_TEST_ANON_KEY 時才測）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDbTestEnv } from "./helpers/env";
import {
  checkCreated,
  countRows,
  createAnonClient,
  createServiceClient,
  must,
  rpc,
  type StatusResult,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";

const env = loadDbTestEnv();

interface RuntimeCounts {
  check_records: number;
  notifications: number;
  schedule_adjustments: number;
  assignment_cancellations: number;
  assignment_end_overrides: number;
}

describe.skipIf(!env)("DB：reset 與權限", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let goldId: string;
  let landId: string;
  let landRecordId: string;

  async function runtimeCounts(gameId: string): Promise<RuntimeCounts> {
    const [check_records, notifications, schedule_adjustments, assignment_cancellations, assignment_end_overrides] =
      await Promise.all([
        countRows(client, "v_check_records", (q) => q.eq("game_id", gameId)),
        countRows(client, "notifications", (q) => q.eq("game_id", gameId)),
        countRows(client, "schedule_adjustments", (q) => q.eq("game_id", gameId)),
        countRows(client, "v_assignment_cancellations", (q) => q.eq("game_id", gameId)),
        countRows(client, "v_assignment_end_overrides", (q) => q.eq("game_id", gameId)),
      ]);
    return { check_records, notifications, schedule_adjustments, assignment_cancellations, assignment_end_overrides };
  }

  const adjust = (gameId: string, fromSlot: number) =>
    rpc<StatusResult>(client, "adjust_schedule", {
      p_game_id: gameId,
      p_from_slot_number: fromSlot,
      p_input_mode: "DELAY",
      p_offset_seconds: 300,
      p_start_at: null,
      p_reason: "DB 測試：reset 前的調整",
      p_identity_id: fx.adminId,
    });

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "reset-security",
      teams: ["U1", "U2", "U3"],
      games: [
        {
          code: "gold",
          stations: ["Z1", "Z2"],
          assignments: [
            { slot: 1, station: "Z1", teams: ["U1"] },
            { slot: 2, station: "Z2", teams: ["U1"] },
          ],
        },
        {
          code: "land",
          stations: ["Y1"],
          assignments: [{ slot: 1, station: "Y1", teams: ["U2", "U3"] }],
        },
      ],
    });
    goldId = fx.game("gold").id;
    landId = fx.game("land").id;

    // 兩個遊戲都產生各種執行期資料
    await fx.at("08:00");
    expect((await adjust(goldId, 3)).status).toBe("ok");
    expect((await adjust(landId, 3)).status).toBe("ok");
    await fx.at("09:12");
    await checkCreated(client, { assignmentId: fx.a(1, "Z1"), action: "station_check_in", identityId: fx.stationIdentity("Z1") });
    await checkCreated(client, {
      assignmentId: fx.a(1, "Z1"),
      action: "team_check_in",
      teamId: fx.team("U1"),
      identityId: fx.teamIdentity("U1"),
    });
    expect(
      (
        await rpc<StatusResult>(client, "set_end_override", {
          p_assignment_id: fx.a(1, "Z1"),
          p_official_end: `${fx.eventDate}T09:35:00+08:00`,
          p_reason: "延長",
          p_identity_id: fx.adminId,
        })
      ).status,
    ).toBe("ok");
    expect(
      (
        await rpc<StatusResult>(client, "cancel_assignments", {
          p_assignment_ids: [fx.a(2, "Z2")],
          p_reason: "取消",
          p_identity_id: fx.adminId,
        })
      ).status,
    ).toBe("ok");
    await fx.at("13:06");
    const land = await checkCreated(client, {
      assignmentId: fx.a(1, "Y1"),
      action: "station_check_in",
      identityId: fx.stationIdentity("Y1"),
      confirmedTeamIds: [fx.team("U2"), fx.team("U3")],
    });
    landRecordId = land.id;
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("reset_game_records 只刪除該遊戲的執行期資料（其他遊戲、其他活動、排程、身分與 Demo 設定不動）", async () => {
    const goldBefore = await runtimeCounts(goldId);
    const landBefore = await runtimeCounts(landId);
    expect(goldBefore).toEqual({
      check_records: 2,
      notifications: 2, // 延後 + 取消
      schedule_adjustments: 1,
      assignment_cancellations: 1,
      assignment_end_overrides: 1,
    });
    expect(landBefore.check_records).toBe(1);
    expect(landBefore.schedule_adjustments).toBe(1);

    // 其他活動（例如正式活動）既有的紀錄：reset 前後都必須還在
    const ourGames = [goldId, landId];
    const others = await must<Array<{ id: string }>>(
      "讀取其他遊戲的紀錄",
      client.from("v_check_records").select("id").not("game_id", "in", `(${ourGames.join(",")})`).limit(50),
    );

    expect(
      await rpc<StatusResult>(client, "reset_game_records", {
        p_game_id: goldId,
        p_identity_id: fx.viewerId,
        p_reason: "唯讀嘗試",
        p_disable_sim: false,
      }),
    ).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(
      await rpc<StatusResult>(client, "reset_game_records", {
        p_game_id: goldId,
        p_identity_id: fx.adminId,
        p_reason: " ",
        p_disable_sim: false,
      }),
    ).toMatchObject({ status: "rejected", code: "REASON_REQUIRED" });
    expect(await runtimeCounts(goldId)).toEqual(goldBefore);

    const gameBefore = await must<Array<{ updated_at: string }>>(
      "讀取 games",
      client.from("games").select("updated_at").eq("id", goldId),
    );
    const r = await rpc<StatusResult>(client, "reset_game_records", {
      p_game_id: goldId,
      p_identity_id: fx.adminId,
      p_reason: "DB 測試 reset",
      p_disable_sim: false,
    });
    expect(r.status).toBe("ok");
    expect(r.deleted).toEqual(goldBefore);

    expect(await runtimeCounts(goldId)).toEqual({
      check_records: 0,
      notifications: 0,
      schedule_adjustments: 0,
      assignment_cancellations: 0,
      assignment_end_overrides: 0,
    });
    expect(await runtimeCounts(landId)).toEqual(landBefore);

    if (others.length > 0) {
      const still = await must<Array<{ id: string }>>(
        "讀取其他遊戲的紀錄",
        client.from("check_records").select("id").in("id", others.map((o) => o.id)),
      );
      expect(still).toHaveLength(others.length);
    }

    // 排程與身分不清
    expect(await countRows(client, "time_slots", (q) => q.eq("game_id", goldId))).toBe(8);
    expect(await countRows(client, "assignments", (q) => q.eq("game_id", goldId))).toBe(2);
    expect(await countRows(client, "identities", (q) => q.eq("station_id", fx.station("Z1")))).toBe(1);
    // games 列更新（讓裝置經 Realtime 重抓）、audit 保留並新增一筆 RESET、Demo 設定不動（p_disable_sim = false）
    const gameAfter = await must<Array<{ updated_at: string }>>(
      "讀取 games",
      client.from("games").select("updated_at").eq("id", goldId),
    );
    expect(Date.parse(gameAfter[0].updated_at)).toBeGreaterThan(Date.parse(gameBefore[0].updated_at));
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "RESET").eq("game_id", goldId))).toBe(1);
    const ev = await must<Array<{ sim_enabled: boolean }>>(
      "讀取 events",
      client.from("events").select("sim_enabled").eq("id", fx.eventId),
    );
    expect(ev[0].sim_enabled).toBe(true);
  });

  describe.skipIf(!env?.anonKey)("anon key（前端用的公開 key）", () => {
    let anon: SupabaseClient;

    beforeAll(() => {
      anon = createAnonClient(env!)!;
    });

    it("可以讀公開資料與校時（確認 key 本身有效）", async () => {
      const clock = await anon.rpc("get_clock", { p_event_id: fx.eventId });
      expect(clock.error).toBeNull();
      const rows = await anon.from("check_records").select("id").eq("id", landRecordId);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
    });

    it("不能執行 record_check／undo_check／reset_game_records", async () => {
      const crid = randomUUID();
      const rc = await anon.rpc("record_check", {
        p_client_request_id: crid,
        p_assignment_id: fx.a(1, "Z1"),
        p_action: "station_check_in",
        p_team_id: null,
        p_identity_id: fx.adminId,
        p_source: "ui",
        p_recorded_at: null,
        p_no_show: false,
        p_confirmed_team_ids: null,
        p_single_team_override: false,
        p_reason: null,
        p_client_info: null,
      });
      expect(rc.error).not.toBeNull();
      expect(rc.data).toBeNull();
      expect(await countRows(client, "check_records", (q) => q.eq("client_request_id", crid))).toBe(0);

      const undo = await anon.rpc("undo_check", { p_record_id: landRecordId, p_identity_id: fx.stationIdentity("Y1"), p_client_info: null });
      expect(undo.error).not.toBeNull();
      const reset = await anon.rpc("reset_game_records", {
        p_game_id: landId,
        p_identity_id: null,
        p_reason: "anon",
        p_disable_sim: false,
      });
      expect(reset.error).not.toBeNull();

      const rows = await must<Array<{ voided_at: string | null }>>(
        "讀取 check_records",
        client.from("check_records").select("voided_at").eq("id", landRecordId),
      );
      expect(rows).toEqual([{ voided_at: null }]);
      expect(await countRows(client, "v_check_records", (q) => q.eq("game_id", landId))).toBe(1);
    });

    it("不能直接 insert／update／delete check_records，也讀不到 identities", async () => {
      const crid = randomUUID();
      const ins = await anon.from("check_records").insert({
        client_request_id: crid,
        assignment_id: fx.a(1, "Z1"),
        action: "station_check_in",
        team_id: null,
        recorded_at: new Date().toISOString(),
        source: "ui",
      });
      expect(ins.error).not.toBeNull();
      expect(await countRows(client, "check_records", (q) => q.eq("client_request_id", crid))).toBe(0);

      const upd = await anon.from("check_records").update({ voided_at: new Date().toISOString(), void_reason: "anon" }).eq("id", landRecordId);
      expect(upd.error).not.toBeNull();
      const del = await anon.from("check_records").delete().eq("id", landRecordId);
      expect(del.error).not.toBeNull();
      const rows = await must<Array<{ voided_at: string | null }>>(
        "讀取 check_records",
        client.from("check_records").select("voided_at").eq("id", landRecordId),
      );
      expect(rows).toEqual([{ voided_at: null }]);

      const notif = await anon.from("notifications").insert({ kind: "SELF_UNDO", game_id: landId, message: "anon", created_at: new Date().toISOString() });
      expect(notif.error).not.toBeNull();

      const ids = await anon.from("identities").select("id").limit(1);
      expect(ids.error).not.toBeNull();
    });
  });
});
