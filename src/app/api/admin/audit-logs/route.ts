import type { NextRequest } from "next/server";
import type { AdminAuditLogsResponse } from "@/lib/api/contract";
import type { AuditLogRow } from "@/lib/types";
import { requireAdmin } from "@/lib/server/auth";
import { DbFailure, getActiveEvent, getAllIdentities, getGamesOfEvent } from "@/lib/server/db";
import { badRequest } from "@/lib/server/errors";
import { apiRoute, jsonOk } from "@/lib/server/http";
import { getServiceClient } from "@/lib/server/supabase";
import { clampIntParam, isGameCode } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

type LogItem = Extract<AdminAuditLogsResponse, { ok: true }>["logs"][number];

/**
 * GET /api/admin/audit-logs?limit=&before=&action=&game=（第二十五節「查看 audit log」）
 * - 依 id 由新到舊；before = 上一頁最後一筆的 id（分頁）。
 * - action：只看某種動作（例如 SELF_UNDO、REJECTED_CHECK）；game：gold / land。
 */
export const GET = apiRoute("GET /api/admin/audit-logs", async (req: NextRequest) => {
  await requireAdmin(req);
  const sp = req.nextUrl.searchParams;
  const limit = clampIntParam(sp.get("limit"), 100, 1, 500);
  const beforeRaw = sp.get("before");
  const action = sp.get("action");
  const gameParam = sp.get("game");
  const client = getServiceClient();

  let q = client.from("audit_logs").select("*").order("id", { ascending: false }).limit(limit);
  if (beforeRaw !== null && beforeRaw !== "") {
    const before = Number(beforeRaw);
    if (!Number.isInteger(before) || before <= 0) throw badRequest("before 參數不正確。");
    q = q.lt("id", before);
  }
  if (action) {
    if (!/^[A-Z_]{1,40}$/.test(action)) throw badRequest("action 參數不正確。");
    q = q.eq("action", action);
  }
  if (gameParam) {
    if (!isGameCode(gameParam)) throw badRequest("game 參數不正確。");
    const event = await getActiveEvent(client);
    const game = event ? (await getGamesOfEvent(client, event.id)).find((g) => g.code === gameParam) : undefined;
    if (!game) return jsonOk({ logs: [] });
    q = q.eq("game_id", game.id);
  }

  const [{ data, error }, identities] = await Promise.all([q, getAllIdentities(client)]);
  if (error) throw new DbFailure("audit_logs", error);
  const labelById = new Map(identities.map((i) => [i.id, i.label]));

  const logs: LogItem[] = ((data as AuditLogRow[] | null) ?? []).map((row) => ({
    id: row.id,
    actorIdentityId: row.actor_identity_id,
    actorLabel: row.actor_identity_id ? (labelById.get(row.actor_identity_id) ?? null) : null,
    gameId: row.game_id,
    action: row.action,
    targetTable: row.target_table,
    targetId: row.target_id,
    before: row.before,
    after: row.after,
    reason: row.reason,
    createdAt: row.created_at,
  }));
  return jsonOk({ logs });
});
