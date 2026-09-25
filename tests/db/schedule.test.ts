/**
 * 整場延後／提前與關卡取消（SPEC 第二十四、二十四之二、九、三十節；真 Postgres）：
 * v_slot_times 的有效時間與原定時間、DELAY / START_AT、已開始或已有進關的時段拒絕、撤銷最近一次調整、
 * 取消第3時段 → 打卡拒絕 ASSIGNMENT_CANCELLED、第2時段出關後跑關目標直接是第4時段。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFICIAL_SLOTS } from "@/lib/constants";
import { taipeiLocalToMs } from "@/lib/time";
import { loadDbTestEnv } from "./helpers/env";
import {
  adminVoidRecord,
  checkCreated,
  createServiceClient,
  derive,
  must,
  notificationsOf,
  recordCheck,
  rpc,
  type StatusResult,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";

const env = loadDbTestEnv();

interface SlotTimes {
  slot: number;
  originalStart: number;
  originalEnd: number;
  scheduledStart: number;
  scheduledEnd: number;
  offset: number;
}

describe.skipIf(!env)("DB：整場延後／提前與關卡取消", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let gameId: string;

  const official = (n: number, which: 0 | 1) => taipeiLocalToMs(fx.eventDate, OFFICIAL_SLOTS.gold[n - 1][which]);

  async function slotTimes(): Promise<SlotTimes[]> {
    const rows = await must<
      Array<{
        slot_number: number;
        original_start: string;
        original_end: string;
        scheduled_start: string;
        scheduled_end: string;
        total_offset_seconds: number;
      }>
    >(
      "讀取 v_slot_times",
      client.from("v_slot_times").select("*").eq("game_id", gameId).order("slot_number"),
    );
    return rows.map((r) => ({
      slot: r.slot_number,
      originalStart: Date.parse(r.original_start),
      originalEnd: Date.parse(r.original_end),
      scheduledStart: Date.parse(r.scheduled_start),
      scheduledEnd: Date.parse(r.scheduled_end),
      offset: r.total_offset_seconds,
    }));
  }

  /** 每個時段：原定時間 = Excel 時間；有效時間 = 原定 + offsetFor(n) 秒 */
  async function expectOffsets(offsetFor: (slot: number) => number): Promise<void> {
    const rows = await slotTimes();
    expect(rows.map((r) => r.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of rows) {
      const off = offsetFor(r.slot);
      expect(r.originalStart, `第${r.slot}時段原定開始`).toBe(official(r.slot, 0));
      expect(r.originalEnd, `第${r.slot}時段原定結束`).toBe(official(r.slot, 1));
      expect(r.offset, `第${r.slot}時段 total_offset_seconds`).toBe(off);
      expect(r.scheduledStart, `第${r.slot}時段有效開始`).toBe(official(r.slot, 0) + off * 1000);
      expect(r.scheduledEnd, `第${r.slot}時段有效結束`).toBe(official(r.slot, 1) + off * 1000);
    }
  }

  const adjust = (fromSlot: number, mode: "DELAY" | "START_AT", offsetSeconds: number | null, startAt: string | null, identityId?: string) =>
    rpc<StatusResult>(client, "adjust_schedule", {
      p_game_id: gameId,
      p_from_slot_number: fromSlot,
      p_input_mode: mode,
      p_offset_seconds: offsetSeconds,
      p_start_at: startAt,
      p_reason: "DB 測試：整場調整",
      p_identity_id: identityId ?? fx.adminId,
    });

  const voidLast = () =>
    rpc<StatusResult>(client, "void_last_adjustment", {
      p_game_id: gameId,
      p_identity_id: fx.adminId,
      p_reason: "DB 測試：撤銷調整",
    });

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "schedule",
      teams: ["V1", "V2", "V3"],
      games: [
        {
          code: "gold",
          stations: ["C1", "C3", "D2", "D3", "D4"],
          assignments: [
            { slot: 1, station: "C1", teams: ["V1"] },
            { slot: 3, station: "C3", teams: ["V3"] },
            // V2 的路線：第2時段 D2 → 第3時段 D3（會被取消）→ 第4時段 D4
            { slot: 2, station: "D2", teams: ["V2"] },
            { slot: 3, station: "D3", teams: ["V2"] },
            { slot: 4, station: "D4", teams: ["V2"] },
          ],
        },
      ],
    });
    gameId = fx.game("gold").id;
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("「第3時段起延後 10 分鐘」→ 第1、2時段不變，第3~8時段 +600 秒，原定時間不變；撤銷後回到原本時間", async () => {
    await fx.at("08:00");
    await expectOffsets(() => 0);

    const r = await adjust(3, "DELAY", 600, null);
    expect(r).toMatchObject({ status: "ok", from_slot_number: 3, offset_seconds: 600 });
    expect(Date.parse(String(r.new_start))).toBe(official(3, 0) + 600_000);
    await expectOffsets((n) => (n >= 3 ? 600 : 0));

    const adjustmentId = String(r.adjustment_id);
    const created = (await notificationsOf(client, gameId)).filter(
      (n) => n.kind === "SCHEDULE_ADJUSTED" && n.trigger_adjustment_id === adjustmentId,
    );
    expect(created).toHaveLength(1);
    expect(created[0].trigger_phase).toBe("CREATE");
    expect(created[0].message).toContain("第3時段起延後 10 分鐘");
    expect(created[0].message).toContain("10:04");

    const { d, snap } = await derive(client, gameId);
    expect(d.activeAdjustmentLabel).toContain("第3時段起已延後");
    expect(snap.slots.find((s) => s.number === 3)!.scheduledStart).toBe(official(3, 0) + 600_000);
    expect(snap.slots.find((s) => s.number === 2)!.scheduledStart).toBe(official(2, 0));

    const v = await voidLast();
    expect(v).toMatchObject({ status: "ok", adjustment_id: adjustmentId });
    await expectOffsets(() => 0);
    const voidNote = (await notificationsOf(client, gameId)).filter(
      (n) => n.kind === "SCHEDULE_ADJUSTED" && n.trigger_adjustment_id === adjustmentId && n.trigger_phase === "VOID",
    );
    expect(voidNote).toHaveLength(1);
    expect(voidNote[0].message).toContain("09:54");
    const adj = await must<Array<{ voided_at: string | null }>>(
      "讀取 schedule_adjustments",
      client.from("schedule_adjustments").select("voided_at").eq("id", adjustmentId),
    );
    expect(adj[0].voided_at).not.toBeNull();
    expect((await derive(client, gameId)).d.activeAdjustmentLabel).toBeNull();
  });

  it("「第1時段從 09:20 開始」（START_AT）→ offset = +600 秒，全部時段一起平移", async () => {
    await fx.at("08:00");
    const r = await adjust(1, "START_AT", null, `${fx.eventDate}T09:20:00+08:00`);
    expect(r).toMatchObject({ status: "ok", from_slot_number: 1, offset_seconds: 600 });
    await expectOffsets(() => 600);
    const rows = await must<Array<{ input_mode: string; offset_seconds: number }>>(
      "讀取 schedule_adjustments",
      client.from("schedule_adjustments").select("input_mode, offset_seconds").eq("id", String(r.adjustment_id)),
    );
    expect(rows[0]).toEqual({ input_mode: "START_AT", offset_seconds: 600 });
    expect((await voidLast()).status).toBe("ok");
    await expectOffsets(() => 0);
  });

  it("from_slot 或其後的時段已有有效進關紀錄 → ADJUST_SLOT_HAS_CHECKINS", async () => {
    await fx.at("08:00");
    // 提早到關按進關（第1時段）
    await checkCreated(client, { assignmentId: fx.a(1, "C1"), action: "station_check_in", identityId: fx.stationIdentity("C1") });
    expect(await adjust(1, "DELAY", 300, null)).toMatchObject({ status: "rejected", code: "ADJUST_SLOT_HAS_CHECKINS" });
    // 從第2時段起不受影響
    expect((await adjust(2, "DELAY", 300, null)).status).toBe("ok");
    await expectOffsets((n) => (n >= 2 ? 300 : 0));
    expect((await voidLast()).status).toBe("ok");

    // 後面的時段（第3時段）有進關 → 從第2時段起也不行
    const c3 = await checkCreated(client, {
      assignmentId: fx.a(3, "C3"),
      action: "station_check_in",
      identityId: fx.stationIdentity("C3"),
    });
    expect(await adjust(2, "DELAY", 300, null)).toMatchObject({ status: "rejected", code: "ADJUST_SLOT_HAS_CHECKINS" });
    expect((await adjust(4, "DELAY", 300, null)).status).toBe("ok");
    expect((await voidLast()).status).toBe("ok");
    // 撤銷那筆進關後就可以
    expect((await adminVoidRecord(client, c3.id, fx.adminId, "DB 測試：清除提早進關")).status).toBe("voided");
    expect((await adjust(2, "DELAY", 300, null)).status).toBe("ok");
    expect((await voidLast()).status).toBe("ok");
    await expectOffsets(() => 0);
  });

  it("取消第3時段 → 打卡拒絕 ASSIGNMENT_CANCELLED；第2時段出關後跑關目標直接是第4時段，deadline = max(出關 + 7 分, 第4時段開始)", async () => {
    await fx.at("09:33");
    const d2 = fx.a(2, "D2");
    const d3 = fx.a(3, "D3");
    const d4 = fx.a(4, "D4");
    const v2 = fx.team("V2");
    await checkCreated(client, { assignmentId: d2, action: "station_check_in", identityId: fx.stationIdentity("D2") });

    // 進行中的場次不能取消；唯讀不能取消；原因必填
    const cancel = (ids: string[], reason: string, identityId = fx.adminId) =>
      rpc<StatusResult>(client, "cancel_assignments", { p_assignment_ids: ids, p_reason: reason, p_identity_id: identityId });
    expect(await cancel([d2], "下雨")).toMatchObject({ status: "rejected", code: "CANCEL_IN_PROGRESS" });
    expect(await cancel([d3], "下雨", fx.viewerId)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(await cancel([d3], "  ")).toMatchObject({ status: "rejected", code: "REASON_REQUIRED" });

    const c = await cancel([d3], "下雨停辦水關");
    expect(c.status).toBe("ok");
    const cancellationIds = c.cancellation_ids as string[];
    expect(cancellationIds).toHaveLength(1);
    const note = (await notificationsOf(client, gameId)).filter(
      (n) => n.kind === "SCHEDULE_ADJUSTED" && n.trigger_cancellation_id === cancellationIds[0],
    );
    expect(note).toHaveLength(1);
    expect(note[0].message).toContain("第3時段取消");

    // 被取消的 assignment 拒絕任何打卡
    expect(
      await recordCheck(client, { assignmentId: d3, action: "station_check_in", identityId: fx.stationIdentity("D3") }),
    ).toMatchObject({ status: "rejected", code: "ASSIGNMENT_CANCELLED" });
    expect(
      await recordCheck(client, { assignmentId: d3, action: "team_check_in", teamId: v2, identityId: fx.teamIdentity("V2") }),
    ).toMatchObject({ status: "rejected", code: "ASSIGNMENT_CANCELLED" });

    await fx.at("09:40");
    const out = await checkCreated(client, { assignmentId: d2, action: "station_check_out", identityId: fx.stationIdentity("D2") });
    const outAt = Date.parse(out.recorded_at);

    const { d, snap } = await derive(client, gameId);
    const slot4Start = snap.slots.find((s) => s.number === 4)!.scheduledStart;
    const team = d.teams.get(v2)!;
    expect(d.assignments.get(d3)!.state).toBe("CANCELLED");
    expect(team.state).toBe("TRANSITIONING");
    expect(team.routeAssignmentIds).toEqual([d2, d4]);
    expect(team.currentAssignmentId).toBe(d4);
    expect(team.previousCheckOut?.id).toBe(out.id);
    expect(team.skippedCancelledAssignmentIds).toEqual([d3]);
    expect(team.deadline).toBe(Math.max(outAt + 7 * 60_000, slot4Start));
    expect(team.deadline).toBe(official(4, 0));

    // 撤銷取消 → 目標回到第3時段，deadline = max(出關 + 7 分, 第3時段開始)
    const v = await rpc<StatusResult>(client, "void_cancellation", {
      p_cancellation_id: cancellationIds[0],
      p_identity_id: fx.adminId,
      p_reason: "雨停了",
    });
    expect(v.status).toBe("ok");
    const after = (await derive(client, gameId)).d.teams.get(v2)!;
    expect(after.currentAssignmentId).toBe(d3);
    expect(after.deadline).toBe(Math.max(outAt + 7 * 60_000, official(3, 0)));
    expect(after.skippedCancelledAssignmentIds).toEqual([]);
  });

  it("from_slot 已開始 → ADJUST_SLOT_STARTED；尚未開始的時段可以；沒有可撤銷的調整 → ADJUST_NOTHING_TO_VOID；唯讀不能調整", async () => {
    await fx.at("09:40");
    expect(await adjust(2, "DELAY", 600, null)).toMatchObject({ status: "rejected", code: "ADJUST_SLOT_STARTED" });
    expect(await adjust(1, "DELAY", 600, null)).toMatchObject({ status: "rejected", code: "ADJUST_SLOT_STARTED" });
    expect(await adjust(3, "DELAY", 600, null, fx.viewerId)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });

    const ok = await adjust(3, "DELAY", 600, null);
    expect(ok.status).toBe("ok");
    await expectOffsets((n) => (n >= 3 ? 600 : 0));
    expect((await voidLast()).status).toBe("ok");
    await expectOffsets(() => 0);
    expect(await voidLast()).toMatchObject({ status: "rejected", code: "ADJUST_NOTHING_TO_VOID" });
  });
});
