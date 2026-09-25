import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminExportType } from "@/lib/api/contract";
import { loadGameSnapshot } from "@/lib/data/snapshot";
import type {
  AuditLogRow,
  CheckAction,
  GameRow,
  GameSnapshot,
  NotificationKind,
  RecordSource,
} from "@/lib/types";
import { requireAdmin } from "@/lib/server/auth";
import { toCsv, type CsvCell } from "@/lib/server/csv";
import { DbFailure, getActiveEvent, getAllIdentities, getGamesOfEvent } from "@/lib/server/db";
import { badRequest, notFound } from "@/lib/server/errors";
import { apiRoute } from "@/lib/server/http";
import { getServiceClient } from "@/lib/server/supabase";
import { formatDbTimestampTaipei, formatTaipeiDateTime } from "@/lib/server/time-input";
import { isGameCode } from "@/lib/server/validate";

export const dynamic = "force-dynamic";

const EXPORT_TYPES: readonly AdminExportType[] = ["records", "audit", "schedule", "notifications"];
/** audit log 匯出上限（一天活動只有數千筆） */
const AUDIT_EXPORT_LIMIT = 20_000;

const ACTION_TEXT: Record<CheckAction, string> = {
  station_check_in: "關主進關",
  station_check_out: "關主出關",
  team_check_in: "隊輔進關",
  team_check_out: "隊輔出關",
};
const SOURCE_TEXT: Record<RecordSource, string> = {
  ui: "現場操作",
  admin_correction: "總召修正／補登",
  admin_force: "總召強制結束",
};
const KIND_TEXT: Record<NotificationKind, string> = {
  STATION_OVERTIME: "關卡超時",
  TRANSITION_OVERDUE: "跑關逾期",
  STATION_NOT_STARTED: "關主未開始",
  PREV_NOT_CHECKED_OUT: "漏按出關",
  STATION_SHORTENED: "可玩時間不足",
  SCHEDULE_ADJUSTED: "排程調整／取消",
  SELF_UNDO: "現場撤銷",
  RECORD_MISMATCH: "紀錄不一致",
};

const t = (ms: number | null | undefined): string => (ms === null || ms === undefined ? "" : formatTaipeiDateTime(ms));

/**
 * GET /api/admin/export?type=records|audit|schedule|notifications&game=gold|land（第二十五節「匯出 CSV」）
 * - UTF-8 BOM（Excel 可直接開）；時間一律 Asia/Taipei 'YYYY-MM-DD HH:mm:ss'。
 * - records 含已撤銷紀錄（「狀態」欄標示）；game 省略時匯出目前活動的所有遊戲。
 */
export const GET = apiRoute("GET /api/admin/export", async (req: NextRequest) => {
  await requireAdmin(req);
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  if (!type || !(EXPORT_TYPES as readonly string[]).includes(type)) {
    throw badRequest("type 必須是 records、audit、schedule 或 notifications。");
  }
  const gameParam = sp.get("game");
  if (gameParam && gameParam !== "all" && !isGameCode(gameParam)) throw badRequest("game 參數不正確。");

  const client = getServiceClient();
  const event = await getActiveEvent(client);
  if (!event) throw notFound("找不到目前的活動。");
  const games = (await getGamesOfEvent(client, event.id)).filter(
    (g) => !gameParam || gameParam === "all" || g.code === gameParam,
  );
  if (games.length === 0) throw notFound("找不到這個遊戲。");

  const identities = await getAllIdentities(client);
  const identityLabel = new Map(identities.map((i) => [i.id, i.label]));
  const label = (id: string | null) => (id ? (identityLabel.get(id) ?? id) : "");

  let csv: string;
  switch (type as AdminExportType) {
    case "records":
      csv = await exportRecords(client, games, label);
      break;
    case "schedule":
      csv = await exportSchedule(client, games);
      break;
    case "notifications":
      csv = await exportNotifications(client, games);
      break;
    case "audit":
      csv = await exportAudit(client, games, !gameParam || gameParam === "all", label);
      break;
  }

  const filename = `camp-${type}-${gameParam && gameParam !== "all" ? gameParam : "all"}-${event.event_date}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

async function loadSnapshots(client: SupabaseClient, games: GameRow[]): Promise<GameSnapshot[]> {
  return Promise.all(games.map((g) => loadGameSnapshot(client, { gameId: g.id })));
}

function indexSnapshot(snap: GameSnapshot) {
  const slotById = new Map(snap.slots.map((s) => [s.id, s]));
  const stationById = new Map(snap.stations.map((s) => [s.id, s]));
  const teamById = new Map(snap.teams.map((tm) => [tm.id, tm]));
  const assignmentById = new Map(snap.assignments.map((a) => [a.id, a]));
  const teamName = (id: string | null | undefined) => (id ? (teamById.get(id)?.name ?? "") : "");
  return { slotById, stationById, teamById, assignmentById, teamName };
}

/** 打卡紀錄（含已撤銷） */
async function exportRecords(
  client: SupabaseClient,
  games: GameRow[],
  label: (id: string | null) => string,
): Promise<string> {
  const header = [
    "遊戲", "時段", "關卡代號", "關卡", "本場隊伍", "動作", "紀錄隊伍", "正式時間", "實際寫入時間",
    "來源", "本隊未到", "單隊開始", "原因", "操作者", "狀態", "撤銷時間", "撤銷者", "撤銷原因",
    "取代紀錄 ID", "紀錄 ID",
  ];
  const rows: CsvCell[][] = [];
  for (const snap of await loadSnapshots(client, games)) {
    const ix = indexSnapshot(snap);
    const sorted = [...snap.records].sort((a, b) => a.recordedAt - b.recordedAt || a.realCreatedAt - b.realCreatedAt);
    for (const r of sorted) {
      const a = ix.assignmentById.get(r.assignmentId);
      const slot = a ? ix.slotById.get(a.slotId) : undefined;
      const station = a ? ix.stationById.get(a.stationId) : undefined;
      const assignmentTeams = a ? [ix.teamName(a.teamAId), ix.teamName(a.teamBId)].filter((n) => n !== "").join(" vs ") : "";
      rows.push([
        snap.game.name,
        slot ? `第${slot.number}時段` : "",
        station?.code ?? "",
        station?.name ?? "",
        assignmentTeams,
        ACTION_TEXT[r.action],
        ix.teamName(r.teamId),
        t(r.recordedAt),
        t(r.realCreatedAt),
        SOURCE_TEXT[r.source],
        r.noShow,
        r.singleTeamOverride,
        r.reason ?? "",
        label(r.identityId),
        r.voidedAt === null ? "有效" : "已撤銷",
        t(r.voidedAt),
        label(r.voidedBy),
        r.voidReason ?? "",
        r.replacesRecordId ?? "",
        r.id,
      ]);
    }
  }
  return toCsv(header, rows);
}

/** 排程（有效時間含延後；大地休息格也列出） */
async function exportSchedule(client: SupabaseClient, games: GameRow[]): Promise<string> {
  const header = [
    "遊戲", "時段", "原定開始", "原定結束", "有效開始", "有效結束", "延後（分鐘）",
    "關卡代號", "關卡", "隊伍A", "隊伍B", "取消", "取消原因", "延長至", "延長原因",
  ];
  const rows: CsvCell[][] = [];
  for (const snap of await loadSnapshots(client, games)) {
    const ix = indexSnapshot(snap);
    const bySlotStation = new Map(snap.assignments.map((a) => [`${a.slotId}|${a.stationId}`, a]));
    const validCancel = new Map(snap.cancellations.filter((c) => c.voidedAt === null).map((c) => [c.assignmentId, c]));
    const validOverride = new Map(snap.endOverrides.filter((o) => o.voidedAt === null).map((o) => [o.assignmentId, o]));
    for (const slot of snap.slots) {
      for (const station of snap.stations) {
        const a = bySlotStation.get(`${slot.id}|${station.id}`);
        const cancel = a ? validCancel.get(a.id) : undefined;
        const override = a ? validOverride.get(a.id) : undefined;
        rows.push([
          snap.game.name,
          `第${slot.number}時段`,
          t(slot.originalStart),
          t(slot.originalEnd),
          t(slot.scheduledStart),
          t(slot.scheduledEnd),
          Math.round(slot.totalOffsetMs / 60_000),
          station.code,
          station.name,
          a ? ix.teamName(a.teamAId) : "本時段休息",
          a ? ix.teamName(a.teamBId) : "",
          Boolean(cancel),
          cancel?.reason ?? "",
          t(override?.officialEnd),
          override?.reason ?? "",
        ]);
      }
    }
  }
  return toCsv(header, rows);
}

/** 通知（含已解除） */
async function exportNotifications(client: SupabaseClient, games: GameRow[]): Promise<string> {
  const header = ["遊戲", "時間", "種類", "子類", "內容", "時段", "關卡", "隊伍", "階段", "狀態", "解除時間", "通知 ID"];
  const rows: CsvCell[][] = [];
  for (const snap of await loadSnapshots(client, games)) {
    const ix = indexSnapshot(snap);
    for (const n of snap.notifications) {
      const a = n.assignmentId ? ix.assignmentById.get(n.assignmentId) : undefined;
      const slot = a ? ix.slotById.get(a.slotId) : undefined;
      const station = a ? ix.stationById.get(a.stationId) : undefined;
      rows.push([
        snap.game.name,
        t(n.createdAt),
        KIND_TEXT[n.kind],
        n.subkind ?? "",
        n.message,
        slot ? `第${slot.number}時段` : "",
        station?.name ?? "",
        ix.teamName(n.teamId),
        n.triggerPhase === "VOID" ? "撤銷" : "建立",
        n.invalidatedAt === null ? "有效" : "已解除",
        t(n.invalidatedAt),
        n.id,
      ]);
    }
  }
  return toCsv(header, rows);
}

/** Audit log（全部或指定遊戲） */
async function exportAudit(
  client: SupabaseClient,
  games: GameRow[],
  allGames: boolean,
  label: (id: string | null) => string,
): Promise<string> {
  let q = client.from("audit_logs").select("*").order("id", { ascending: true }).limit(AUDIT_EXPORT_LIMIT);
  if (!allGames) q = q.in("game_id", games.map((g) => g.id));
  const { data, error } = await q;
  if (error) throw new DbFailure("audit_logs", error);
  const gameName = new Map(games.map((g) => [g.id, g.name]));
  const header = ["ID", "時間", "動作", "操作者", "遊戲", "目標表", "目標 ID", "原因", "修改前", "修改後", "裝置資訊"];
  const rows: CsvCell[][] = ((data as AuditLogRow[] | null) ?? []).map((r) => [
    r.id,
    formatDbTimestampTaipei(r.created_at),
    r.action,
    label(r.actor_identity_id),
    r.game_id ? (gameName.get(r.game_id) ?? r.game_id) : "",
    r.target_table ?? "",
    r.target_id ?? "",
    r.reason ?? "",
    r.before === null || r.before === undefined ? "" : JSON.stringify(r.before),
    r.after === null || r.after === undefined ? "" : JSON.stringify(r.after),
    r.client_info === null || r.client_info === undefined ? "" : JSON.stringify(r.client_info),
  ]);
  return toCsv(header, rows);
}
