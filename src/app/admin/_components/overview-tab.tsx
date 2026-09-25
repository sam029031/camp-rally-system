"use client";
/**
 * 總覽設定分頁（第二十五、二十四、二十二、八節）：
 * - 活動資訊；修改活動日期與撤銷提醒的群組名稱／活動長稱呼（POST /api/admin/event-settings）
 * - 每個遊戲的 end_policy 與 min_play_seconds（POST /api/admin/game-settings）
 * - 唯讀：遊戲、時段（原定 vs 有效）、關卡（含 Excel 原始名稱）、隊伍、原始排程矩陣
 */
import * as React from "react";
import { CalendarDays, Save, Settings2 } from "lucide-react";
import type { AdminEventSettingsRequest, AdminGameSettingsRequest, AdminSimpleResponse } from "@/lib/api/contract";
import { GAME_NAMES } from "@/lib/constants";
import { getIndex, teamIdsOf } from "@/lib/derive";
import { CANCELLED_CLASS, slotLabel, teamName } from "@/lib/labels";
import { formatDurationText, formatHmRange, formatSignedDuration } from "@/lib/time";
import type { EndPolicy, GameCode, GameSnapshot } from "@/lib/types";
import { useSchedulePeek } from "@/lib/client/use-live-game";
import { cn } from "@/lib/client/cn";
import { pushToast } from "@/lib/client/toast-store";
import { useAdminRequest } from "@/components/admin-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Collapsible, Section, TableScroll, tdClass, thClass, type ReadyTabProps } from "@/app/admin/_components/a-shared";

const END_POLICY_TEXT: Record<EndPolicy, { title: string; body: string }> = {
  FULL_DURATION: {
    title: "玩滿完整時間（FULL_DURATION）",
    body: "結束時間 = 開始計時 + 關卡時間。晚開始就晚結束，一定玩滿完整時間。（黃金預設）",
  },
  FIXED_END: {
    title: "固定結束時間（FIXED_END）",
    body: "結束時間 = 開始計時 + 關卡時間，但不超過該時段的預定結束。因等人而晚開始時壓縮遊戲時間，結束時間不往後拖。（大地預設）",
  },
};

export function OverviewTab(props: ReadyTabProps) {
  const { snapshot, live } = props;
  const onDone = () => void live.refetch();
  const ev = snapshot.event;
  const game = snapshot.game;

  return (
    <div className="flex flex-col gap-4">
      <EventSettingsForm
        key={`${ev.id}|${ev.eventDate}|${ev.teamGroupLabel}|${ev.stationGroupLabel}|${ev.leadTitle}`}
        snapshot={snapshot}
        onDone={onDone}
      />
      <GameSettingsForm key={`${game.id}|${game.endPolicy}|${game.minPlayMs}`} snapshot={snapshot} onDone={onDone} />
      <GamesList snapshot={snapshot} />
      <SlotsList snapshot={snapshot} />
      <StationsList snapshot={snapshot} />
      <TeamsList snapshot={snapshot} />
      <ScheduleMatrix snapshot={snapshot} />
    </div>
  );
}

// =====================================================================
// 活動設定
// =====================================================================

function EventSettingsForm({ snapshot, onDone }: { snapshot: GameSnapshot; onDone: () => void }) {
  const ev = snapshot.event;
  const [eventDate, setEventDate] = React.useState(ev.eventDate);
  const [teamGroupLabel, setTeamGroupLabel] = React.useState(ev.teamGroupLabel);
  const [stationGroupLabel, setStationGroupLabel] = React.useState(ev.stationGroupLabel);
  const [leadTitle, setLeadTitle] = React.useState(ev.leadTitle);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const req = useAdminRequest<AdminSimpleResponse>();
  const ids = { date: React.useId(), team: React.useId(), station: React.useId(), lead: React.useId() };

  const body: AdminEventSettingsRequest = {};
  if (eventDate && eventDate !== ev.eventDate) body.eventDate = eventDate;
  if (teamGroupLabel.trim() !== ev.teamGroupLabel) body.teamGroupLabel = teamGroupLabel.trim();
  if (stationGroupLabel.trim() !== ev.stationGroupLabel) body.stationGroupLabel = stationGroupLabel.trim();
  if (leadTitle.trim() !== ev.leadTitle) body.leadTitle = leadTitle.trim();
  const changed = Object.keys(body).length > 0;

  let invalid: string | null = null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) invalid = "請選擇活動日期。";
  else if (!teamGroupLabel.trim() || !stationGroupLabel.trim() || !leadTitle.trim()) invalid = "群組名稱與活動長稱呼不可空白。";

  const submit = async () => {
    const r = await req.run("/api/admin/event-settings", body);
    if (!r) return;
    setConfirmOpen(false);
    pushToast({ tone: "success", title: "已儲存活動設定" });
    onDone();
  };

  return (
    <Section
      title="活動設定"
      description="活動日期決定所有時段的實際日期；群組名稱與稱呼用在「撤銷提醒」訊息（第二十二節）。"
      aside={<CalendarDays className="size-8 text-slate-500" aria-hidden />}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
        <dt className="font-bold text-slate-600">活動名稱</dt>
        <dd className="font-black text-slate-950">{ev.name}</dd>
        <dt className="font-bold text-slate-600">活動日期</dt>
        <dd className="font-black text-slate-950">{ev.eventDate}</dd>
        <dt className="font-bold text-slate-600">時區</dt>
        <dd className="font-bold text-slate-900">{ev.timezone}</dd>
        <dt className="font-bold text-slate-600">狀態</dt>
        <dd>
          <Badge tone={ev.isActive ? "green" : "gray"} size="sm">
            {ev.isActive ? "使用中的活動" : "未啟用"}
          </Badge>
        </dd>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="活動日期" htmlFor={ids.date} required hint="改日期會把兩個遊戲的所有時段一起移到新日期。">
          <Input id={ids.date} type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} disabled={req.pending} />
        </Field>
        <Field label="隊輔群名稱" htmlFor={ids.team} required hint="隊輔誤按撤銷時：「請立即到【隊輔群】…」">
          <Input id={ids.team} value={teamGroupLabel} maxLength={40} onChange={(e) => setTeamGroupLabel(e.target.value)} disabled={req.pending} />
        </Field>
        <Field label="活動組群名稱" htmlFor={ids.station} required hint="關主誤按撤銷時：「請立即到【活動組群】…」">
          <Input
            id={ids.station}
            value={stationGroupLabel}
            maxLength={40}
            onChange={(e) => setStationGroupLabel(e.target.value)}
            disabled={req.pending}
          />
        </Field>
        <Field label="活動長稱呼" htmlFor={ids.lead} required hint="撤銷提醒：「…tag【活動長】說明自己按錯」">
          <Input id={ids.lead} value={leadTitle} maxLength={40} onChange={(e) => setLeadTitle(e.target.value)} disabled={req.pending} />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="lg"
          className="sm:self-start"
          disabled={!changed || !!invalid || req.pending}
          loading={req.pending && !confirmOpen}
          loadingText="儲存中…"
          onClick={() => {
            req.reset();
            if (body.eventDate) setConfirmOpen(true);
            else void submit();
          }}
        >
          <Save className="size-6" aria-hidden />
          儲存活動設定
        </Button>
        <ErrorText message={invalid && changed ? invalid : !confirmOpen ? req.error : null} />
        {!changed && <p className="text-base font-bold text-slate-600">修改上面的欄位後即可儲存。</p>}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="修改活動日期"
        description={`活動日期由 ${ev.eventDate} 改為 ${eventDate}？`}
        confirmLabel="確定修改日期"
        tone="warning"
        pending={req.pending}
        error={req.error}
        onConfirm={submit}
        onCancel={() => {
          setConfirmOpen(false);
          req.reset();
        }}
      >
        <p className="rounded-xl border-2 border-orange-400 bg-orange-50 p-3 text-base font-bold text-orange-950">
          所有時段（黃金與大地）都會移到新日期，已打卡的紀錄時間不變。彩排結束、正式活動前請確認日期正確。Demo 時鐘不會自動跟著移動。
        </p>
      </ConfirmDialog>
    </Section>
  );
}

// =====================================================================
// 遊戲設定（end_policy / min_play_seconds）
// =====================================================================

function minutesText(ms: number): string {
  return formatDurationText(ms);
}

function GameSettingsForm({ snapshot, onDone }: { snapshot: GameSnapshot; onDone: () => void }) {
  const game = snapshot.game;
  const [policy, setPolicy] = React.useState<EndPolicy>(game.endPolicy);
  const [minPlay, setMinPlay] = React.useState<string>(String(Math.round((game.minPlayMs / 60_000) * 100) / 100));
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const req = useAdminRequest<AdminSimpleResponse>();
  const minId = React.useId();

  const minutes = Number(minPlay);
  const minValid = minPlay.trim() !== "" && Number.isFinite(minutes) && minutes >= 0 && minutes <= 60;
  const minPlaySeconds = minValid ? Math.round(minutes * 60) : null;
  const changed = policy !== game.endPolicy || (minPlaySeconds !== null && minPlaySeconds * 1000 !== game.minPlayMs);

  const submit = async () => {
    if (minPlaySeconds === null) return;
    const body: AdminGameSettingsRequest = { gameId: game.id, endPolicy: policy, minPlaySeconds };
    const r = await req.run("/api/admin/game-settings", body);
    if (!r) return;
    setConfirmOpen(false);
    pushToast({ tone: "success", title: `已儲存 ${game.name} 的結束規則` });
    onDone();
  };

  return (
    <Section
      title={`${game.name}：結束規則`}
      description="每個遊戲分開設定；要改另一個遊戲，請用上方的遊戲切換。改動會立即影響進行中場次的正式結束時間。"
      aside={<Settings2 className="size-8 text-slate-500" aria-hidden />}
    >
      <div role="radiogroup" aria-label="結束規則" className="grid gap-3 md:grid-cols-2">
        {(["FULL_DURATION", "FIXED_END"] as const).map((p) => {
          const active = p === policy;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={req.pending}
              onClick={() => setPolicy(p)}
              className={cn(
                "flex min-h-24 flex-col items-start gap-1 rounded-xl border-2 p-4 text-left",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                active ? "border-blue-800 bg-blue-50 ring-2 ring-blue-700" : "border-slate-400 bg-white",
              )}
            >
              <span className="flex items-center gap-2 text-lg font-black text-slate-950">
                <span
                  className={cn("inline-block size-5 shrink-0 rounded-full border-2", active ? "border-blue-800 bg-blue-700" : "border-slate-500")}
                  aria-hidden
                />
                {END_POLICY_TEXT[p].title}
                {p === game.endPolicy && (
                  <Badge tone="gray" size="sm">
                    目前
                  </Badge>
                )}
              </span>
              <span className="text-base font-bold text-slate-700">{END_POLICY_TEXT[p].body}</span>
            </button>
          );
        })}
      </div>

      <Field
        label="最低可玩時間（分鐘）"
        htmlFor={minId}
        required
        error={!minValid ? "請輸入 0～60 之間的分鐘數。" : undefined}
        hint={`目前 ${minutesText(game.minPlayMs)}。FIXED_END 壓縮後可玩時間少於這個值時，關主按開始會先確認「本場只剩 MM:SS」，開始後通知總召可一鍵延長。`}
      >
        <Input
          id={minId}
          type="number"
          inputMode="decimal"
          min={0}
          max={60}
          step={0.5}
          value={minPlay}
          onChange={(e) => setMinPlay(e.target.value)}
          disabled={req.pending}
          className="max-w-48 text-2xl font-black"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="lg"
          className="sm:self-start"
          disabled={!changed || !minValid || req.pending}
          onClick={() => {
            req.reset();
            setConfirmOpen(true);
          }}
        >
          <Save className="size-6" aria-hidden />
          儲存 {game.name} 設定
        </Button>
        <ErrorText message={!confirmOpen ? req.error : null} />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`修改 ${game.name} 結束規則`}
        description={
          <>
            <p>結束規則：{END_POLICY_TEXT[policy].title}</p>
            <p>最低可玩時間：{minPlaySeconds !== null ? minutesText(minPlaySeconds * 1000) : "—"}</p>
          </>
        }
        confirmLabel="確定修改"
        tone="warning"
        pending={req.pending}
        error={req.error}
        onConfirm={submit}
        onCancel={() => {
          setConfirmOpen(false);
          req.reset();
        }}
      >
        <p className="rounded-xl border-2 border-orange-400 bg-orange-50 p-3 text-base font-bold text-orange-950">
          進行中的場次會立即依新規則重新計算正式結束時間（已設定延長的場次不受影響）。
        </p>
      </ConfirmDialog>
    </Section>
  );
}

// =====================================================================
// 唯讀清單
// =====================================================================

function GameRow({ code, snap, current }: { code: GameCode; snap: GameSnapshot | null; current: boolean }) {
  if (!snap) {
    return (
      <tr>
        <td className={tdClass}>{GAME_NAMES[code]}</td>
        <td className={tdClass} colSpan={6}>
          <span className="text-slate-600">讀取中…</span>
        </td>
      </tr>
    );
  }
  const g = snap.game;
  const first = snap.slots[0];
  const last = snap.slots[snap.slots.length - 1];
  return (
    <tr className={current ? "bg-blue-50" : undefined}>
      <td className={cn(tdClass, "font-black whitespace-nowrap")}>
        {g.name}
        {current && (
          <Badge tone="blue" size="sm" className="ml-2">
            目前
          </Badge>
        )}
      </td>
      <td className={cn(tdClass, "timer-digits whitespace-nowrap")}>{first && last ? formatHmRange(first.scheduledStart, last.scheduledEnd) : "—"}</td>
      <td className={tdClass}>
        {snap.slots.length} 時段・{snap.stations.length} 關・{snap.teams.length} 隊
      </td>
      <td className={cn(tdClass, "whitespace-nowrap")}>{minutesText(g.stationDurationMs)}</td>
      <td className={cn(tdClass, "whitespace-nowrap")}>{minutesText(g.transitionDurationMs)}</td>
      <td className={cn(tdClass, "whitespace-nowrap")}>{g.teamsPerStation === 2 ? "2 隊 PK" : "1 隊"}</td>
      <td className={cn(tdClass, "whitespace-nowrap")}>
        {g.endPolicy === "FULL_DURATION" ? "玩滿完整時間" : "固定結束時間"}・最低 {minutesText(g.minPlayMs)}
      </td>
    </tr>
  );
}

function GamesList({ snapshot }: { snapshot: GameSnapshot }) {
  const current = snapshot.game.code;
  const other: GameCode = current === "gold" ? "land" : "gold";
  const peek = useSchedulePeek(other);
  const rows: Array<{ code: GameCode; snap: GameSnapshot | null }> = [
    { code: current, snap: snapshot },
    { code: other, snap: peek.snapshot },
  ].sort((a, b) => (a.code === "gold" ? 0 : 1) - (b.code === "gold" ? 0 : 1));

  return (
    <Collapsible title="遊戲" summary="2 個遊戲" defaultOpen>
      <TableScroll>
        <table className="w-full min-w-[48rem] border-collapse">
          <thead>
            <tr>
              <th className={thClass}>遊戲</th>
              <th className={thClass}>時間</th>
              <th className={thClass}>規模</th>
              <th className={thClass}>關卡時間</th>
              <th className={thClass}>跑關時間</th>
              <th className={thClass}>每關隊數</th>
              <th className={thClass}>結束規則</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <GameRow key={r.code} code={r.code} snap={r.snap} current={r.code === current} />
            ))}
          </tbody>
        </table>
      </TableScroll>
      {peek.error && <ErrorText message={`${GAME_NAMES[other]}：${peek.error}`} className="mt-2" />}
    </Collapsible>
  );
}

function SlotsList({ snapshot }: { snapshot: GameSnapshot }) {
  const adjusted = snapshot.slots.some((s) => s.totalOffsetMs !== 0);
  return (
    <Collapsible title={`時段（${snapshot.game.name}）`} summary={adjusted ? "有調整" : `${snapshot.slots.length} 個`}>
      <TableScroll>
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr>
              <th className={thClass}>時段</th>
              <th className={thClass}>有效時間</th>
              <th className={thClass}>原定時間</th>
              <th className={thClass}>調整</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.slots.map((s) => {
              const moved = s.totalOffsetMs !== 0;
              return (
                <tr key={s.id} className={moved ? "bg-orange-50" : undefined}>
                  <td className={cn(tdClass, "font-black whitespace-nowrap")}>{slotLabel(s.number)}</td>
                  <td className={cn(tdClass, "timer-digits font-black whitespace-nowrap")}>{formatHmRange(s.scheduledStart, s.scheduledEnd)}</td>
                  <td className={cn(tdClass, "timer-digits whitespace-nowrap", moved ? "text-slate-600" : "text-slate-500")}>
                    {formatHmRange(s.originalStart, s.originalEnd)}
                  </td>
                  <td className={cn(tdClass, "whitespace-nowrap font-bold", moved ? "text-orange-800" : "text-slate-500")}>
                    {moved ? `${s.totalOffsetMs > 0 ? "延後" : "提前"} ${formatDurationText(s.totalOffsetMs)}（${formatSignedDuration(s.totalOffsetMs)}）` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Collapsible>
  );
}

function StationsList({ snapshot }: { snapshot: GameSnapshot }) {
  const idx = getIndex(snapshot);
  return (
    <Collapsible title={`關卡（${snapshot.game.name}）`} summary={`${snapshot.stations.length} 關`}>
      <TableScroll>
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr>
              <th className={thClass}>代碼</th>
              <th className={thClass}>關卡名稱</th>
              <th className={thClass}>Excel 原始名稱</th>
              <th className={thClass}>場次</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.stations.map((st) => {
              const list = idx.byStation.get(st.id) ?? [];
              const cancelled = list.filter((a) => idx.cancellation.has(a.id)).length;
              return (
                <tr key={st.id}>
                  <td className={cn(tdClass, "font-black")}>{st.code}</td>
                  <td className={cn(tdClass, "font-bold")}>{st.name}</td>
                  <td className={cn(tdClass, st.sourceName !== st.name ? "text-orange-900" : "text-slate-600")}>{st.sourceName}</td>
                  <td className={cn(tdClass, "whitespace-nowrap")}>
                    {list.length} 場{cancelled > 0 && <span className="ml-1 font-bold text-slate-600">（已取消 {cancelled}）</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Collapsible>
  );
}

function TeamsList({ snapshot }: { snapshot: GameSnapshot }) {
  const idx = getIndex(snapshot);
  return (
    <Collapsible title={`隊伍（${snapshot.game.name}）`} summary={`${snapshot.teams.length} 隊`}>
      <TableScroll>
        <table className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr>
              <th className={thClass}>隊伍</th>
              <th className={thClass}>場次</th>
              <th className={thClass}>路線（依時段）</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.teams.map((t) => {
              const list = idx.byTeam.get(t.id) ?? [];
              return (
                <tr key={t.id}>
                  <td className={cn(tdClass, "font-black whitespace-nowrap")}>{teamName(t)}</td>
                  <td className={cn(tdClass, "whitespace-nowrap")}>{list.length} 場</td>
                  <td className={tdClass}>
                    <span className="flex flex-wrap gap-x-1 gap-y-1">
                      {list.map((a, i) => {
                        const st = idx.stationById.get(a.stationId);
                        const slot = idx.slotById.get(a.slotId);
                        const cancelled = idx.cancellation.has(a.id);
                        return (
                          <span key={a.id} className="whitespace-nowrap">
                            {i > 0 && <span className="mx-1 text-slate-400">→</span>}
                            <span className={cn("font-bold", cancelled && "text-slate-500 line-through")} title={slot ? slotLabel(slot.number) : undefined}>
                              {st ? `${st.code} ${st.name}` : "?"}
                            </span>
                          </span>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Collapsible>
  );
}

function ScheduleMatrix({ snapshot }: { snapshot: GameSnapshot }) {
  const idx = getIndex(snapshot);
  const pk = snapshot.game.teamsPerStation === 2;
  return (
    <Collapsible title={`原始排程（${snapshot.game.name}）`} summary="時段 × 關卡">
      <p className="mb-3 text-base font-bold text-slate-700">
        每格是該時段在該關卡的隊伍；「休息」代表該關本時段沒有安排。被取消的場次以刪除線標示。時間為目前有效時間。
      </p>
      <TableScroll>
        <table className="border-collapse text-base">
          <thead>
            <tr>
              <th className={cn(thClass, "sticky left-0 z-10")}>時段</th>
              {snapshot.stations.map((st) => (
                <th key={st.id} className={cn(thClass, "min-w-28 text-center")}>
                  <span className="block text-lg">{st.code}</span>
                  <span className="block text-sm font-bold text-slate-700">{st.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.slots.map((slot) => (
              <tr key={slot.id}>
                <th scope="row" className={cn(tdClass, "sticky left-0 z-10 bg-white text-left font-black whitespace-nowrap")}>
                  <span className="block">{slotLabel(slot.number)}</span>
                  <span className="timer-digits block text-sm font-bold text-slate-600">{formatHmRange(slot.scheduledStart, slot.scheduledEnd)}</span>
                </th>
                {snapshot.stations.map((st) => {
                  const a = idx.assignmentBySlotStation.get(`${slot.id}|${st.id}`);
                  if (!a) {
                    return (
                      <td key={st.id} className={cn(tdClass, "bg-slate-100 text-center font-bold text-slate-500")}>
                        休息
                      </td>
                    );
                  }
                  const cancelled = idx.cancellation.has(a.id);
                  const names = teamIdsOf(a)
                    .map((id) => {
                      const t = idx.teamById.get(id);
                      return t ? teamName(t, { short: pk }) : "?";
                    })
                    .join(pk ? " vs " : "、");
                  return (
                    <td key={st.id} className={cn(tdClass, "text-center font-bold whitespace-nowrap", cancelled && CANCELLED_CLASS)}>
                      <span className={cn(cancelled && "line-through")}>{names}</span>
                      {cancelled && <span className="block text-sm">已取消</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Collapsible>
  );
}
