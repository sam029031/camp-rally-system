/**
 * Concurrency（SPEC 第三十節、第二十一節；真 Postgres）：
 * double click、20 次同時 record_check、client_request_id 冪等、撤銷後重新打卡、
 * 撤銷出關與下一場進關同時送出只有一個成功。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDbTestEnv } from "./helpers/env";
import {
  checkCreated,
  countRows,
  createServiceClient,
  recordCheck,
  undoCheck,
  validRecords,
  type CheckArgs,
} from "./helpers/db";
import { createFixture, type Fixture } from "./helpers/fixture";

const env = loadDbTestEnv();
const RACE_STATIONS = ["R1", "R2", "R3", "R4", "R5"];

describe.skipIf(!env)("DB：concurrency", () => {
  let client: SupabaseClient;
  let fx: Fixture;

  beforeAll(async () => {
    client = createServiceClient(env!);
    fx = await createFixture(client, {
      label: "concurrency",
      teams: ["T1", "T2", "T3", "P1", "P2", "P3", "P4", "P5", "Q1", "Q2", "Q3", "Q4", "Q5"],
      games: [
        {
          code: "gold",
          stations: ["G1", "G2", "G3", ...RACE_STATIONS],
          assignments: [
            { slot: 1, station: "G1", teams: ["T1"] },
            { slot: 1, station: "G2", teams: ["T2"] },
            { slot: 1, station: "G3", teams: ["T3"] },
            // 競態用：每一關第1時段 P_i、第2時段 Q_i（隊伍互不重疊，避免「隊伍已到下一關」干擾）
            ...RACE_STATIONS.map((s, i) => ({ slot: 1, station: s, teams: [`P${i + 1}`] as [string] })),
            ...RACE_STATIONS.map((s, i) => ({ slot: 2, station: s, teams: [`Q${i + 1}`] as [string] })),
          ],
        },
      ],
    });
    await fx.at("09:12");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("double click（同一個 client_request_id 同時送兩次）不建立 duplicate", async () => {
    const aid = fx.a(1, "G1");
    const args: CheckArgs = {
      assignmentId: aid,
      action: "station_check_in",
      identityId: fx.stationIdentity("G1"),
      clientRequestId: randomUUID(),
    };
    const [r1, r2] = await Promise.all([recordCheck(client, args), recordCheck(client, args)]);
    expect([r1.status, r2.status].sort()).toEqual(["created", "existing"]);
    expect(r1.record?.id).toBeDefined();
    expect(r1.record?.id).toBe(r2.record?.id);
    expect(await validRecords(client, aid, "station_check_in")).toHaveLength(1);
    expect(await countRows(client, "check_records", (q) => q.eq("client_request_id", args.clientRequestId!))).toBe(1);

    // 另一支手機（新的 client_request_id）再按一次 → already_recorded 回傳原紀錄，並寫 audit
    const again = await recordCheck(client, { ...args, clientRequestId: randomUUID() });
    expect(again.status).toBe("already_recorded");
    expect(again.record?.id).toBe(r1.record?.id);
    expect(await validRecords(client, aid, "station_check_in")).toHaveLength(1);
    expect(
      await countRows(client, "audit_logs", (q) => q.eq("action", "DUPLICATE_ATTEMPT").eq("target_id", r1.record!.id)),
    ).toBe(1);
  });

  it("Promise.all 同時呼叫 record_check 20 次（隊輔側）→ 只有一筆有效，其餘 already_recorded 同一筆", async () => {
    const aid = fx.a(1, "G2");
    const teamId = fx.team("T2");
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        recordCheck(client, { assignmentId: aid, action: "team_check_in", teamId, identityId: fx.teamIdentity("T2") }),
      ),
    );
    const created = results.filter((r) => r.status === "created");
    expect(created).toHaveLength(1);
    const id = created[0].record!.id;
    for (const r of results) {
      expect(["created", "already_recorded"]).toContain(r.status);
      expect(r.record?.id).toBe(id);
    }
    expect(await validRecords(client, aid, "team_check_in", teamId)).toHaveLength(1);
    expect(await countRows(client, "check_records", (q) => q.eq("assignment_id", aid))).toBe(1);
    // 重複嘗試都留下 audit log
    expect(await countRows(client, "audit_logs", (q) => q.eq("action", "DUPLICATE_ATTEMPT").eq("target_id", id))).toBe(19);
  });

  it("Promise.all 同時呼叫 record_check 20 次（關主側，team_id NULL）→ 只有一筆有效", async () => {
    const aid = fx.a(1, "G3");
    const identities = [fx.stationIdentity("G3"), fx.adminId];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordCheck(client, { assignmentId: aid, action: "station_check_in", identityId: identities[i % 2] }),
      ),
    );
    const created = results.filter((r) => r.status === "created");
    expect(created).toHaveLength(1);
    for (const r of results) {
      expect(["created", "already_recorded"]).toContain(r.status);
      expect(r.record?.id).toBe(created[0].record!.id);
    }
    expect(await validRecords(client, aid, "station_check_in")).toHaveLength(1);
  });

  it("同一個 client_request_id 重送回傳同一筆（已撤銷的也回傳並標示），撤銷後用新的 id 可以重新打卡", async () => {
    const aid = fx.a(1, "G1");
    const teamId = fx.team("T1");
    const crid = randomUUID();
    const args: CheckArgs = {
      assignmentId: aid,
      action: "team_check_in",
      teamId,
      identityId: fx.teamIdentity("T1"),
      clientRequestId: crid,
    };
    const first = await recordCheck(client, args);
    expect(first.status).toBe("created");
    const resend = await recordCheck(client, args);
    expect(resend.status).toBe("existing");
    expect(resend.record?.id).toBe(first.record?.id);
    expect(resend.voided).toBe(false);

    // 撤銷
    const undo = await undoCheck(client, first.record!.id, fx.teamIdentity("T1"));
    expect(undo.status).toBe("voided");
    expect(await validRecords(client, aid, "team_check_in", teamId)).toHaveLength(0);

    // 舊的 client_request_id 重送：回傳那一筆（已撤銷），不會重新建立
    const staleResend = await recordCheck(client, args);
    expect(staleResend.status).toBe("existing");
    expect(staleResend.voided).toBe(true);
    expect(staleResend.record?.id).toBe(first.record?.id);
    expect(staleResend.record?.voided_at).not.toBeNull();

    // 撤銷之後重新按（新的 client_request_id）→ 成功，不撞 partial unique index
    const again = await checkCreated(client, { ...args, clientRequestId: randomUUID() });
    expect(again.id).not.toBe(first.record?.id);
    expect(await validRecords(client, aid, "team_check_in", teamId)).toHaveLength(1);
    expect(
      await countRows(client, "check_records", (q) => q.eq("assignment_id", aid).eq("action", "team_check_in")),
    ).toBe(2);
  });

  it("撤銷出關與下一場進關同時送出 → 只有一個成功（重複 5 次）", async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < RACE_STATIONS.length; i++) {
      const st = RACE_STATIONS[i];
      const sid = fx.stationIdentity(st);
      await checkCreated(client, { assignmentId: fx.a(1, st), action: "station_check_in", identityId: sid });
      const out = await checkCreated(client, { assignmentId: fx.a(1, st), action: "station_check_out", identityId: sid });

      const [undo, next] = await Promise.all([
        undoCheck(client, out.id, sid),
        recordCheck(client, { assignmentId: fx.a(2, st), action: "station_check_in", identityId: sid }),
      ]);
      const undoOk = undo.status === "voided";
      const nextOk = next.status === "created";
      expect(undoOk !== nextOk, `第 ${i + 1} 次：undo=${undo.status}/${undo.code ?? ""} next=${next.status}/${next.code ?? ""}`).toBe(
        true,
      );
      if (undoOk) {
        expect(next).toMatchObject({ status: "rejected", code: "PREV_ASSIGNMENT_NOT_CHECKED_OUT" });
      } else {
        expect(undo).toMatchObject({ status: "rejected", code: "UNDO_NEXT_CHECKED_IN" });
      }
      outcomes.push(undoOk ? "undo" : "next");

      // DB 最終狀態一致：撤銷贏 → 出關已撤銷、下一場沒有進關；進關贏 → 出關仍有效、下一場已進關
      const validOut = await validRecords(client, fx.a(1, st), "station_check_out");
      const validNextIn = await validRecords(client, fx.a(2, st), "station_check_in");
      expect(validOut).toHaveLength(undoOk ? 0 : 1);
      expect(validNextIn).toHaveLength(nextOk ? 1 : 0);
    }
    expect(outcomes).toHaveLength(RACE_STATIONS.length);
  });
});
