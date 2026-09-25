"use client";

/**
 * [admin-b] 打卡紀錄與修正（第二十二、二十五節）。
 *
 * - 列出本遊戲所有打卡紀錄（含已撤銷：標示「已撤銷」、撤銷原因、撤銷者與時間；修正紀錄與原紀錄互相連結），依時間排序。
 * - 篩選：時段／關卡／隊伍／動作／狀態。
 * - 操作（原因必填、二次確認、不自動重試）：撤銷、修正時間、補登、強制結束。
 *   server 的 error code 訊息（UNDO_NEXT_CHECKED_IN、CHECKOUT_BEFORE_CHECKIN…）顯示在送出按鈕旁。
 */

import * as React from "react";
import { flushSync } from "react-dom";
import { Link2, PlusCircle, Square } from "lucide-react";
import type { AdminRecordResponse } from "@/lib/api/contract";
import type { AssignmentDerived } from "@/lib/derive/types";
import { SOURCE_LABEL, slotLabel } from "@/lib/labels";
import { formatCountdown, formatHms, formatSignedDuration } from "@/lib/time";
import type { Assignment, CheckAction, CheckRecord, GameCode, Slot, Station } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { StationStateBadge } from "@/components/state-badges";
import type { AdminTabProps } from "./types";
import { AddRecordDialog } from "./b-add-record-dialog";
import {
  assignmentTeamsText,
  assignmentText,
  buildSnapIndex,
  hmsOnSameTaipeiDate,
  isStationAction,
  recordActionText,
  teamText,
  voidReasonText,
  type SnapIndex,
} from "./b-helpers";
import { actorText, AdminLoading, TabHeader, useAdminIdentities, useAdminPost } from "./b-shared";

type ActionFilter = "" | CheckAction | "no_show";
type StatusFilter = "all" | "valid" | "voided";

interface Filters {
  slotId: string;
  stationId: string;
  teamId: string;
  action: ActionFilter;
  status: StatusFilter;
  order: "desc" | "asc";
}

const DEFAULT_FILTERS: Filters = { slotId: "", stationId: "", teamId: "", action: "", status: "all", order: "desc" };

const ACTION_FILTER_OPTIONS: ReadonlyArray<{ value: ActionFilter; label: string }> = [
  { value: "", label: "全部動作" },
  { value: "station_check_in", label: "關主確認進關" },
  { value: "station_check_out", label: "關主確認出關" },
  { value: "no_show", label: "本隊未到" },
  { value: "team_check_in", label: "隊輔確認進關" },
  { value: "team_check_out", label: "隊輔確認出關" },
];

interface RecordRow {
  r: CheckRecord;
  assignment: Assignment | null;
  slot: Slot | null;
  station: Station | null;
  teamLabel: string;
  actionText: string;
  /**
   * 有效的關主進關：實際開始計時的時間 = max(按下時間, 本時段有效預定開始)（第八節）。
   * 只是顯示用的推算值，不是另一筆紀錄；已撤銷或非進關紀錄為 null。
   */
  startedAt: number | null;
  /** startedAt − 本時段有效預定開始（正數代表較預定延後） */
  startDeltaMs: number | null;
  /** 本筆是修正紀錄時：被取代的原紀錄 */
  replaces: CheckRecord | null;
  /** 本筆已被修正時：取代它的新紀錄 */
  replacedBy: CheckRecord | null;
}

type DialogState =
  | { kind: "void"; record: CheckRecord }
  | { kind: "correct"; record: CheckRecord }
  | { kind: "force"; assignmentId: string }
  | { kind: "add" }
  | null;

function buildRows(records: CheckRecord[], ix: SnapIndex): RecordRow[] {
  return records.map((r) => {
    const assignment = ix.assignmentById.get(r.assignmentId) ?? null;
    const slot = assignment ? (ix.slotById.get(assignment.slotId) ?? null) : null;
    const startedAt =
      r.action === "station_check_in" && r.voidedAt === null && slot ? Math.max(r.recordedAt, slot.scheduledStart) : null;
    return {
      r,
      assignment,
      slot,
      station: assignment ? (ix.stationById.get(assignment.stationId) ?? null) : null,
      teamLabel: r.teamId ? teamText(ix, r.teamId) : assignmentTeamsText(ix, assignment),
      // 大地的關主進關就是「雙方到齊，開始」
      actionText: r.action === "station_check_in" && ix.isPk ? "關主：雙方到齊，開始" : recordActionText(r, ix.isPk),
      startedAt,
      startDeltaMs: startedAt !== null && slot ? startedAt - slot.scheduledStart : null,
      replaces: r.replacesRecordId ? (ix.recordById.get(r.replacesRecordId) ?? null) : null,
      replacedBy: ix.replacedBy.get(r.id) ?? null,
    };
  });
}

function matches(row: RecordRow, f: Filters): boolean {
  const { r, assignment } = row;
  if (f.slotId && assignment?.slotId !== f.slotId) return false;
  if (f.stationId && assignment?.stationId !== f.stationId) return false;
  if (f.teamId) {
    if (r.teamId !== null) {
      if (r.teamId !== f.teamId) return false;
    } else if (!assignment || (assignment.teamAId !== f.teamId && assignment.teamBId !== f.teamId)) {
      return false;
    }
  }
  if (f.action === "no_show") {
    if (!(r.action === "station_check_out" && r.noShow)) return false;
  } else if (f.action === "station_check_out") {
    if (r.action !== "station_check_out" || r.noShow) return false;
  } else if (f.action && r.action !== f.action) {
    return false;
  }
  if (f.status === "valid" && r.voidedAt !== null) return false;
  if (f.status === "voided" && r.voidedAt === null) return false;
  return true;
}

function remainingText(ad: AssignmentDerived): string {
  if (ad.untilStartMs !== null && ad.untilStartMs > 0) return `距開始 ${formatCountdown(ad.untilStartMs)}`;
  if (ad.remainingMs === null) return "";
  return ad.remainingMs >= 0 ? `剩 ${formatCountdown(ad.remainingMs)}` : `超時 +${formatCountdown(ad.remainingMs)}`;
}

export function RecordsTab({ gameCode, live }: AdminTabProps) {
  const snap = live.snapshot;
  const derived = live.derived;
  const ids = useAdminIdentities();
  const ix = React.useMemo(() => (snap ? buildSnapIndex(snap) : null), [snap]);

  const [filterState, setFilterState] = React.useState<{ game: GameCode; f: Filters }>({ game: gameCode, f: DEFAULT_FILTERS });
  const filters = filterState.game === gameCode ? filterState.f : DEFAULT_FILTERS;
  const setFilter = (patch: Partial<Filters>) => setFilterState({ game: gameCode, f: { ...filters, ...patch } });

  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [correctTime, setCorrectTime] = React.useState("");
  const [highlightId, setHighlightId] = React.useState<string | null>(null);
  const refetch = live.refetch;
  const post = useAdminPost(() => {
    void refetch();
  });

  const allRows = React.useMemo(() => (snap && ix ? buildRows(snap.records, ix) : []), [snap, ix]);
  const rows = React.useMemo(() => {
    const list = allRows.filter((row) => matches(row, filters));
    const dir = filters.order === "desc" ? -1 : 1;
    list.sort((a, b) => dir * (a.r.recordedAt - b.r.recordedAt || a.r.realCreatedAt - b.r.realCreatedAt));
    return list;
  }, [allRows, filters]);

  const inProgress = React.useMemo(() => {
    if (!derived) return [];
    return [...derived.assignments.values()]
      .filter((ad) => ad.state !== "CANCELLED" && ad.stationCheckIn !== null && ad.stationCheckOut === null)
      .sort((a, b) => a.slot.number - b.slot.number || a.station.sortOrder - b.station.sortOrder);
  }, [derived]);

  if (!snap || !derived || !ix) {
    return <AdminLoading error={live.status.error} />;
  }

  const validCount = allRows.filter((row) => row.r.voidedAt === null).length;
  const voidedCount = allRows.length - validCount;
  const labelOf = (id: string | null) => actorText(ids.labelById, id);

  const openDialog = (d: DialogState) => {
    post.setError(null);
    if (d?.kind === "correct") setCorrectTime(formatHms(d.record.recordedAt));
    setDialog(d);
  };
  const closeDialog = () => {
    if (post.pending) return;
    setDialog(null);
  };

  const jumpTo = (recordId: string) => {
    const target = snap.records.find((x) => x.id === recordId);
    if (!target) return;
    const row = allRows.find((x) => x.r.id === recordId);
    flushSync(() => {
      if (row && !matches(row, filters)) setFilterState({ game: gameCode, f: { ...filters, status: "all" } });
      setHighlightId(recordId);
    });
    const desktop = document.getElementById(`rec-${recordId}`);
    const mobile = document.getElementById(`rec-m-${recordId}`);
    const el = desktop && desktop.offsetParent !== null ? desktop : mobile;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ---- 送出 ----
  const doVoid = async (record: CheckRecord, reason: string) => {
    const res = await post.run<Extract<AdminRecordResponse, { ok: true }>>(
      "/api/admin/records/void",
      { recordId: record.id, reason },
      "已撤銷紀錄",
    );
    if (res) setDialog(null);
  };

  const doCorrect = async (record: CheckRecord, reason: string) => {
    const ms = hmsOnSameTaipeiDate(record.recordedAt, correctTime);
    if (ms === null) {
      post.setError("請輸入正確的時間（HH:mm:ss）。");
      return;
    }
    const now = live.getNow();
    if (ms > now) {
      post.setError(`修正後的時間不能晚於現在（${formatHms(now)}）。`);
      return;
    }
    if (Math.floor(ms / 1000) === Math.floor(record.recordedAt / 1000)) {
      post.setError("時間沒有改變。");
      return;
    }
    const res = await post.run<Extract<AdminRecordResponse, { ok: true }>>(
      "/api/admin/records/correct",
      { recordId: record.id, recordedAt: new Date(ms).toISOString(), reason },
      "已修正時間",
    );
    if (res) setDialog(null);
  };

  const doForceEnd = async (assignmentId: string, reason: string) => {
    const res = await post.run<Extract<AdminRecordResponse, { ok: true }>>(
      "/api/admin/force-end",
      { assignmentId, reason },
      "已強制結束",
    );
    if (res) setDialog(null);
  };

  const dialogRecordText = (record: CheckRecord) => {
    const a = ix.assignmentById.get(record.assignmentId);
    const who = record.teamId && a?.teamBId ? `${teamText(ix, record.teamId)} ` : "";
    return `${assignmentText(ix, a)}｜${who}${recordActionText(record, ix.isPk)} ${formatHms(record.recordedAt)}`;
  };

  const forceAd = dialog?.kind === "force" ? (derived.assignments.get(dialog.assignmentId) ?? null) : null;

  const teamOptions = snap.teams.map((t) => ({ value: t.id, label: teamText(ix, t.id) }));

  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        title="打卡紀錄"
        description={`共 ${allRows.length} 筆（有效 ${validCount}、已撤銷 ${voidedCount}）。時間為台北時間 HH:mm:ss。`}
        actions={
          <Button onClick={() => openDialog({ kind: "add" })}>
            <PlusCircle className="size-5" aria-hidden />
            補登紀錄
          </Button>
        }
      />
      <ErrorText message={ids.error ? `讀取操作者名稱失敗：${ids.error}` : null} />

      {/* 進行中的場次：強制結束 */}
      <section aria-labelledby="b-force-title" className="flex flex-col gap-3">
        <h3 id="b-force-title" className="text-xl font-bold text-slate-950">
          進行中的場次（可強制結束）
        </h3>
        {inProgress.length === 0 ? (
          <p className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4 text-base text-slate-700">目前沒有進行中的場次。</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inProgress.map((ad) => (
              <li key={ad.assignment.id} className="flex flex-col gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StationStateBadge state={ad.state} />
                  <span className="timer-digits text-lg font-black">{remainingText(ad)}</span>
                </div>
                <p className="text-lg font-bold">{assignmentText(ix, ad.assignment)}</p>
                <p className="text-base text-slate-700">
                  關主進關 {ad.stationCheckIn ? formatHms(ad.stationCheckIn.recordedAt) : "—"}
                </p>
                <Button variant="danger" onClick={() => openDialog({ kind: "force", assignmentId: ad.assignment.id })}>
                  <Square className="size-5" aria-hidden />
                  強制結束
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 篩選 */}
      <section aria-label="篩選" className="grid gap-3 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field label="時段" htmlFor="b-rec-slot">
          <Select
            id="b-rec-slot"
            value={filters.slotId}
            onChange={(e) => setFilter({ slotId: e.target.value })}
            options={[{ value: "", label: "全部時段" }, ...snap.slots.map((s) => ({ value: s.id, label: slotLabel(s.number) }))]}
          />
        </Field>
        <Field label="關卡" htmlFor="b-rec-station">
          <Select
            id="b-rec-station"
            value={filters.stationId}
            onChange={(e) => setFilter({ stationId: e.target.value })}
            options={[{ value: "", label: "全部關卡" }, ...snap.stations.map((s) => ({ value: s.id, label: s.name }))]}
          />
        </Field>
        <Field label="隊伍" htmlFor="b-rec-team">
          <Select
            id="b-rec-team"
            value={filters.teamId}
            onChange={(e) => setFilter({ teamId: e.target.value })}
            options={[{ value: "", label: "全部隊伍" }, ...teamOptions]}
          />
        </Field>
        <Field label="動作" htmlFor="b-rec-action">
          <Select
            id="b-rec-action"
            value={filters.action}
            onChange={(e) => setFilter({ action: e.target.value as ActionFilter })}
            options={ACTION_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Field>
        <Field label="狀態" htmlFor="b-rec-status">
          <Select
            id="b-rec-status"
            value={filters.status}
            onChange={(e) => setFilter({ status: e.target.value as StatusFilter })}
            options={[
              { value: "all", label: "全部（含已撤銷）" },
              { value: "valid", label: "只看有效" },
              { value: "voided", label: "只看已撤銷" },
            ]}
          />
        </Field>
        <Field label="排序" htmlFor="b-rec-order">
          <Select
            id="b-rec-order"
            value={filters.order}
            onChange={(e) => setFilter({ order: e.target.value as Filters["order"] })}
            options={[
              { value: "desc", label: "最新在上" },
              { value: "asc", label: "最早在上" },
            ]}
          />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6 flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-bold text-slate-800">符合條件：{rows.length} 筆</p>
          <Button variant="ghost" size="sm" onClick={() => setFilterState({ game: gameCode, f: DEFAULT_FILTERS })}>
            清除篩選
          </Button>
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="rounded-2xl border-2 border-slate-300 bg-white p-6 text-center text-lg font-bold text-slate-700">沒有符合條件的紀錄。</p>
      ) : (
        <>
          {/* 桌機：表格 */}
          <div className="hidden overflow-x-auto rounded-2xl border-2 border-slate-300 bg-white lg:block">
            <table className="w-full border-collapse text-left text-base">
              <thead className="bg-slate-100 text-sm font-bold text-slate-800">
                <tr>
                  <th className="px-3 py-3">時間</th>
                  <th className="px-3 py-3">時段</th>
                  <th className="px-3 py-3">關卡</th>
                  <th className="px-3 py-3">隊伍</th>
                  <th className="px-3 py-3">動作</th>
                  <th className="px-3 py-3">來源</th>
                  <th className="px-3 py-3">操作者</th>
                  <th className="px-3 py-3">原因／狀態</th>
                  <th className="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { r } = row;
                  const voided = r.voidedAt !== null;
                  return (
                    <tr
                      key={r.id}
                      id={`rec-${r.id}`}
                      className={cn(
                        "scroll-mt-24 border-t-2 border-slate-200 align-top",
                        voided && "bg-slate-50 text-slate-600",
                        highlightId === r.id && "outline outline-4 -outline-offset-4 outline-blue-500",
                      )}
                    >
                      <td className="px-3 py-3">
                        <span className={cn("timer-digits text-xl font-black", voided && "line-through")}>{formatHms(r.recordedAt)}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{row.slot ? slotLabel(row.slot.number) : "—"}</td>
                      <td className="px-3 py-3 font-bold">{row.station?.name ?? "—"}</td>
                      <td className="px-3 py-3">{row.teamLabel || "—"}</td>
                      <td className="px-3 py-3">
                        <ActionBadges row={row} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{SOURCE_LABEL[r.source]}</td>
                      <td className="px-3 py-3">{labelOf(r.identityId)}</td>
                      <td className="px-3 py-3">
                        <RecordNotes row={row} labelOf={labelOf} onJump={jumpTo} />
                      </td>
                      <td className="px-3 py-3">
                        {!voided && (
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: "correct", record: r })}>
                              修正時間
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => openDialog({ kind: "void", record: r })}>
                              撤銷
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 手機／平板：卡片 */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {rows.map((row) => {
              const { r } = row;
              const voided = r.voidedAt !== null;
              return (
                <li
                  key={r.id}
                  id={`rec-m-${r.id}`}
                  className={cn(
                    "scroll-mt-24 rounded-2xl border-2 p-4",
                    voided ? "border-slate-300 bg-slate-100 text-slate-700" : "border-slate-300 bg-white",
                    highlightId === r.id && "outline outline-4 outline-offset-2 outline-blue-500",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("timer-digits text-2xl font-black", voided && "line-through")}>{formatHms(r.recordedAt)}</span>
                    <ActionBadges row={row} />
                  </div>
                  <p className="mt-2 text-lg font-bold">
                    {[row.slot ? slotLabel(row.slot.number) : null, row.station?.name, row.teamLabel].filter(Boolean).join("・")}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
                    <dt className="font-bold text-slate-600">來源</dt>
                    <dd>{SOURCE_LABEL[r.source]}</dd>
                    <dt className="font-bold text-slate-600">操作者</dt>
                    <dd>{labelOf(r.identityId)}</dd>
                  </dl>
                  <RecordNotes row={row} labelOf={labelOf} onJump={jumpTo} className="mt-2" />
                  {!voided && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button variant="secondary" onClick={() => openDialog({ kind: "correct", record: r })}>
                        修正時間
                      </Button>
                      <Button variant="danger" onClick={() => openDialog({ kind: "void", record: r })}>
                        撤銷
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ---- 對話框 ---- */}
      <ConfirmDialog
        open={dialog?.kind === "void"}
        title="撤銷紀錄"
        description={dialog?.kind === "void" ? `確定撤銷【${dialogRecordText(dialog.record)}】？` : null}
        confirmLabel="確定撤銷"
        tone="danger"
        pending={post.pending}
        error={post.error}
        reason={{ label: "撤銷原因", required: true, placeholder: "例：關主按錯隊伍" }}
        onConfirm={({ reason }) => (dialog?.kind === "void" ? doVoid(dialog.record, reason) : undefined)}
        onCancel={closeDialog}
      >
        <ul className="list-disc space-y-1 pl-6 text-base text-slate-700">
          <li>紀錄不會刪除，只會標示「已撤銷」，狀態依剩餘的有效紀錄重算。</li>
          <li>已出關的場次要先撤銷出關，才能撤銷進關。</li>
          <li>下一隊已進關時，要先撤銷下一隊的進關，才能撤銷本場出關。</li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "correct"}
        title="修正時間"
        description={dialog?.kind === "correct" ? dialogRecordText(dialog.record) : null}
        confirmLabel="確定修正"
        tone="primary"
        pending={post.pending}
        error={post.error}
        reason={{ label: "修正原因", required: true, placeholder: "例：關主晚按 2 分鐘，依現場計時修正" }}
        onConfirm={({ reason }) => (dialog?.kind === "correct" ? doCorrect(dialog.record, reason) : undefined)}
        onCancel={closeDialog}
      >
        <Field label="新的時間（HH:mm:ss，台北時間）" htmlFor="b-correct-time" required hint="原紀錄會標示為已撤銷，另外新增一筆「管理員修正」紀錄；出關不能早於進關。">
          <Input
            id="b-correct-time"
            type="time"
            step={1}
            value={correctTime}
            onChange={(e) => setCorrectTime(e.target.value)}
            className="timer-digits text-2xl"
            disabled={post.pending}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "force"}
        title="強制結束"
        description={forceAd ? `確定強制結束【${assignmentText(ix, forceAd.assignment)}】？` : null}
        confirmLabel="確定強制結束"
        tone="danger"
        pending={post.pending}
        error={post.error}
        reason={{ label: "原因", required: true, placeholder: "例：關主手機沒電，由總召結束" }}
        onConfirm={({ reason }) => (dialog?.kind === "force" ? doForceEnd(dialog.assignmentId, reason) : undefined)}
        onCancel={closeDialog}
      >
        {forceAd && (
          <p className="text-base text-slate-700">
            以現在時間新增一筆關主出關（來源：強制結束）。目前 {remainingText(forceAd) || "計時中"}。
          </p>
        )}
      </ConfirmDialog>

      <AddRecordDialog
        open={dialog?.kind === "add"}
        onClose={closeDialog}
        snapshot={snap}
        derived={derived}
        ix={ix}
        getNow={live.getNow}
        post={post}
      />
    </div>
  );
}

function ActionBadges({ row }: { row: RecordRow }) {
  const { r } = row;
  const voided = r.voidedAt !== null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={r.noShow ? "noshow" : isStationAction(r.action) ? "blue" : "purple"} size="sm">
        {row.actionText}
      </Badge>
      {r.singleTeamOverride && (
        <Badge tone="orange" size="sm">
          單隊開始
        </Badge>
      )}
      {voided ? (
        <Badge tone="red" size="sm" solid>
          已撤銷
        </Badge>
      ) : (
        <Badge tone="green" size="sm">
          有效
        </Badge>
      )}
    </span>
  );
}

function RecordNotes({
  row,
  labelOf,
  onJump,
  className,
}: {
  row: RecordRow;
  labelOf: (id: string | null) => string;
  onJump: (recordId: string) => void;
  className?: string;
}) {
  const { r, replaces, replacedBy } = row;
  const hasAny = r.reason || r.voidedAt !== null || replaces || replacedBy || row.startedAt !== null;
  if (!hasAny) return <span className={cn("text-slate-500", className)}>—</span>;
  return (
    <div className={cn("flex flex-col gap-1 text-base", className)}>
      {row.startedAt !== null && (
        <p>
          <span className="font-bold text-slate-600">關卡開始：</span>
          <span className="timer-digits font-bold">{formatHms(row.startedAt)}</span>
          {row.startDeltaMs !== null && row.startDeltaMs > 0 && (
            <span className="text-slate-700">（較預定 {formatSignedDuration(row.startDeltaMs)}）</span>
          )}
          {r.recordedAt < row.startedAt && <span className="text-slate-700">（提早進關，從預定時間起算）</span>}
        </p>
      )}
      {r.reason && (
        <p>
          <span className="font-bold text-slate-600">原因：</span>
          {r.reason}
        </p>
      )}
      {r.voidedAt !== null && (
        <p className="font-bold text-red-700">
          已撤銷：{formatHms(r.voidedAt)} 由 {labelOf(r.voidedBy)} 撤銷
          {r.voidReason ? `（${voidReasonText(r.voidReason)}）` : ""}
        </p>
      )}
      {replaces && (
        <button type="button" onClick={() => onJump(replaces.id)} className="inline-flex items-center gap-1 text-left font-bold text-blue-800 underline underline-offset-2">
          <Link2 className="size-4 shrink-0" aria-hidden />
          修正自原紀錄 {formatHms(replaces.recordedAt)}
        </button>
      )}
      {replacedBy && (
        <button type="button" onClick={() => onJump(replacedBy.id)} className="inline-flex items-center gap-1 text-left font-bold text-blue-800 underline underline-offset-2">
          <Link2 className="size-4 shrink-0" aria-hidden />
          已修正為 {formatHms(replacedBy.recordedAt)}
        </button>
      )}
    </div>
  );
}
