/**
 * 資料一致性修正（真 Postgres）：
 * - void_cancellation 順序保護（SPEC 第二十一、二十四之二節）：本關後面時段已有關主紀錄／隊伍已往後走 → CANCEL_VOID_ORDER_CONFLICT
 * - admin_correct_record（第二十二節）：以原紀錄為 trigger 的通知保持有效並改指向新紀錄
 * - create_notification（第十五節）：trigger 紀錄／延長已撤銷 → not_yet，不建立通知
 * - revalidate_notifications（第十五節 reconcile）
 * - begin_login_attempt / finish_login_attempt（第二十節）：60 秒內 5 次失敗（含 pending）即鎖定，並行也不超過 5 次
 * - set_identity_pins（第二十節）：全部成功或全部不變
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { taipeiLocalToMs } from "@/lib/time";
import type { NotificationRow } from "@/lib/types";
import { loadDbTestEnv } from "./helpers/env";
import {
  adminVoidRecord,
  checkCreated,
  countRows,
  createServiceClient,
  must,
  rpc,
  type StatusResult,
} from "./helpers/db";
import { createFixture, TEST_EVENT_DATE, type Fixture } from "./helpers/fixture";

const env = loadDbTestEnv();

interface NotificationRpcResult {
  result: "created" | "exists" | "not_yet";
  notification: NotificationRow | null;
}

interface LoginBegin {
  locked: boolean;
  retry_after_seconds: number;
  attempt_id: number | null;
}

interface IdentityPinRow {
  id: string;
  pin_hash: string;
  pin_version: number;
}

describe.skipIf(!env)("DB：取消撤銷順序、修正後通知、通知來源檢查、登入鎖、批次改 PIN", () => {
  let client: SupabaseClient;
  let fx: Fixture;
  let gameId: string;

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "integrity",
      teams: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"],
      games: [
        {
          code: "gold",
          stations: ["S1", "S2", "S3", "S4", "S5", "S6"],
          assignments: [
            // 情境 A：S1 第1時段取消後，S1 第2時段已進關
            { slot: 1, station: "S1", teams: ["T1"] },
            { slot: 2, station: "S1", teams: ["T2"] },
            // 情境 B：T3 第3時段（S2）取消後，T3 已在第4時段（S3）打卡
            { slot: 3, station: "S2", teams: ["T3"] },
            { slot: 4, station: "S3", teams: ["T3"] },
            // 情境 C：沒有任何後續紀錄
            { slot: 6, station: "S4", teams: ["T4"] },
            // 修正紀錄／通知
            { slot: 1, station: "S5", teams: ["T5"] },
            { slot: 1, station: "S6", teams: ["T6"] },
          ],
        },
      ],
    });
    gameId = fx.game("gold").id;
  });

  afterAll(async () => {
    if (!fx) return;
    // 登入失敗／改 PIN 的 audit 沒有 game_id，依 target_id（identity）清掉
    const identityIds = ["T1", "T2", "T3", "T7", "T8"].map((k) => fx.teamIdentity(k));
    await client.from("audit_logs").delete().in("target_id", identityIds).in("action", ["LOGIN_FAILED", "PIN_CHANGED"]);
    await fx.cleanup();
  });

  const cancel = async (assignmentId: string): Promise<string> => {
    const r = await rpc<StatusResult>(client, "cancel_assignments", {
      p_assignment_ids: [assignmentId],
      p_reason: "DB測試取消",
      p_identity_id: fx.adminId,
    });
    expect(r.status).toBe("ok");
    return (r.cancellation_ids as string[])[0]!;
  };

  const voidCancellation = (cancellationId: string) =>
    rpc<StatusResult>(client, "void_cancellation", {
      p_cancellation_id: cancellationId,
      p_identity_id: fx.adminId,
      p_reason: "DB測試撤銷取消",
    });

  const cancellationVoidedAt = async (cancellationId: string): Promise<string | null> => {
    const row = await must<{ voided_at: string | null }>(
      "讀取 assignment_cancellations",
      client.from("assignment_cancellations").select("voided_at").eq("id", cancellationId).single(),
    );
    return row.voided_at;
  };

  const createNotification = (args: {
    kind: string;
    subkind?: string | null;
    assignmentId: string;
    teamId?: string | null;
    triggerRecordId?: string | null;
    triggerOverrideId?: string | null;
  }) =>
    rpc<NotificationRpcResult>(client, "create_notification", {
      p_kind: args.kind,
      p_subkind: args.subkind ?? null,
      p_game_id: gameId,
      p_assignment_id: args.assignmentId,
      p_team_id: args.teamId ?? null,
      p_trigger_record_id: args.triggerRecordId ?? null,
      p_trigger_override_id: args.triggerOverrideId ?? null,
      p_message: "DB測試通知",
    });

  const notification = (id: string) =>
    must<NotificationRow>("讀取 notification", client.from("notifications").select("*").eq("id", id).single());

  // -------------------------------------------------------------------
  // void_cancellation
  // -------------------------------------------------------------------

  it("撤銷取消：本關後面時段已有關主紀錄 → CANCEL_VOID_ORDER_CONFLICT，取消維持有效", async () => {
    await fx.at("09:05");
    const cid = await cancel(fx.a(1, "S1"));

    await fx.at("09:33");
    await checkCreated(client, {
      assignmentId: fx.a(2, "S1"),
      action: "station_check_in",
      identityId: fx.stationIdentity("S1"),
    });

    expect(await voidCancellation(cid)).toMatchObject({ status: "rejected", code: "CANCEL_VOID_ORDER_CONFLICT" });
    expect(await cancellationVoidedAt(cid)).toBeNull();
  });

  it("撤銷取消：隊伍已在後面時段打卡 → CANCEL_VOID_ORDER_CONFLICT；該紀錄撤銷後即可撤銷取消", async () => {
    await fx.at("09:50");
    const cid = await cancel(fx.a(3, "S2"));

    await fx.at("10:17");
    const teamIn = await checkCreated(client, {
      assignmentId: fx.a(4, "S3"),
      action: "team_check_in",
      teamId: fx.team("T3"),
      identityId: fx.teamIdentity("T3"),
    });

    expect(await voidCancellation(cid)).toMatchObject({ status: "rejected", code: "CANCEL_VOID_ORDER_CONFLICT" });
    expect(await cancellationVoidedAt(cid)).toBeNull();

    expect((await adminVoidRecord(client, teamIn.id, fx.adminId, "DB測試：先撤銷後面的紀錄")).status).toBe("voided");
    expect(await voidCancellation(cid)).toMatchObject({ status: "ok", cancellation_id: cid });
    expect(await cancellationVoidedAt(cid)).not.toBeNull();
  });

  it("撤銷取消：後面沒有任何紀錄 → 成功，並建立 VOID 通知；重複撤銷回 CANCELLATION_NOT_FOUND", async () => {
    await fx.at("10:20");
    const cid = await cancel(fx.a(6, "S4"));
    expect(await voidCancellation(cid)).toMatchObject({ status: "ok", cancellation_id: cid });
    expect(await cancellationVoidedAt(cid)).not.toBeNull();
    expect(
      await countRows(client, "notifications", (q) => q.eq("trigger_cancellation_id", cid).eq("trigger_phase", "VOID")),
    ).toBe(1);
    expect(await voidCancellation(cid)).toMatchObject({ status: "rejected", code: "CANCELLATION_NOT_FOUND" });
  });

  // -------------------------------------------------------------------
  // admin_correct_record / create_notification / revalidate_notifications
  // -------------------------------------------------------------------

  it("admin_correct_record：通知保持有效並改指向新紀錄", async () => {
    await fx.at("09:12");
    const aid = fx.a(1, "S5");
    const sci = await checkCreated(client, {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.stationIdentity("S5"),
    });

    const created = await createNotification({ kind: "STATION_OVERTIME", assignmentId: aid, triggerRecordId: sci.id });
    expect(created.result).toBe("created");
    const nid = created.notification!.id;

    const corrected = await rpc<StatusResult>(client, "admin_correct_record", {
      p_record_id: sci.id,
      p_new_recorded_at: new Date(taipeiLocalToMs(TEST_EVENT_DATE, "09:11")).toISOString(),
      p_identity_id: fx.adminId,
      p_reason: "DB測試修正時間",
      p_client_request_id: randomUUID(),
      p_client_info: null,
    });
    expect(corrected.status).toBe("created");
    const newId = corrected.record!.id;
    expect(newId).not.toBe(sci.id);

    const after = await notification(nid);
    expect(after.invalidated_at).toBeNull();
    expect(after.trigger_record_id).toBe(newId);

    // 同一 key（新紀錄）再建立一次 → exists（不會重複）
    const again = await createNotification({ kind: "STATION_OVERTIME", assignmentId: aid, triggerRecordId: newId });
    expect(again.result).toBe("exists");
    expect(again.notification?.id).toBe(nid);
  });

  it("create_notification：trigger 紀錄已撤銷 → not_yet（不建立）；延長已撤銷 → not_yet", async () => {
    await fx.at("09:12");
    const aid = fx.a(1, "S6");
    const sci = await checkCreated(client, {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.stationIdentity("S6"),
    });
    expect((await adminVoidRecord(client, sci.id, fx.adminId, "DB測試撤銷")).status).toBe("voided");

    const r = await createNotification({ kind: "STATION_OVERTIME", assignmentId: aid, triggerRecordId: sci.id });
    expect(r).toEqual({ result: "not_yet", notification: null });
    expect(await countRows(client, "notifications", (q) => q.eq("trigger_record_id", sci.id).eq("kind", "STATION_OVERTIME"))).toBe(0);

    // 延長（end override）撤銷後也一樣
    const sci2 = await checkCreated(client, {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.stationIdentity("S6"),
    });
    const ov = await rpc<StatusResult>(client, "set_end_override", {
      p_assignment_id: aid,
      p_official_end: new Date(taipeiLocalToMs(TEST_EVENT_DATE, "09:30")).toISOString(),
      p_reason: "DB測試延長",
      p_identity_id: fx.adminId,
    });
    expect(ov.status).toBe("ok");
    const overrideId = ov.override_id as string;
    expect(
      (
        await rpc<StatusResult>(client, "void_end_override", {
          p_override_id: overrideId,
          p_identity_id: fx.adminId,
          p_reason: "DB測試撤銷延長",
        })
      ).status,
    ).toBe("ok");
    const r2 = await createNotification({
      kind: "STATION_OVERTIME",
      assignmentId: aid,
      triggerRecordId: sci2.id,
      triggerOverrideId: overrideId,
    });
    expect(r2).toEqual({ result: "not_yet", notification: null });

    // 兩者都有效 → created
    const ok = await createNotification({ kind: "STATION_OVERTIME", assignmentId: aid, triggerRecordId: sci2.id });
    expect(ok.result).toBe("created");
  });

  it("revalidate_notifications：只把已解除的恢復；回傳實際更新筆數", async () => {
    const aid = fx.a(1, "S5");
    const created = await createNotification({ kind: "STATION_NOT_STARTED", assignmentId: aid });
    expect(created.result).toBe("created");
    const nid = created.notification!.id;

    expect(await rpc<number>(client, "revalidate_notifications", { p_ids: [nid] })).toBe(0);
    expect(await rpc<number>(client, "invalidate_notifications", { p_ids: [nid] })).toBe(1);
    expect((await notification(nid)).invalidated_at).not.toBeNull();
    expect(await rpc<number>(client, "revalidate_notifications", { p_ids: [nid, randomUUID()] })).toBe(1);
    expect((await notification(nid)).invalidated_at).toBeNull();
    expect(await rpc<number>(client, "revalidate_notifications", { p_ids: [nid] })).toBe(0);
  });

  // -------------------------------------------------------------------
  // 登入鎖（真實時間）
  // -------------------------------------------------------------------

  const beginLogin = (deviceId: string, identityId: string) =>
    rpc<LoginBegin>(client, "begin_login_attempt", { p_device_id: deviceId, p_identity_id: identityId });
  const finishLogin = (attemptId: number, success: boolean) =>
    rpc<null>(client, "finish_login_attempt", { p_attempt_id: attemptId, p_success: success });

  it("begin_login_attempt：10 個並行嘗試最多 5 個未鎖定；之後同 identity 換裝置也被鎖", async () => {
    const identityId = fx.teamIdentity("T7");
    const device = `db-test-${randomUUID()}`;

    const results = await Promise.all(Array.from({ length: 10 }, () => beginLogin(device, identityId)));
    const open = results.filter((r) => !r.locked);
    expect(open.length).toBeLessThanOrEqual(5);
    expect(open.length).toBe(5);
    for (const r of open) expect(typeof r.attempt_id).toBe("number");
    for (const r of results.filter((x) => x.locked)) {
      expect(r.attempt_id).toBeNull();
      expect(r.retry_after_seconds).toBeGreaterThan(0);
      expect(r.retry_after_seconds).toBeLessThanOrEqual(60);
    }
    // 鎖定時不寫入
    expect(await countRows(client, "login_attempts", (q) => q.eq("identity_id", identityId))).toBe(5);

    // pending 全部變成失敗：仍然鎖定；失敗寫 LOGIN_FAILED
    for (const r of open) await finishLogin(r.attempt_id!, false);
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "LOGIN_FAILED").eq("target_id", identityId))).toBe(5);

    const otherDevice = await beginLogin(`db-test-${randomUUID()}`, identityId);
    expect(otherDevice.locked).toBe(true);
    expect(otherDevice.attempt_id).toBeNull();

    // login_lock_status（相容保留）判斷一致
    const status = await rpc<{ locked: boolean }>(client, "login_lock_status", { p_device_id: device, p_identity_id: identityId });
    expect(status.locked).toBe(true);
  });

  it("finish_login_attempt(success) 不算失敗；pending 算失敗", async () => {
    const identityId = fx.teamIdentity("T8");
    const device = `db-test-${randomUUID()}`;

    for (let i = 0; i < 6; i++) {
      const b = await beginLogin(device, identityId);
      expect(b.locked).toBe(false);
      await finishLogin(b.attempt_id!, true);
    }
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "LOGIN_FAILED").eq("target_id", identityId))).toBe(0);

    // 5 個 pending（未 finish）→ 第 6 個鎖定
    for (let i = 0; i < 5; i++) expect((await beginLogin(device, identityId)).locked).toBe(false);
    expect((await beginLogin(device, identityId)).locked).toBe(true);
  });

  // -------------------------------------------------------------------
  // 批次改 PIN
  // -------------------------------------------------------------------

  it("set_identity_pins：任一 id 不存在 → NOT_FOUND 且全部不變；成功時每個 pin_version + 1", async () => {
    const ids = ["T1", "T2", "T3"].map((k) => fx.teamIdentity(k));
    const read = async (): Promise<Map<string, IdentityPinRow>> => {
      const rows = await must<IdentityPinRow[]>(
        "讀取 identities",
        client.from("identities").select("id, pin_hash, pin_version").in("id", ids),
      );
      return new Map(rows.map((r) => [r.id, r]));
    };
    const before = await read();
    const setPins = (pIds: string[], hashes: string[], actor: string | null = fx.adminId) =>
      rpc<StatusResult>(client, "set_identity_pins", { p_ids: pIds, p_hashes: hashes, p_actor: actor });

    expect(await setPins([ids[0]!, randomUUID()], ["h-a", "h-b"])).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await setPins(ids, ["h-a", "h-b"])).toMatchObject({ status: "rejected", code: "INVALID_REQUEST" });
    expect(await setPins(ids, ["h-a", " ", "h-c"])).toMatchObject({ status: "rejected", code: "INVALID_REQUEST" });
    expect(await setPins(ids, ["h-a", "h-b", "h-c"], fx.viewerId)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(await read()).toEqual(before);

    const hashes = ids.map((_, i) => `db-test-hash-${i}-${randomUUID()}`);
    expect(await setPins(ids, hashes)).toEqual({ status: "ok", count: 3 });
    const after = await read();
    ids.forEach((id, i) => {
      expect(after.get(id)!.pin_version).toBe(before.get(id)!.pin_version + 1);
      expect(after.get(id)!.pin_hash).toBe(hashes[i]);
    });
    expect(
      await countRows(client, "audit_logs", (q) => q.eq("action", "PIN_CHANGED").in("target_id", ids).eq("actor_identity_id", fx.adminId)),
    ).toBe(3);
  });
});
