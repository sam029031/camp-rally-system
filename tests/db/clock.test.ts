/**
 * Demo 時鐘 set_clock（SPEC 第三十一節；真 Postgres）：
 * - 跳到的時刻早於有效打卡紀錄 → CLOCK_JUMP_BEFORE_RECORDS。
 * - 時間往回調時，created_at 在新 app 時間之後的通知會被刪除（它們在新時間軸上「還沒發生」；
 *   不刪的話通知 key 已被佔用，彩排重跑同一段時同一事件不會再通知）。往後跳不影響既有通知。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDbTestEnv } from "./helpers/env";
import { appNowMs, checkCreated, createServiceClient, notificationsOf, rpc, type StatusResult } from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";
import { taipeiLocalToMs } from "@/lib/time";

const env = loadDbTestEnv();

describe.skipIf(!env)("DB：set_clock（Demo 時鐘）", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let goldId: string;

  const setClock = (jumpTo: string | null, speed = 1) =>
    rpc<StatusResult>(client, "set_clock", {
      p_event_id: fx.eventId,
      p_enabled: true,
      p_speed: speed,
      p_jump_to: jumpTo ? `${fx.eventDate}T${jumpTo}:00+08:00` : null,
      p_identity_id: fx.adminId,
    });

  const notify = (message: string) =>
    rpc<{ result: string }>(client, "create_notification", {
      p_kind: "TRANSITION_OVERDUE",
      p_subkind: null,
      p_game_id: goldId,
      p_assignment_id: fx.a(1, "Z1"),
      p_team_id: fx.team("C1"),
      p_trigger_record_id: null,
      p_trigger_override_id: null,
      p_message: message,
    });

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "clock",
      teams: ["C1"],
      games: [{ code: "gold", stations: ["Z1"], assignments: [{ slot: 1, station: "Z1", teams: ["C1"] }] }],
    });
    goldId = fx.game("gold").id;
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  it("往回跳：刪除新時間之後才建立的通知，同一事件之後可以再通知一次", async () => {
    await fx.at("09:30");
    expect((await notify("第C1隊 未到第一關")).result).toBe("created");
    expect(await notificationsOf(client, goldId)).toHaveLength(1);

    const res = await setClock("09:05");
    expect(res.status).toBe("ok");
    const now = await appNowMs(client, fx.eventId);
    expect(Math.abs(now - taipeiLocalToMs(fx.eventDate, "09:05"))).toBeLessThan(5_000);
    expect(await notificationsOf(client, goldId)).toHaveLength(0);

    // 重跑同一段：同一個 key 可以再建立
    await fx.at("09:30");
    expect((await notify("第C1隊 未到第一關")).result).toBe("created");
  });

  it("往後跳：既有通知不受影響", async () => {
    const before = await notificationsOf(client, goldId);
    expect(before.length).toBeGreaterThan(0);
    expect((await setClock("10:30")).status).toBe("ok");
    expect(await notificationsOf(client, goldId)).toHaveLength(before.length);
  });

  it("跳到早於有效打卡紀錄的時刻 → CLOCK_JUMP_BEFORE_RECORDS，時鐘與通知都不變", async () => {
    await fx.at("09:08");
    await checkCreated(client, { assignmentId: fx.a(1, "Z1"), action: "station_check_in", identityId: fx.stationIdentity("Z1") });
    const countBefore = (await notificationsOf(client, goldId)).length;
    const res = await setClock("09:00");
    expect(res.status).toBe("rejected");
    expect(res.code).toBe("CLOCK_JUMP_BEFORE_RECORDS");
    expect(await notificationsOf(client, goldId)).toHaveLength(countBefore);
  });
});
