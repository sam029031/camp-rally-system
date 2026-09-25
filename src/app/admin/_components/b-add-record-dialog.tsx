"use client";

/**
 * [admin-b] 補登（第二十二節「補登（原本忘了按）：只新增一筆 admin_correction」）。
 * 選時段＋關卡 → 場次，選動作（關主／隊輔 進關／出關、本隊未到），隊輔側再選隊伍，指定 HH:mm:ss（Asia/Taipei），原因必填。
 * 送出前有確認步驟；server 錯誤訊息顯示在確認按鈕下方；不自動重試。
 */

import * as React from "react";
import type { AdminAddRecordRequest, AdminRecordResponse } from "@/lib/api/contract";
import type { DerivedGame } from "@/lib/derive/types";
import { slotLabel } from "@/lib/labels";
import { formatHm, formatHms, formatHmRange } from "@/lib/time";
import type { CheckAction, CheckRecord, GameSnapshot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorText } from "@/components/error-text";
import { StationStateBadge } from "@/components/state-badges";
import {
  assignmentTeamsText,
  assignmentText,
  hmsOnSameTaipeiDate,
  isStationAction,
  recordActionText,
  teamText,
  type SnapIndex,
} from "./b-helpers";
import type { AdminPostState } from "./b-shared";

type ActionKey = CheckAction | "no_show";

const ACTION_KEYS: readonly ActionKey[] = ["station_check_in", "station_check_out", "no_show", "team_check_in", "team_check_out"];

function actionKeyLabel(k: ActionKey, isPk: boolean): string {
  switch (k) {
    case "station_check_in":
      return "關主確認進關";
    case "station_check_out":
      return "關主確認出關";
    case "no_show":
      return isPk ? "本場未進行（關主出關・未到）" : "本隊未到（關主出關・未到）";
    case "team_check_in":
      return "隊輔確認進關";
    case "team_check_out":
      return "隊輔確認出關";
  }
}

export interface AddRecordDialogProps {
  open: boolean;
  onClose: () => void;
  snapshot: GameSnapshot;
  derived: DerivedGame;
  ix: SnapIndex;
  /** 事件處理用的 app 時間 */
  getNow: () => number;
  post: AdminPostState;
}

export function AddRecordDialog(props: AddRecordDialogProps) {
  const { open, onClose, post } = props;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!post.pending}
      title="補登紀錄"
      description="原本忘了按的打卡，由總召指定時間補上（來源標示為管理員修正）。"
      size="lg"
    >
      <AddRecordForm {...props} />
    </Dialog>
  );
}

function AddRecordForm({ onClose, snapshot, derived, ix, getNow, post }: AddRecordDialogProps) {
  const isPk = ix.isPk;
  const [slotId, setSlotId] = React.useState<string>(() => derived.current.slot.id);
  const [stationId, setStationId] = React.useState("");
  const [actionKey, setActionKey] = React.useState<ActionKey | "">("");
  const [teamId, setTeamId] = React.useState("");
  const [time, setTime] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [formError, setFormError] = React.useState<string | null>(null);

  const slot = ix.slotById.get(slotId) ?? null;
  const assignment = slot && stationId ? (ix.assignmentBySlotStation.get(`${slot.id}|${stationId}`) ?? null) : null;
  const ad = assignment ? (derived.assignments.get(assignment.id) ?? null) : null;
  const teamIds = assignment ? [assignment.teamAId, ...(assignment.teamBId ? [assignment.teamBId] : [])] : [];
  const teamSide = actionKey === "team_check_in" || actionKey === "team_check_out";
  const effectiveTeamId = teamSide ? (teamIds.length === 1 ? teamIds[0] : teamId) : "";

  const validRecords: CheckRecord[] = assignment
    ? snapshot.records
        .filter((r) => r.assignmentId === assignment.id && r.voidedAt === null)
        .sort((a, b) => a.recordedAt - b.recordedAt)
    : [];

  const existing: CheckRecord | null = (() => {
    if (!actionKey) return null;
    const action: CheckAction = actionKey === "no_show" ? "station_check_out" : actionKey;
    const tid = isStationAction(action) ? null : effectiveTeamId || null;
    if (!isStationAction(action) && !tid) return null;
    return validRecords.find((r) => r.action === action && r.teamId === tid) ?? null;
  })();

  const changeSlot = (v: string) => {
    setSlotId(v);
    setTeamId("");
    setFormError(null);
  };
  const changeStation = (v: string) => {
    setStationId(v);
    setTeamId("");
    setFormError(null);
  };

  const validate = (): { body: AdminAddRecordRequest } | { error: string } => {
    if (!slot) return { error: "請選擇時段。" };
    if (!stationId) return { error: "請選擇關卡。" };
    if (!assignment) return { error: "這個時段該關卡休息，沒有場次可以補登。" };
    if (!actionKey) return { error: "請選擇動作。" };
    if (teamSide && !effectiveTeamId) return { error: "請選擇隊伍。" };
    if (existing) return { error: `已有一筆有效紀錄（${formatHms(existing.recordedAt)}），請改用「修正時間」。` };
    const ms = hmsOnSameTaipeiDate(slot.scheduledStart, time);
    if (ms === null) return { error: "請輸入正確的時間（HH:mm:ss）。" };
    const now = getNow();
    if (ms > now) return { error: `補登時間不能晚於現在（${formatHms(now)}）。` };
    if (!reason.trim()) return { error: "請填寫原因。" };
    return {
      body: {
        assignmentId: assignment.id,
        action: actionKey === "no_show" ? "station_check_out" : actionKey,
        teamId: teamSide ? effectiveTeamId : null,
        recordedAt: new Date(ms).toISOString(),
        noShow: actionKey === "no_show",
        reason: reason.trim(),
      },
    };
  };

  const goConfirm = () => {
    const v = validate();
    if ("error" in v) {
      setFormError(v.error);
      return;
    }
    setFormError(null);
    post.setError(null);
    setStep("confirm");
  };

  const submit = async () => {
    const v = validate();
    if ("error" in v) {
      setFormError(v.error);
      setStep("form");
      return;
    }
    const res = await post.run<Extract<AdminRecordResponse, { ok: true }>>("/api/admin/records/add", v.body, "已補登紀錄");
    if (res) onClose();
  };

  const setTimeFrom = (ms: number) => {
    setTime(formatHms(ms));
    setFormError(null);
  };

  if (step === "confirm") {
    const summaryTime = time ? (hmsOnSameTaipeiDate(slot?.scheduledStart ?? 0, time) ?? null) : null;
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl border-2 border-blue-600 bg-blue-50 p-4">
          <p className="text-lg font-bold text-blue-950">確認補登以下紀錄：</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg">
            <dt className="font-bold text-slate-700">場次</dt>
            <dd className="font-bold text-slate-950">{assignmentText(ix, assignment)}</dd>
            <dt className="font-bold text-slate-700">動作</dt>
            <dd className="font-bold text-slate-950">
              {teamSide && effectiveTeamId ? `${teamText(ix, effectiveTeamId)} ` : ""}
              {actionKey ? actionKeyLabel(actionKey, isPk) : ""}
            </dd>
            <dt className="font-bold text-slate-700">時間</dt>
            <dd className="timer-digits text-2xl font-black text-slate-950">{summaryTime !== null ? formatHms(summaryTime) : "—"}</dd>
            <dt className="font-bold text-slate-700">原因</dt>
            <dd className="whitespace-pre-wrap text-slate-950">{reason.trim()}</dd>
          </dl>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <div className="flex flex-col gap-2 sm:flex-1">
            <Button size="xl" block onClick={() => void submit()} loading={post.pending} loadingText="送出中…">
              確認補登
            </Button>
            <ErrorText message={post.error} />
          </div>
          <Button variant="secondary" size="lg" className="sm:flex-1" onClick={() => setStep("form")} disabled={post.pending}>
            返回修改
          </Button>
        </div>
      </div>
    );
  }

  const ids = {
    slot: "b-add-slot",
    station: "b-add-station",
    action: "b-add-action",
    team: "b-add-team",
    time: "b-add-time",
    reason: "b-add-reason",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="時段" htmlFor={ids.slot} required>
          <Select
            id={ids.slot}
            value={slotId}
            onChange={(e) => changeSlot(e.target.value)}
            options={snapshot.slots.map((s) => ({
              value: s.id,
              label: `${slotLabel(s.number)} ${formatHmRange(s.scheduledStart, s.scheduledEnd)}`,
            }))}
          />
        </Field>
        <Field label="關卡" htmlFor={ids.station} required>
          <Select
            id={ids.station}
            value={stationId}
            onChange={(e) => changeStation(e.target.value)}
            placeholder="選擇關卡"
            options={snapshot.stations.map((st) => {
              const a = slot ? ix.assignmentBySlotStation.get(`${slot.id}|${st.id}`) : undefined;
              return {
                value: st.id,
                label: a ? `${st.name}（${assignmentTeamsText(ix, a)}）` : `${st.name}（本時段休息）`,
                disabled: !a,
              };
            })}
          />
        </Field>
      </div>

      {ad && (
        <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{assignmentText(ix, assignment)}</span>
            <StationStateBadge state={ad.state} noShow={ad.noShow} size="sm" />
          </div>
          {ad.state === "CANCELLED" && <p className="mt-1 text-base font-bold text-red-700">本場已取消，不能補登（請先撤銷取消）。</p>}
          <p className="mt-2 text-sm font-bold text-slate-700">本場目前的有效紀錄：</p>
          {validRecords.length === 0 ? (
            <p className="text-base text-slate-700">（沒有任何紀錄）</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5 text-base">
              {validRecords.map((r) => (
                <li key={r.id}>
                  <span className="timer-digits font-bold">{formatHms(r.recordedAt)}</span>{" "}
                  {r.teamId && assignment?.teamBId ? `${teamText(ix, r.teamId)} ` : ""}
                  {recordActionText(r, isPk)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="動作" htmlFor={ids.action} required>
          <Select
            id={ids.action}
            value={actionKey}
            onChange={(e) => {
              setActionKey(e.target.value as ActionKey);
              setFormError(null);
            }}
            placeholder="選擇動作"
            options={ACTION_KEYS.map((k) => ({ value: k, label: actionKeyLabel(k, isPk) }))}
          />
        </Field>
        {teamSide && (
          <Field label="隊伍" htmlFor={ids.team} required>
            <Select
              id={ids.team}
              value={effectiveTeamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder={assignment ? "選擇隊伍" : "請先選關卡"}
              disabled={!assignment}
              options={teamIds.map((id) => ({ value: id, label: teamText(ix, id) }))}
            />
          </Field>
        )}
      </div>

      {existing && (
        <ErrorText message={`這個動作已有一筆有效紀錄（${formatHms(existing.recordedAt)}），請改用「修正時間」。`} />
      )}

      <Field label="時間（HH:mm:ss，台北時間）" htmlFor={ids.time} required>
        <Input
          id={ids.time}
          type="time"
          step={1}
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            setFormError(null);
          }}
          className="timer-digits text-2xl"
        />
      </Field>
      {slot && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTimeFrom(slot.scheduledStart)}>
            時段開始 {formatHm(slot.scheduledStart)}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setTimeFrom(slot.scheduledEnd)}>
            時段結束 {formatHm(slot.scheduledEnd)}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setTimeFrom(getNow())}>
            現在
          </Button>
        </div>
      )}

      <Field label="原因" htmlFor={ids.reason} required>
        <Textarea
          id={ids.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例：關主忘了按進關，依現場確認補上"
          maxLength={200}
          rows={2}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <Button size="lg" block onClick={goConfirm}>
          下一步：確認內容
        </Button>
        <ErrorText message={formError} />
      </div>
    </div>
  );
}
