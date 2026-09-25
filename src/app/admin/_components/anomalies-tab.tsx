"use client";

/**
 * [admin-b] 異常清單（第二十五節「查看超時」「查看異常」）。
 *
 * 來源：
 * - 推導結果（deriveGame）：超時中、隊輔已出關而關主未出關、隊伍已到下一關但上一關未出關、時段已結束仍未開始、
 *   第十節 C 的所有次要標籤（含隊輔漏按進關）、本隊未到、單隊開始、壓縮後時間不足。
 * - 打卡紀錄（含已撤銷）：現場撤銷紀錄（void_reason = SELF_UNDO）。
 * - Audit log：被拒絕的打卡（REJECTED_CHECK）、重複打卡嘗試（DUPLICATE_ATTEMPT）。
 *
 * 每一項顯示時段／關卡／隊伍／時間，並提供前往關卡頁（總召在關卡頁有和關主相同的按鈕）。
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Users } from "lucide-react";
import type { AssignmentDerived, DerivedGame, SecondaryTag, SecondaryTagKind } from "@/lib/derive/types";
import { errorMessage } from "@/lib/errors";
import { INSUFFICIENT_TIME_CLASS, SECONDARY_TAG_CLASS, SECONDARY_TAG_LABEL, slotLabel } from "@/lib/labels";
import { formatCountdown, formatDurationText, formatHm, formatHms } from "@/lib/time";
import type { GameCode, GameSnapshot, Station } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ErrorText } from "@/components/error-text";
import { StationStateBadge } from "@/components/state-badges";
import type { AdminTabProps } from "./types";
import {
  assignmentTeamsText,
  auditCheckInfo,
  buildSnapIndex,
  formatDateTime,
  parseIso,
  recordActionText,
  stationHref,
  teamHref,
  teamText,
  type AuditLogItem,
  type SnapIndex,
} from "./b-helpers";
import { actorText, AdminLoading, fetchAuditLogs, TabHeader, useAdminIdentities } from "./b-shared";

// ---------------------------------------------------------------------
// 類別
// ---------------------------------------------------------------------

type CategoryKey =
  | "overtime"
  | "teamOut"
  | "prevNotOut"
  | "slotEnded"
  | "checkInMissing"
  | "otherTags"
  | "noShow"
  | "singleTeam"
  | "insufficient"
  | "selfUndo"
  | "rejected"
  | "duplicate";

interface CategoryDef {
  key: CategoryKey;
  title: string;
  description: string;
  tone: "red" | "orange" | "yellow" | "gray" | "blue";
}

const CATEGORIES: readonly CategoryDef[] = [
  { key: "overtime", title: "超時中", description: "計時已過正式結束時間，關主尚未出關。", tone: "red" },
  {
    key: "teamOut",
    title: "未出關（隊輔已出關，關主未出關）",
    description: "人已經離開、計時還在跑，請聯絡關主按確認出關，或由總召強制結束。",
    tone: "red",
  },
  {
    key: "prevNotOut",
    title: "隊伍已到下一關，但上一關未出關",
    description: "上一關的關主漏按出關（或完全沒有進關），請補按、補登或按本隊未到。",
    tone: "orange",
  },
  {
    key: "slotEnded",
    title: "時段已結束仍未開始",
    description: "時段預定結束時間已過，關主仍未確認進關（可能要按本隊未到、延長或取消）。",
    tone: "orange",
  },
  { key: "checkInMissing", title: SECONDARY_TAG_LABEL.TEAM_CHECK_IN_MISSING, description: "隊輔完全沒有進關紀錄就出關。", tone: "orange" },
  {
    key: "otherTags",
    title: "其他雙方紀錄標籤",
    description: "隊輔未確認進關／隊輔未確認出關／紀錄不一致（第十節 C）。",
    tone: "orange",
  },
  { key: "noShow", title: "本隊未到", description: "關主按了「本隊未到」（大地為「本場未進行」）。", tone: "gray" },
  { key: "singleTeam", title: "單隊開始", description: "大地由總召以單隊開始（原因）。", tone: "orange" },
  { key: "insufficient", title: "壓縮後時間不足", description: "固定結束時間壓縮後，可玩時間少於最短可玩時間。", tone: "yellow" },
  { key: "selfUndo", title: "現場撤銷紀錄", description: "關主／隊輔在 1 分鐘內自己撤銷的紀錄。", tone: "gray" },
  { key: "rejected", title: "被拒絕的打卡", description: "違反規則而沒有寫入的打卡（audit log）。", tone: "blue" },
  { key: "duplicate", title: "重複打卡嘗試", description: "已有有效紀錄時又按了同一個動作（audit log）。", tone: "blue" },
];

const CATEGORY_HEAD_CLASS: Record<CategoryDef["tone"], string> = {
  red: "border-red-600 bg-red-50",
  orange: "border-orange-500 bg-orange-50",
  yellow: "border-yellow-500 bg-yellow-50",
  gray: "border-slate-400 bg-slate-50",
  blue: "border-blue-600 bg-blue-50",
};

const COUNT_CLASS: Record<CategoryDef["tone"], string> = {
  red: "bg-red-600 text-white",
  orange: "bg-orange-500 text-white",
  yellow: "bg-yellow-400 text-black",
  gray: "bg-slate-600 text-white",
  blue: "bg-blue-700 text-white",
};

const OTHER_TAG_KINDS: ReadonlySet<SecondaryTagKind> = new Set<SecondaryTagKind>([
  "TEAM_NOT_CHECKED_IN",
  "TEAM_NOT_CHECKED_OUT",
  "CHECKOUT_TIME_DIFF",
]);

interface AnomalyItem {
  key: string;
  category: CategoryKey;
  slotNumber: number | null;
  station: Station | null;
  /** 顯示的隊伍文字 */
  teamLabel: string;
  /** 隊伍頁連結用（單一隊伍時） */
  teamCode: string | null;
  /** 主要時間（HH:mm:ss） */
  time: number | null;
  timeLabel: string;
  detail: string;
  /** 關卡狀態徽章 */
  ad: AssignmentDerived | null;
  /** 排序用 */
  sortKey: number;
}

// ---------------------------------------------------------------------
// 推導 → 異常項目
// ---------------------------------------------------------------------

function stationSortKey(ad: AssignmentDerived): number {
  return ad.slot.number * 1000 + ad.station.sortOrder;
}

function tagTeam(ix: SnapIndex, tag: SecondaryTag): { label: string; code: string | null } {
  const t = ix.teamById.get(tag.teamId);
  return { label: teamText(ix, tag.teamId), code: t?.code ?? null };
}

function derivedItems(snap: GameSnapshot, d: DerivedGame, ix: SnapIndex, labelOf: (id: string | null) => string): AnomalyItem[] {
  const items: AnomalyItem[] = [];
  const now = d.now;
  const recordById = ix.recordById;

  for (const ad of d.assignments.values()) {
    const a = ad.assignment;
    const base = {
      slotNumber: ad.slot.number,
      station: ad.station,
      ad,
      sortKey: stationSortKey(ad),
    };
    const singleTeam = ad.teamIds.length === 1 ? ix.teamById.get(ad.teamIds[0]) : undefined;
    const teamsLabel = assignmentTeamsText(ix, a);

    // 超時中
    if (ad.state === "OVERTIME") {
      items.push({
        ...base,
        key: `overtime-${a.id}`,
        category: "overtime",
        teamLabel: teamsLabel,
        teamCode: singleTeam?.code ?? null,
        time: ad.officialEnd,
        timeLabel: "正式結束",
        detail: `超時 +${formatCountdown(ad.remainingMs ?? 0)}（關主進關 ${ad.stationCheckIn ? formatHms(ad.stationCheckIn.recordedAt) : "—"}）`,
      });
    }

    // 時段已結束仍未開始（已由「隊伍已到下一關」涵蓋的不重複列出）
    const hasPrevTag = ad.tags.some((t) => t.kind === "PREV_NOT_CHECKED_OUT");
    if ((ad.state === "WAITING" || ad.state === "READY") && ad.slot.scheduledEnd <= now && !hasPrevTag) {
      const reported = ad.sides.filter((s) => s.teamCheckIn !== null);
      const detail =
        ad.state === "READY" && ad.stationCheckIn === null && reported.length > 0
          ? `${reported.map((s) => `${teamText(ix, s.teamId)}隊輔已於 ${formatHms(s.teamCheckIn!.recordedAt)} 回報抵達`).join("、")}，關主尚未確認進關。`
          : ad.state === "READY"
            ? "關主已進關，尚未開始計時。"
            : "尚無任何抵達紀錄（待按本隊未到）。";
      items.push({
        ...base,
        key: `slotEnded-${a.id}`,
        category: "slotEnded",
        teamLabel: teamsLabel,
        teamCode: singleTeam?.code ?? null,
        time: ad.slot.scheduledEnd,
        timeLabel: "時段結束",
        detail,
      });
    }

    // 次要標籤
    for (const tag of ad.tags) {
      const team = tagTeam(ix, tag);
      const trigger = tag.triggerRecordId ? (recordById.get(tag.triggerRecordId) ?? null) : null;
      const common = {
        ...base,
        teamLabel: team.label,
        teamCode: team.code,
      };
      if (tag.kind === "TEAM_OUT_STATION_NOT_OUT") {
        items.push({
          ...common,
          key: `teamOut-${a.id}-${tag.teamId}`,
          category: "teamOut",
          time: trigger?.recordedAt ?? null,
          timeLabel: "隊輔出關",
          detail: `${team.label}隊輔已於 ${trigger ? formatHms(trigger.recordedAt) : "—"} 回報出關，關主尚未確認出關。`,
        });
      } else if (tag.kind === "PREV_NOT_CHECKED_OUT") {
        const nextA = trigger ? ix.assignmentById.get(trigger.assignmentId) : undefined;
        const nextStation = nextA ? ix.stationById.get(nextA.stationId) : undefined;
        const nextSlot = nextA ? ix.slotById.get(nextA.slotId) : undefined;
        const where = nextStation ? `${nextSlot ? `${slotLabel(nextSlot.number)} ` : ""}${nextStation.name}` : "下一關";
        items.push({
          ...common,
          key: `prevNotOut-${a.id}-${tag.teamId}`,
          category: "prevNotOut",
          time: trigger?.recordedAt ?? null,
          timeLabel: "到下一關",
          detail: `${tag.label}：${team.label}已於 ${trigger ? formatHms(trigger.recordedAt) : "—"} 抵達${where}。`,
        });
      } else if (tag.kind === "TEAM_CHECK_IN_MISSING") {
        items.push({
          ...common,
          key: `checkInMissing-${a.id}-${tag.teamId}`,
          category: "checkInMissing",
          time: trigger?.recordedAt ?? null,
          timeLabel: "隊輔出關",
          detail: `${team.label}隊輔沒有按確認進關，就在 ${trigger ? formatHms(trigger.recordedAt) : "—"} 按了確認出關。`,
        });
      } else if (OTHER_TAG_KINDS.has(tag.kind)) {
        items.push({
          ...common,
          key: `other-${tag.kind}-${a.id}-${tag.teamId}`,
          category: "otherTags",
          time: trigger?.recordedAt ?? null,
          timeLabel: tag.kind === "TEAM_NOT_CHECKED_IN" ? "關主進關" : "出關",
          detail: tag.label,
        });
      }
    }

    // 本隊未到
    if (ad.noShow && ad.stationCheckOut) {
      const reported = ad.sides.filter((s) => s.teamCheckIn !== null).map((s) => teamText(ix, s.teamId));
      const pk = ad.teamIds.length > 1;
      const parts = [
        `${recordActionText(ad.stationCheckOut, pk)}（${labelOf(ad.stationCheckOut.identityId)}）`,
        pk && reported.length > 0 ? `隊輔回報到場：${reported.join("、")}` : null,
        ad.stationCheckOut.reason ? `原因：${ad.stationCheckOut.reason}` : null,
      ].filter(Boolean);
      items.push({
        ...base,
        key: `noShow-${a.id}`,
        category: "noShow",
        teamLabel: teamsLabel,
        teamCode: singleTeam?.code ?? null,
        time: ad.stationCheckOut.recordedAt,
        timeLabel: "按下時間",
        detail: parts.join("；"),
      });
    }

    // 單隊開始
    if (ad.singleTeamStart && ad.stationCheckIn) {
      const confirmed = (ad.stationCheckIn.confirmedTeamIds ?? []).map((id) => teamText(ix, id)).filter(Boolean);
      items.push({
        ...base,
        key: `single-${a.id}`,
        category: "singleTeam",
        teamLabel: teamsLabel,
        teamCode: null,
        time: ad.stationCheckIn.recordedAt,
        timeLabel: "開始",
        detail: [
          confirmed.length > 0 ? `到場：${confirmed.join("、")}` : null,
          `原因：${ad.stationCheckIn.reason ?? "（未填）"}`,
          `操作者：${labelOf(ad.stationCheckIn.identityId)}`,
        ]
          .filter(Boolean)
          .join("；"),
      });
    }

    // 壓縮後時間不足
    if (ad.insufficientTime && ad.state !== "CANCELLED") {
      items.push({
        ...base,
        key: `insufficient-${a.id}`,
        category: "insufficient",
        teamLabel: teamsLabel,
        teamCode: singleTeam?.code ?? null,
        time: ad.startedAt,
        timeLabel: "開始計時",
        detail: [
          `可玩 ${ad.playableMs !== null ? formatDurationText(ad.playableMs) : "—"}`,
          `最短 ${formatDurationText(snap.game.minPlayMs)}`,
          ad.shortenedMs !== null ? `縮短 ${formatDurationText(ad.shortenedMs)}` : null,
          ad.officialEnd !== null ? `結束 ${formatHm(ad.officialEnd)}` : null,
        ]
          .filter(Boolean)
          .join("；"),
      });
    }
  }

  // 現場撤銷紀錄
  for (const r of snap.records) {
    if (r.voidReason !== "SELF_UNDO" || r.voidedAt === null) continue;
    const a = ix.assignmentById.get(r.assignmentId);
    const ad = a ? (d.assignments.get(a.id) ?? null) : null;
    const t = r.teamId ? ix.teamById.get(r.teamId) : undefined;
    const who = r.teamId && a?.teamBId ? `${teamText(ix, r.teamId)} ` : "";
    items.push({
      key: `selfUndo-${r.id}`,
      category: "selfUndo",
      slotNumber: ad?.slot.number ?? null,
      station: ad?.station ?? null,
      teamLabel: r.teamId ? teamText(ix, r.teamId) : assignmentTeamsText(ix, a),
      teamCode: t?.code ?? null,
      time: r.voidedAt,
      timeLabel: "撤銷",
      detail: `${labelOf(r.identityId)} 於 ${formatHms(r.recordedAt)} 按的【${who}${recordActionText(r, ix.isPk)}】，於 ${formatHms(r.voidedAt)} 撤銷。`,
      ad,
      sortKey: -r.voidedAt,
    });
  }

  return items;
}

/**
 * 分頁徽章用：「異常」分頁由快照＋推導列出的項目數（與分頁內清單同一個 derivedItems，第二十五節）。
 * 不含 audit log 的「被拒絕的打卡」「重複打卡嘗試」（要另外讀 audit、每 30 秒更新），徽章文字會註明只算即時異常。
 * ix 可以傳入已建好的索引（同一份快照）以免重建。
 */
export function countLiveAnomalies(snap: GameSnapshot, d: DerivedGame, ix?: SnapIndex): number {
  return derivedItems(snap, d, ix ?? buildSnapIndex(snap), () => "").length;
}

/** 分頁徽章的說明（滑鼠停留／螢幕報讀） */
export const LIVE_ANOMALY_BADGE_HINT = "數字為目前即時異常數（不含被拒絕／重複的打卡紀錄）";

function auditItems(logs: AuditLogItem[], category: "rejected" | "duplicate", d: DerivedGame, ix: SnapIndex): AnomalyItem[] {
  return logs.map((log) => {
    const info = auditCheckInfo(log.before, log.after, log.targetTable, log.targetId);
    const a = info.assignmentId ? ix.assignmentById.get(info.assignmentId) : undefined;
    const ad = a ? (d.assignments.get(a.id) ?? null) : null;
    const t = info.teamId ? ix.teamById.get(info.teamId) : undefined;
    const created = parseIso(log.createdAt);
    const actionText = info.action ? recordActionText({ action: info.action, noShow: info.noShow, source: "ui" }, ix.isPk) : "打卡";
    const who = log.actorLabel ?? (log.actorIdentityId ? "（已刪除的身分）" : "未知身分");
    const detail =
      category === "rejected"
        ? `${who} 按【${actionText}】被拒絕：${errorMessage(info.code)}${info.code ? `（${info.code}）` : ""}`
        : `${who} 重複按【${actionText}】（已有有效紀錄，沒有新增）`;
    return {
      key: `${category}-${log.id}`,
      category,
      slotNumber: ad?.slot.number ?? null,
      station: ad?.station ?? null,
      teamLabel: info.teamId ? teamText(ix, info.teamId) : assignmentTeamsText(ix, a),
      teamCode: t?.code ?? null,
      time: created,
      timeLabel: "時間",
      detail,
      ad,
      sortKey: -(created ?? 0),
    };
  });
}

// ---------------------------------------------------------------------
// Audit log 讀取（被拒絕的打卡、重複嘗試）
// ---------------------------------------------------------------------

const AUDIT_LIMIT = 200;
const AUDIT_REFRESH_MS = 30_000;

interface AuditState {
  key: string;
  rejected: AuditLogItem[];
  duplicate: AuditLogItem[];
  error: string | null;
}

function useAnomalyAudit(gameCode: GameCode) {
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<AuditState | null>(null);
  const key = `${gameCode}|${nonce}`;

  React.useEffect(() => {
    let cancelled = false;
    const k = `${gameCode}|${nonce}`;
    void Promise.all([
      fetchAuditLogs({ action: "REJECTED_CHECK", game: gameCode, limit: AUDIT_LIMIT }),
      fetchAuditLogs({ action: "DUPLICATE_ATTEMPT", game: gameCode, limit: AUDIT_LIMIT }),
    ]).then(([rej, dup]) => {
      if (cancelled) return;
      setState((prev) => {
        const keep = prev && prev.key.startsWith(`${gameCode}|`) ? prev : null;
        return {
          key: k,
          rejected: rej.ok ? rej.logs : (keep?.rejected ?? []),
          duplicate: dup.ok ? dup.logs : (keep?.duplicate ?? []),
          error: !rej.ok ? rej.error : !dup.ok ? dup.error : null,
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [gameCode, nonce]);

  // 被拒絕的打卡不會改變快照（沒有 Realtime 事件），所以定期重抓
  React.useEffect(() => {
    const id = window.setInterval(() => setNonce((n) => n + 1), AUDIT_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  const sameGame = state !== null && state.key.startsWith(`${gameCode}|`);
  return {
    rejected: sameGame ? state.rejected : [],
    duplicate: sameGame ? state.duplicate : [],
    error: sameGame ? state.error : null,
    loading: state?.key !== key,
    loaded: sameGame,
    reload,
  };
}

// ---------------------------------------------------------------------
// 元件
// ---------------------------------------------------------------------

export function AnomaliesTab({ gameCode, live }: AdminTabProps) {
  const snap = live.snapshot;
  const derived = live.derived;
  const ids = useAdminIdentities();
  const audit = useAnomalyAudit(gameCode);
  const ix = React.useMemo(() => (snap ? buildSnapIndex(snap) : null), [snap]);
  const [filterState, setFilterState] = React.useState<{ game: GameCode; cat: CategoryKey | "all" }>({ game: gameCode, cat: "all" });
  const filter = filterState.game === gameCode ? filterState.cat : "all";

  const labelById = ids.labelById;
  const items = React.useMemo(() => {
    if (!snap || !derived || !ix) return [];
    const labelOf = (id: string | null) => actorText(labelById, id);
    const all = [
      ...derivedItems(snap, derived, ix, labelOf),
      ...auditItems(audit.rejected, "rejected", derived, ix),
      ...auditItems(audit.duplicate, "duplicate", derived, ix),
    ];
    all.sort((x, y) => x.sortKey - y.sortKey);
    return all;
  }, [snap, derived, ix, labelById, audit.rejected, audit.duplicate]);

  if (!snap || !derived || !ix) return <AdminLoading error={live.status.error} />;

  const byCat = new Map<CategoryKey, AnomalyItem[]>();
  for (const c of CATEGORIES) byCat.set(c.key, []);
  for (const it of items) byCat.get(it.category)!.push(it);

  const urgentCount = (byCat.get("overtime")?.length ?? 0) + (byCat.get("teamOut")?.length ?? 0) + (byCat.get("prevNotOut")?.length ?? 0);
  const liveCount = items.length - byCat.get("rejected")!.length - byCat.get("duplicate")!.length;
  const visible = CATEGORIES.filter((c) => filter === "all" || c.key === filter);

  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        title="異常"
        description={`共 ${items.length} 項（即時異常 ${liveCount} 項＝分頁上的數字，不含被拒絕／重複的打卡）；需要立即處理 ${urgentCount} 項。狀態每秒依紀錄與時間重算，被拒絕／重複的打卡每 30 秒更新。`}
        onRefresh={() => {
          audit.reload();
          void live.refetch();
        }}
        refreshing={audit.loading && !audit.loaded}
      />

      {/* 類別篩選 */}
      <nav aria-label="異常類別" className="flex flex-wrap gap-2">
        <CategoryChip active={filter === "all"} onClick={() => setFilterState({ game: gameCode, cat: "all" })} label="全部" count={items.length} tone="gray" />
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c.key}
            active={filter === c.key}
            onClick={() => setFilterState({ game: gameCode, cat: c.key })}
            label={c.title}
            count={byCat.get(c.key)!.length}
            tone={c.tone}
          />
        ))}
      </nav>

      <ErrorText message={audit.error ? `讀取被拒絕／重複的打卡失敗：${audit.error}` : null} />
      <ErrorText message={ids.error ? `讀取操作者名稱失敗：${ids.error}` : null} />

      {visible.map((c) => {
        const list = byCat.get(c.key)!;
        if (filter === "all" && list.length === 0) return null;
        const auditPending = (c.key === "rejected" || c.key === "duplicate") && !audit.loaded;
        return (
          <section key={c.key} aria-labelledby={`b-anom-${c.key}`} className={cn("flex flex-col gap-3 rounded-2xl border-2 p-3 sm:p-4", CATEGORY_HEAD_CLASS[c.tone])}>
            <div className="flex flex-wrap items-center gap-3">
              <h3 id={`b-anom-${c.key}`} className="text-xl font-black text-slate-950">
                {c.title}
              </h3>
              <span className={cn("rounded-full px-3 py-0.5 text-lg font-black", COUNT_CLASS[c.tone])}>{list.length}</span>
            </div>
            <p className="text-base text-slate-800">{c.description}</p>
            {auditPending ? (
              <p className="text-base font-bold text-slate-700">讀取中…</p>
            ) : list.length === 0 ? (
              <p className="rounded-xl bg-white/80 p-3 text-base font-bold text-slate-700">目前沒有。</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((it) => (
                  <AnomalyCard key={it.key} item={it} gameCode={gameCode} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {filter === "all" && items.length === 0 && (
        <p className="rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-6 text-center text-xl font-black text-emerald-900">目前沒有任何異常。</p>
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: CategoryDef["tone"];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-base font-bold",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100",
      )}
    >
      <span className="text-left">{label}</span>
      <span
        className={cn(
          "min-w-7 rounded-full px-2 text-center text-sm font-black",
          count > 0 ? COUNT_CLASS[tone] : active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function AnomalyCard({ item, gameCode }: { item: AnomalyItem; gameCode: GameCode }) {
  const where = [item.slotNumber !== null ? slotLabel(item.slotNumber) : null, item.station?.name ?? null, item.teamLabel || null]
    .filter(Boolean)
    .join("・");
  const tagClass =
    item.category === "insufficient" ? INSUFFICIENT_TIME_CLASS : item.category === "otherTags" || item.category === "checkInMissing" ? SECONDARY_TAG_CLASS : null;
  return (
    <li className="flex flex-col gap-2 rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {item.ad && <StationStateBadge state={item.ad.state} noShow={item.ad.noShow} size="sm" />}
        {item.time !== null && (
          <Badge tone="gray" size="sm">
            {item.timeLabel} <span className="timer-digits">{formatHms(item.time)}</span>
          </Badge>
        )}
      </div>
      <p className="text-lg font-black leading-snug text-slate-950">{where || "（找不到場次）"}</p>
      <p className={cn("rounded-lg text-base leading-relaxed text-slate-900", tagClass && cn("px-2 py-1 font-bold", tagClass))}>
        {tagClass && <AlertTriangle className="mr-1 inline size-4 align-[-2px]" aria-hidden />}
        {item.detail}
      </p>
      {item.time !== null && (item.category === "rejected" || item.category === "duplicate" || item.category === "selfUndo") && (
        <p className="text-sm text-slate-600">{formatDateTime(item.time)}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        {item.station && (
          <Link href={stationHref(gameCode, item.station.code)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <ExternalLink className="size-5" aria-hidden />
            前往關卡頁
          </Link>
        )}
        {item.teamCode && (
          <Link href={teamHref(item.teamCode)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <Users className="size-5" aria-hidden />
            隊伍頁
          </Link>
        )}
      </div>
    </li>
  );
}
