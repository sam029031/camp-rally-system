"use client";

/**
 * [admin-b] Audit log（第六、二十五節「查看 audit log」）。
 *
 * - GET /api/admin/audit-logs 分頁（limit / before = 上一頁最後一筆 id），由新到舊。
 * - 篩選：動作、遊戲（目前遊戲／全部）。
 * - 每筆：日期＋時間 HH:mm:ss（台北）、動作、操作者 label、原因、目標（有對應場次時顯示中文描述），
 *   before / after JSON 可展開。
 */

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { GAME_NAMES } from "@/lib/constants";
import { formatHms, msToTaipeiDate } from "@/lib/time";
import type { GameCode } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ErrorText } from "@/components/error-text";
import type { AdminTabProps } from "./types";
import {
  AUDIT_ACTION_LABEL,
  auditActionLabel,
  auditCheckInfo,
  buildSnapIndex,
  describeAuditTarget,
  parseIso,
  prettyJson,
  voidReasonText,
  type AuditLogItem,
  type SnapIndex,
} from "./b-helpers";
import { fetchAuditLogs, TabHeader } from "./b-shared";

const PAGE_SIZE = 50;

type GameScope = "current" | "all";

interface Query {
  action: string;
  scope: GameScope;
}

interface ListState {
  /** 產生這份清單的查詢（game + action + scope） */
  key: string;
  logs: AuditLogItem[];
  /** 還有更舊的資料 */
  hasMore: boolean;
  error: string | null;
}

/** 需要特別注意的動作（紅／橘色標籤） */
const ACTION_TONE: Record<string, "red" | "orange" | "blue" | "purple" | "gray" | "green"> = {
  REJECTED_CHECK: "red",
  DUPLICATE_ATTEMPT: "orange",
  SELF_UNDO: "orange",
  ADMIN_VOID: "purple",
  ADMIN_CORRECT: "purple",
  ADMIN_ADD: "purple",
  ADMIN_FORCE_END: "purple",
  NO_SHOW: "gray",
  SINGLE_TEAM_START: "orange",
  LOGIN_FAILED: "red",
  PIN_CHANGED: "blue",
  RESET: "red",
  CHECK_RECORDED: "green",
};

function queryKey(game: GameCode, q: Query): string {
  return `${game}|${q.scope}|${q.action}`;
}

export function AuditTab({ gameCode, live }: AdminTabProps) {
  const snap = live.snapshot;
  const ix = React.useMemo(() => (snap ? buildSnapIndex(snap) : null), [snap]);
  const gameId = snap?.game.id ?? null;

  const [query, setQuery] = React.useState<Query>({ action: "", scope: "current" });
  const [nonce, setNonce] = React.useState(0);
  const [list, setList] = React.useState<ListState | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const key = queryKey(gameCode, query);
  const fetchKey = `${key}|${nonce}`;

  // 第一頁（查詢條件變更或重新整理時）
  React.useEffect(() => {
    let cancelled = false;
    const [game, scope, action] = key.split("|");
    void fetchAuditLogs({
      limit: PAGE_SIZE,
      action: action || null,
      game: scope === "current" ? (game as GameCode) : null,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok) setList({ key: `${key}|${nonce}`, logs: res.logs, hasMore: res.logs.length === PAGE_SIZE, error: null });
      else setList((prev) => ({ key: `${key}|${nonce}`, logs: prev && prev.key.startsWith(`${key}|`) ? prev.logs : [], hasMore: false, error: res.error }));
    });
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const current = list && list.key.startsWith(`${key}|`) ? list : null;
  const loading = list?.key !== fetchKey;

  const loadMore = async () => {
    if (!current || current.logs.length === 0) return;
    const last = current.logs[current.logs.length - 1];
    setLoadingMore(true);
    const res = await fetchAuditLogs({
      limit: PAGE_SIZE,
      before: last.id,
      action: query.action || null,
      game: query.scope === "current" ? gameCode : null,
    });
    setLoadingMore(false);
    setList((prev) => {
      if (!prev || prev.key !== current.key) return prev;
      if (!res.ok) return { ...prev, error: res.error };
      const seen = new Set(prev.logs.map((l) => l.id));
      return {
        ...prev,
        logs: [...prev.logs, ...res.logs.filter((l) => !seen.has(l.id))],
        hasMore: res.logs.length === PAGE_SIZE,
        error: null,
      };
    });
  };

  const actionOptions = [
    { value: "", label: "全部動作" },
    ...Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label: `${label}（${value}）` })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        title="Audit log"
        description="所有修改、撤銷、被拒絕與重複的打卡、登入失敗、PIN 修改、排程調整等紀錄（由新到舊，時間為台北時間）。"
        onRefresh={() => setNonce((n) => n + 1)}
        refreshing={loading && current !== null}
      />

      <section aria-label="篩選" className="grid gap-3 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4 sm:grid-cols-2">
        <Field label="動作" htmlFor="b-audit-action">
          <Select
            id="b-audit-action"
            value={query.action}
            onChange={(e) => setQuery((q) => ({ ...q, action: e.target.value }))}
            options={actionOptions}
          />
        </Field>
        <Field label="範圍" htmlFor="b-audit-scope" hint="登入失敗、PIN 修改、活動設定等不屬於單一遊戲的紀錄，請選「全部」。">
          <Select
            id="b-audit-scope"
            value={query.scope}
            onChange={(e) => setQuery((q) => ({ ...q, scope: e.target.value as GameScope }))}
            options={[
              { value: "current", label: `只看${GAME_NAMES[gameCode]}` },
              { value: "all", label: "全部（含不屬於遊戲的紀錄）" },
            ]}
          />
        </Field>
      </section>

      <ErrorText message={current?.error ?? null} />

      {!current ? (
        <p className="rounded-2xl border-2 border-slate-300 bg-white p-6 text-center text-lg font-bold text-slate-700">讀取中…</p>
      ) : current.logs.length === 0 ? (
        <p className="rounded-2xl border-2 border-slate-300 bg-white p-6 text-center text-lg font-bold text-slate-700">沒有符合條件的紀錄。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {current.logs.map((log) => (
            <AuditRow key={log.id} log={log} ix={ix && log.gameId === gameId ? ix : null} />
          ))}
        </ul>
      )}

      {current && current.logs.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-base font-bold text-slate-700">已顯示 {current.logs.length} 筆</p>
          {current.hasMore ? (
            <Button variant="secondary" size="lg" onClick={() => void loadMore()} loading={loadingMore} loadingText="讀取中…">
              載入更舊的紀錄
            </Button>
          ) : (
            <p className="text-base text-slate-600">已經是最舊的紀錄。</p>
          )}
        </div>
      )}
    </div>
  );
}

function AuditRow({ log, ix }: { log: AuditLogItem; ix: SnapIndex | null }) {
  const created = parseIso(log.createdAt);
  const info = auditCheckInfo(log.before, log.after, log.targetTable, log.targetId);
  const target = describeAuditTarget(ix, info);
  const tone = ACTION_TONE[log.action] ?? "blue";
  const actor = log.actorLabel ?? (log.actorIdentityId ? "（已刪除的身分）" : "系統／未知身分");
  const reasonText = log.reason ? voidReasonText(log.reason) : null;
  const hasJson = log.before !== null || log.after !== null;

  return (
    <li className="rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="timer-digits text-2xl font-black text-slate-950">{created !== null ? formatHms(created) : "—"}</span>
        <span className="text-base text-slate-600">{created !== null ? msToTaipeiDate(created) : ""}</span>
        <Badge tone={tone} size="md">
          {auditActionLabel(log.action)}
        </Badge>
        <span className="text-sm text-slate-500">#{log.id}</span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
        <dt className="font-bold text-slate-600">操作者</dt>
        <dd className="font-bold text-slate-950">{actor}</dd>
        {target && (
          <>
            <dt className="font-bold text-slate-600">目標</dt>
            <dd className="text-slate-950">{target}</dd>
          </>
        )}
        {!target && log.targetTable && (
          <>
            <dt className="font-bold text-slate-600">目標</dt>
            <dd className="break-all text-slate-800">
              {log.targetTable}
              {log.targetId ? ` ${log.targetId}` : ""}
            </dd>
          </>
        )}
        {info.code && (
          <>
            <dt className="font-bold text-slate-600">錯誤碼</dt>
            <dd className="font-bold text-red-700">{info.code}</dd>
          </>
        )}
        {reasonText && (
          <>
            <dt className="font-bold text-slate-600">原因</dt>
            <dd className="whitespace-pre-wrap text-slate-950">{reasonText}</dd>
          </>
        )}
      </dl>
      {hasJson && (
        <details className="group mt-3 rounded-xl border-2 border-slate-200 bg-slate-50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-base font-bold text-slate-800 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            修改前／修改後（JSON）
          </summary>
          <div className="grid gap-3 border-t-2 border-slate-200 p-3 lg:grid-cols-2">
            <JsonBlock title="修改前（before）" value={log.before} />
            <JsonBlock title="修改後（after）" value={log.after} />
          </div>
        </details>
      )}
    </li>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm font-bold text-slate-700">{title}</p>
      <pre
        className={cn(
          "max-h-80 overflow-auto rounded-lg border border-slate-300 bg-white p-2 font-mono text-sm leading-relaxed text-slate-900",
          "whitespace-pre-wrap break-all",
        )}
      >
        {prettyJson(value)}
      </pre>
    </div>
  );
}
