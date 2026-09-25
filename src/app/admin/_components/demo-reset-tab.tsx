"use client";
/**
 * Demo 與 Reset 分頁（第三十一、二十五節）：
 * - Demo 面板：開關、倍速 1／5／10／20、把 app 時間跳到指定時刻（09:08、13:03、自訂 HH:mm）→ POST /api/admin/clock
 * - Reset Demo Data：選黃金／大地／全部，輸入確認字 RESET → POST /api/admin/reset
 * APP_ENV 不是 development / demo 時，server 拒絕開啟 Demo 與 Reset（關閉 Demo 一律允許）；這裡同步顯示原因、停用按鈕。
 */
import * as React from "react";
import { Clock3, FlaskConical, RotateCcw, ShieldAlert, TriangleAlert } from "lucide-react";
import type { AdminClockRequest, AdminResetRequest, AdminSimpleResponse } from "@/lib/api/contract";
import { GAME_NAMES, SIM_SPEEDS } from "@/lib/constants";
import { errorMessage } from "@/lib/errors";
import { formatHms, msToTaipeiDate } from "@/lib/time";
import type { GameCode } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { pushToast } from "@/lib/client/toast-store";
import { useAdminRequest } from "@/components/admin-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Section, type ReadyTabProps } from "@/app/admin/_components/a-shared";

export interface DemoResetTabProps extends ReadyTabProps {
  /** APP_ENV 是否允許開啟 Demo 與 Reset（server 仍會再檢查） */
  demoAllowed: boolean;
  appEnv: string;
}

const QUICK_JUMPS = ["09:08", "13:03"] as const;
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function speedText(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : speed.toFixed(1);
}

export function DemoResetTab(props: DemoResetTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {!props.demoAllowed && (
        <div role="note" className="flex items-start gap-3 rounded-2xl border-2 border-red-600 bg-red-50 p-4 text-red-950">
          <ShieldAlert className="mt-0.5 size-7 shrink-0" aria-hidden />
          <div>
            <p className="text-lg font-black">正式環境（APP_ENV = {props.appEnv || "未設定"}）</p>
            <p className="text-base font-bold">不允許開啟 Demo 模式與 Reset Demo Data；關閉 Demo 一律允許。server 端也會拒絕。</p>
          </div>
        </div>
      )}
      <DemoPanel {...props} />
      <ResetPanel {...props} />
    </div>
  );
}

// =====================================================================
// Demo 面板
// =====================================================================

type ClockAction = "toggle" | "speed" | "jump";

function DemoPanel({ snapshot, live, demoAllowed, appEnv }: DemoResetTabProps) {
  const clock = snapshot.event.clock;
  const enabled = clock.simEnabled;
  const [speedChoice, setSpeedChoice] = React.useState<number>(() =>
    (SIM_SPEEDS as readonly number[]).includes(clock.simSpeed) && clock.simSpeed > 1 ? clock.simSpeed : 10,
  );
  const [customJump, setCustomJump] = React.useState("");
  const [jumpTarget, setJumpTarget] = React.useState<string | null>(null);
  const [lastAction, setLastAction] = React.useState<ClockAction | null>(null);
  const req = useAdminRequest<AdminSimpleResponse>();
  const jumpId = React.useId();

  const currentSpeed = enabled ? clock.simSpeed : speedChoice;

  const send = async (action: ClockAction, body: AdminClockRequest, success: string): Promise<boolean> => {
    setLastAction(action);
    const r = await req.run("/api/admin/clock", body);
    if (!r) return false;
    pushToast({ tone: "success", title: success });
    void live.refetch();
    return true;
  };

  const toggle = (next: boolean) => {
    if (next && !demoAllowed) return;
    void send(
      "toggle",
      { enabled: next, speed: next ? speedChoice : clock.simSpeed, jumpTo: null },
      next ? `已開啟 Demo 模式 ×${speedText(speedChoice)}` : "已關閉 Demo 模式，回到真實時間",
    );
  };

  const chooseSpeed = (speed: number) => {
    setSpeedChoice(speed);
    if (!enabled || speed === clock.simSpeed) return;
    void send("speed", { enabled: true, speed, jumpTo: null }, `倍速改為 ×${speedText(speed)}`);
  };

  const confirmJump = async () => {
    if (!jumpTarget) return;
    const ok = await send("jump", { enabled: true, speed: currentSpeed, jumpTo: jumpTarget }, `模擬時間已跳到 ${jumpTarget}`);
    if (ok) {
      setJumpTarget(null);
      setCustomJump("");
    }
  };

  const openJump = (t: string) => {
    req.reset();
    setLastAction(null);
    setJumpTarget(t);
  };

  const customValid = HHMM_RE.test(customJump.trim());
  const busy = req.pending;

  return (
    <Section
      title="Demo 模式（彩排用）"
      description="開啟後 app 時間 = 模擬時間，所有裝置經 Realtime 立即跟上，頂端顯示「DEMO 模式 ×N」。改倍速或開關時時間不會跳動。現場撤銷 60 秒、登入鎖等操作時限仍用真實時間。"
      aside={<FlaskConical className="size-8 text-fuchsia-700" aria-hidden />}
      tone={enabled ? "warning" : "default"}
    >
      <div className="flex flex-col gap-1 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4">
        <span className="text-base font-bold text-slate-600">目前 app 時間（{live.now > 0 ? msToTaipeiDate(live.now) : "—"}）</span>
        <span className="timer-digits text-5xl font-black leading-tight text-slate-950">{live.now > 0 ? formatHms(live.now) : "--:--:--"}</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {enabled ? (
            <Badge tone="purple" solid size="md">
              DEMO 模式 ×{speedText(clock.simSpeed)}
            </Badge>
          ) : (
            <Badge tone="green" size="md">
              正式時間（真實時間）
            </Badge>
          )}
          <span className="text-sm font-bold text-slate-600">
            活動日 {snapshot.event.eventDate}・APP_ENV = {appEnv || "未設定"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={busy || (!enabled && !demoAllowed)}
          label={enabled ? "Demo 模式：開啟" : "Demo 模式：關閉"}
          description={
            !enabled && !demoAllowed ? errorMessage("DEMO_NOT_ALLOWED") : enabled ? "關閉後回到真實時間" : `開啟後以 ×${speedText(speedChoice)} 倍速從現在的時間開始`
          }
        />
        {lastAction === "toggle" && <ErrorText message={req.error} />}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-lg font-black text-slate-950">倍速（1 真實分鐘 = N 模擬分鐘）</p>
        <div role="radiogroup" aria-label="倍速" className="grid grid-cols-4 gap-2">
          {SIM_SPEEDS.map((s) => {
            const active = s === currentSpeed;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy || (!enabled && !demoAllowed)}
                onClick={() => chooseSpeed(s)}
                className={cn(
                  "flex h-16 items-center justify-center rounded-xl border-2 text-2xl font-black",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60 disabled:opacity-45",
                  active ? "border-fuchsia-800 bg-fuchsia-700 text-white" : "border-slate-400 bg-white text-slate-950",
                )}
              >
                ×{s}
              </button>
            );
          })}
        </div>
        {!enabled && <p className="text-base font-bold text-slate-600">Demo 關閉中：選好的倍速會在開啟時套用。</p>}
        {lastAction === "speed" && <ErrorText message={req.error} />}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-lg font-black text-slate-950">把模擬時間跳到（活動日 {snapshot.event.eventDate}）</p>
        <div className="grid grid-cols-2 gap-3">
          {QUICK_JUMPS.map((t) => (
            <Button key={t} variant="secondary" size="lg" disabled={busy || !demoAllowed} onClick={() => openJump(t)}>
              <Clock3 className="size-6" aria-hidden />
              <span className="timer-digits">{t}</span>
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="自訂時間（HH:mm）" htmlFor={jumpId} className="sm:w-56">
            <Input
              id={jumpId}
              type="time"
              step={60}
              value={customJump}
              onChange={(e) => setCustomJump(e.target.value.slice(0, 5))}
              disabled={busy || !demoAllowed}
              className="text-2xl font-black"
            />
          </Field>
          <Button variant="secondary" size="md" disabled={busy || !demoAllowed || !customValid} onClick={() => openJump(customJump.trim())}>
            跳到這個時間
          </Button>
        </div>
        {!enabled && demoAllowed && <p className="text-base font-bold text-slate-600">跳時間會同時開啟 Demo 模式（×{speedText(speedChoice)}）。</p>}
        {lastAction === "jump" && jumpTarget === null && <ErrorText message={req.error} />}
        {lastAction === "jump" && jumpTarget === null && req.errorCode === "CLOCK_JUMP_BEFORE_RECORDS" && (
          <p className="text-base font-bold text-slate-700">請到下方「Reset Demo Data」清除打卡紀錄後再跳時間。</p>
        )}
      </div>

      <ConfirmDialog
        open={jumpTarget !== null}
        title="跳到指定時刻"
        description={`把 app 時間跳到 ${snapshot.event.eventDate} ${jumpTarget ?? ""}？`}
        confirmLabel={`跳到 ${jumpTarget ?? ""}`}
        tone="warning"
        pending={busy && lastAction === "jump"}
        error={lastAction === "jump" ? req.error : null}
        onConfirm={confirmJump}
        onCancel={() => setJumpTarget(null)}
      >
        <ul className="flex flex-col gap-1 rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-base font-bold text-slate-800">
          <li>・所有裝置的時間、倒數與狀態立即跟上（倍速 ×{speedText(currentSpeed)}）。</li>
          <li>・要跳到的時刻早於現有打卡紀錄時會被拒絕，請先執行 Reset Demo Data。</li>
        </ul>
      </ConfirmDialog>
    </Section>
  );
}

// =====================================================================
// Reset Demo Data
// =====================================================================

type ResetTarget = GameCode | "all";

const RESET_LABEL: Record<ResetTarget, string> = {
  gold: GAME_NAMES.gold,
  land: GAME_NAMES.land,
  all: "全部（黃金＋大地）",
};

function ResetPanel({ gameCode, live, demoAllowed }: DemoResetTabProps) {
  const [target, setTarget] = React.useState<ResetTarget>(gameCode);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const req = useAdminRequest<AdminSimpleResponse>();

  const submit = async () => {
    const body: AdminResetRequest = { gameCode: target, confirmText: "RESET" };
    const r = await req.run("/api/admin/reset", body);
    if (!r) return;
    setConfirmOpen(false);
    pushToast({ tone: "success", title: `已清除 ${RESET_LABEL[target]} 的執行期資料` });
    void live.refetch();
  };

  return (
    <Section
      title="Reset Demo Data"
      description="清除打卡紀錄、通知、排程調整、取消與延長；不清排程與 PIN；audit log 保留並新增一筆 Reset 紀錄。Demo 時鐘不會關閉。"
      aside={<RotateCcw className="size-8 text-red-700" aria-hidden />}
      tone="danger"
    >
      <div role="radiogroup" aria-label="要清除的遊戲" className="grid gap-2 sm:grid-cols-3">
        {(["gold", "land", "all"] as const).map((t) => {
          const active = t === target;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={req.pending || !demoAllowed}
              onClick={() => setTarget(t)}
              className={cn(
                "flex h-16 items-center justify-center rounded-xl border-2 px-3 text-lg font-black",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60 disabled:opacity-45",
                active ? "border-red-800 bg-red-600 text-white" : "border-slate-400 bg-white text-slate-950",
              )}
            >
              {RESET_LABEL[t]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="danger"
          size="lg"
          className="sm:self-start"
          disabled={req.pending || !demoAllowed}
          onClick={() => {
            req.reset();
            setConfirmOpen(true);
          }}
        >
          <TriangleAlert className="size-6" aria-hidden />
          Reset Demo Data（{RESET_LABEL[target]}）
        </Button>
        <ErrorText message={!demoAllowed ? errorMessage("RESET_NOT_ALLOWED") : !confirmOpen ? req.error : null} />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Reset Demo Data"
        description={`確定清除「${RESET_LABEL[target]}」的所有打卡紀錄與執行期資料？此動作不能復原。`}
        confirmLabel="確定 Reset"
        tone="danger"
        pending={req.pending}
        error={req.error}
        typedConfirmation={{ text: "RESET", label: "請輸入 RESET 確認" }}
        onConfirm={submit}
        onCancel={() => {
          setConfirmOpen(false);
          req.reset();
        }}
      >
        <ul className="flex flex-col gap-1 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-base font-bold text-red-950">
          <li>・清除：打卡紀錄、通知、排程調整、關卡取消、延長時間</li>
          <li>・保留：排程、關卡、隊伍、PIN、audit log</li>
          <li>・所有裝置立即更新；正式活動中請勿使用</li>
        </ul>
      </ConfirmDialog>
    </Section>
  );
}
