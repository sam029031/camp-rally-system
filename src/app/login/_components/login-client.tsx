"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  Flag,
  Loader2,
  LogIn,
  LogOut,
  RotateCw,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { LoginOption, LoginOptionsResponse, LoginResponse } from "@/lib/api/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorText } from "@/components/error-text";
import { getApi, postApi } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { logout, refreshSession } from "@/lib/client/use-session";
import { vibrate } from "@/lib/client/vibrate";
import { PIN_LENGTH } from "@/lib/constants";
import type { ErrorCode } from "@/lib/errors";
import { ROLE_LABEL } from "@/lib/labels";
import type { GameCode, Role } from "@/lib/types";
import { PinPad } from "./pin-pad";
import {
  optionsForRole,
  parseRetrySeconds,
  previousStep,
  ROLE_DESCRIPTION,
  ROLE_ORDER,
  selectionSummary,
  stationGames,
  stationsForGame,
  stepAfterRole,
  stepTitle,
  teamOptionName,
  type LoginStep,
} from "./login-options";

export interface CurrentSessionSummary {
  label: string;
  role: Role;
  homePath: string;
}

export interface LoginClientProps {
  /** server 端讀到的目前登入身分（未登入為 null） */
  currentSession: CurrentSessionSummary | null;
  /** `?identity=<id>`（PIN 總表 QR code） */
  identityParam: string | null;
}

type OptionsState =
  | { status: "loading" }
  | { status: "ready"; options: LoginOption[] }
  | { status: "error"; message: string };

interface LoginError {
  code: ErrorCode;
  message: string;
}

const ROLE_ICON: Record<Role, LucideIcon> = {
  STATION: Flag,
  TEAM: Users,
  ADMIN: ShieldCheck,
  VIEWER: Eye,
};

async function fetchOptions(): Promise<OptionsState> {
  const res = await getApi<LoginOptionsResponse>("/api/auth/options");
  if (res.ok) return { status: "ready", options: res.options };
  return { status: "error", message: res.message };
}

/** 真實時間（登入鎖定倒數用；不是活動的 app 時鐘） */
function realNowMs(): number {
  return Date.now();
}

export function LoginClient({ currentSession, identityParam }: LoginClientProps) {
  const router = useRouter();

  const [optionsState, setOptionsState] = useState<OptionsState>({ status: "loading" });
  const [step, setStep] = useState<LoginStep>("role");
  const [role, setRole] = useState<Role | null>(null);
  const [game, setGame] = useState<GameCode | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  const [paramNotice, setParamNotice] = useState<string | null>(null);
  // 已登入時先顯示「目前登入」；帶 ?identity= 或按「以其他身分登入」才顯示選單
  const [showFlow, setShowFlow] = useState<boolean>(!currentSession || !!identityParam);
  const [loggingOut, setLoggingOut] = useState(false);

  const preselectDone = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const applyOptions = useCallback(
    (next: OptionsState) => {
      setOptionsState(next);
      if (next.status !== "ready" || preselectDone.current) return;
      preselectDone.current = true;
      if (!identityParam) return;
      const target = next.options.find((o) => o.identityId === identityParam);
      if (!target) {
        setParamNotice("找不到 QR code 指定的身分（可能已停用或已更換），請手動選擇。");
        return;
      }
      setRole(target.role);
      setGame(target.role === "STATION" ? target.gameCode : null);
      setIdentityId(target.identityId);
      setStep("pin");
    },
    [identityParam],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchOptions().then((r) => {
      if (!cancelled) applyOptions(r);
    });
    return () => {
      cancelled = true;
    };
  }, [applyOptions]);

  // 登入鎖定倒數（真實時間）
  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((lockedUntil - realNowMs()) / 1000));
      setLockRemaining(left);
      if (left <= 0) {
        setLockedUntil(null);
        setError((e) => (e?.code === "LOGIN_LOCKED" ? null : e));
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const options = useMemo(() => (optionsState.status === "ready" ? optionsState.options : []), [optionsState]);
  const selected = useMemo(
    () => (identityId ? options.find((o) => o.identityId === identityId) ?? null : null),
    [options, identityId],
  );
  const games = useMemo(() => stationGames(options), [options]);
  const locked = lockedUntil !== null;

  const scrollTop = () => {
    try {
      topRef.current?.scrollIntoView({ block: "start" });
    } catch {
      // 忽略
    }
  };

  const goTo = (next: LoginStep) => {
    setStep(next);
    setPin("");
    setError((e) => (e?.code === "LOGIN_LOCKED" ? e : null));
    scrollTop();
  };

  const chooseRole = (r: Role) => {
    setParamNotice(null);
    const next = stepAfterRole(options, r);
    setRole(r);
    setGame(next.game);
    setIdentityId(next.identityId);
    goTo(next.step);
  };

  const chooseGame = (g: GameCode) => {
    setGame(g);
    goTo("station");
  };

  const chooseIdentity = (id: string) => {
    setIdentityId(id);
    goTo("pin");
  };

  const goBack = () => {
    const prev = previousStep(options, step, role);
    if (prev === "role") {
      setRole(null);
      setGame(null);
      setIdentityId(null);
    } else if (prev === "game") {
      setIdentityId(null);
    } else if (step === "pin") {
      // 回到清單時保留遊戲，但重新選身分
      setIdentityId(null);
    }
    goTo(prev);
  };

  const retryOptions = () => {
    setOptionsState({ status: "loading" });
    void fetchOptions().then(applyOptions);
  };

  const submit = async (value: string) => {
    if (!identityId || pending || redirecting || locked || value.length !== PIN_LENGTH) return;
    setPending(true);
    setError(null);
    const res = await postApi<LoginResponse>("/api/auth/login", { identityId, pin: value }, { retry: false });
    if (res.ok) {
      setRedirecting(true);
      setPending(false);
      vibrate(30);
      void refreshSession();
      router.replace(res.redirectTo);
      return;
    }
    setPending(false);
    setError({ code: res.code, message: res.message });
    if (res.code === "LOGIN_LOCKED") {
      const secs = parseRetrySeconds(res.message);
      setLockedUntil(realNowMs() + secs * 1000);
      setLockRemaining(secs);
      setPin("");
    } else if (res.code === "NETWORK_ERROR" || res.code === "INTERNAL_ERROR") {
      // 沒拿到結果：保留 PIN，讓使用者按「重新送出」
    } else {
      setPin("");
      vibrate([60, 60, 60]);
    }
  };

  const onPinChange = (next: string) => {
    if (pending || redirecting || locked) return;
    setPin(next);
    if (error && error.code !== "LOGIN_LOCKED" && next.length > 0) setError(null);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const doLogout = async () => {
    setLoggingOut(true);
    await logout("/login");
  };

  const { index: stepIndex, title } = stepTitle(step, role);
  const lockMessage = locked ? `錯誤次數太多，請 ${lockRemaining} 秒後再試。` : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div ref={topRef} className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-700 text-white">
          <Flag className="size-7" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black leading-tight text-slate-900">宿營跑關</h1>
          <p className="text-base font-bold text-slate-600">登入</p>
        </div>
      </div>

      {currentSession ? (
        <section
          className={cn(
            "flex flex-col gap-3 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-4",
            showFlow && "gap-2 p-3",
          )}
          aria-label="目前登入"
        >
          <p className="text-lg font-bold text-emerald-900">
            目前登入：<span className="text-xl font-black">{currentSession.label}</span>
            {currentSession.label !== ROLE_LABEL[currentSession.role] ? (
              <span className="ml-1 text-base font-bold text-emerald-800">（{ROLE_LABEL[currentSession.role]}）</span>
            ) : null}
          </p>
          {showFlow ? (
            <div className="flex flex-wrap gap-2">
              <Link href={currentSession.homePath} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                前往我的頁面
              </Link>
              <Button variant="secondary" size="sm" loading={loggingOut} loadingText="登出中…" onClick={doLogout}>
                <LogOut className="size-5" aria-hidden />
                登出
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Link href={currentSession.homePath} className={buttonVariants({ variant: "success", size: "xl", block: true })}>
                前往我的頁面
                <ChevronRight className="size-7" aria-hidden />
              </Link>
              <Button variant="secondary" size="md" block loading={loggingOut} loadingText="登出中…" onClick={doLogout}>
                <LogOut className="size-6" aria-hidden />
                登出
              </Button>
              <Button variant="ghost" size="md" block onClick={() => setShowFlow(true)}>
                以其他身分登入
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {showFlow ? (
        <section className="flex flex-col gap-4" aria-labelledby="login-step-title">
          <div className="flex items-center gap-3">
            {step !== "role" ? (
              <Button
                variant="secondary"
                size="icon"
                className="size-14 shrink-0"
                onClick={goBack}
                disabled={pending || redirecting}
                aria-label="上一步"
              >
                <ArrowLeft className="size-7" aria-hidden />
              </Button>
            ) : null}
            <div className="min-w-0">
              <p className="text-base font-bold text-blue-800">步驟 {stepIndex}／3</p>
              <h2 id="login-step-title" className="text-2xl font-black leading-tight text-slate-900">
                {title}
              </h2>
            </div>
          </div>

          {optionsState.status === "loading" ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border-2 border-slate-300 bg-white p-8 text-lg font-bold text-slate-700">
              <Loader2 className="size-7 animate-spin text-blue-700" aria-hidden />
              讀取身分清單中…
            </div>
          ) : optionsState.status === "error" ? (
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-red-300 bg-white p-4">
              <Button variant="primary" size="lg" block onClick={retryOptions}>
                <RotateCw className="size-6" aria-hidden />
                重新讀取
              </Button>
              <ErrorText message={optionsState.message} />
            </div>
          ) : (
            <>
              {step === "role" ? (
                <div className="flex flex-col gap-3">
                  <ErrorText message={paramNotice} />
                  {ROLE_ORDER.map((r) => {
                    const Icon = ROLE_ICON[r];
                    const count = optionsForRole(options, r).length;
                    return (
                      <button
                        key={r}
                        type="button"
                        disabled={count === 0}
                        onClick={() => chooseRole(r)}
                        className={cn(
                          "flex min-h-20 w-full items-center gap-4 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-left",
                          "touch-manipulation transition-[background-color,transform] hover:border-blue-600 hover:bg-blue-50 active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                          "disabled:pointer-events-none disabled:opacity-45",
                        )}
                      >
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-800">
                          <Icon className="size-8" aria-hidden />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-2xl font-black text-slate-900">{ROLE_LABEL[r]}</span>
                          <span className="text-base text-slate-700">
                            {count === 0 ? "目前沒有這類身分" : ROLE_DESCRIPTION[r]}
                          </span>
                        </span>
                        <ChevronRight className="size-7 shrink-0 text-slate-500" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {step === "game" ? (
                <div className="flex flex-col gap-3">
                  {games.map((g) => (
                    <button
                      key={g.code}
                      type="button"
                      onClick={() => chooseGame(g.code)}
                      className={cn(
                        "flex min-h-20 w-full items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left",
                        "touch-manipulation transition-[background-color,transform] active:scale-[0.99]",
                        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                        g.code === "gold"
                          ? "border-amber-500 bg-amber-50 hover:bg-amber-100"
                          : "border-emerald-600 bg-emerald-50 hover:bg-emerald-100",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-2xl font-black text-slate-900">{g.name}</span>
                        <span className="text-base text-slate-700">{g.stationCount} 個關卡</span>
                      </span>
                      <ChevronRight className="size-7 shrink-0 text-slate-600" aria-hidden />
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "station" && game ? (
                <div className="flex flex-col gap-3">
                  <p className="text-lg font-bold text-slate-700">
                    {games.find((g) => g.code === game)?.name ?? ""}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {stationsForGame(options, game).map((o) => (
                      <button
                        key={o.identityId}
                        type="button"
                        onClick={() => chooseIdentity(o.identityId)}
                        className={cn(
                          "flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-3 py-2 text-left",
                          "touch-manipulation transition-[background-color,transform] hover:border-blue-600 hover:bg-blue-50 active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                        )}
                      >
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-2xl font-black text-white">
                          {o.stationCode}
                        </span>
                        <span className="min-w-0 flex-1 text-xl font-bold leading-snug text-slate-900 [overflow-wrap:anywhere]">
                          {o.stationName ?? o.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {step === "team" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-base text-slate-700">同一組 PIN 在黃金傳奇、大地遊戲都能用。</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {optionsForRole(options, "TEAM").map((o) => (
                      <button
                        key={o.identityId}
                        type="button"
                        onClick={() => chooseIdentity(o.identityId)}
                        className={cn(
                          "flex min-h-16 w-full items-center justify-center rounded-2xl border-2 border-slate-300 bg-white px-2 py-2 text-center",
                          "text-xl font-black text-slate-900",
                          "touch-manipulation transition-[background-color,transform] hover:border-blue-600 hover:bg-blue-50 active:scale-[0.99]",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                        )}
                      >
                        {teamOptionName(o)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {step === "identity" && role ? (
                <div className="flex flex-col gap-3">
                  {optionsForRole(options, role).map((o) => (
                    <button
                      key={o.identityId}
                      type="button"
                      onClick={() => chooseIdentity(o.identityId)}
                      className={cn(
                        "flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-4 py-2 text-left",
                        "text-xl font-black text-slate-900",
                        "touch-manipulation transition-[background-color,transform] hover:border-blue-600 hover:bg-blue-50 active:scale-[0.99]",
                        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
                      )}
                    >
                      <span className="min-w-0 flex-1">{o.label}</span>
                      <ChevronRight className="size-7 shrink-0 text-slate-500" aria-hidden />
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "pin" && selected ? (
                <PinStep
                  selectedSummary={selectionSummary(selected)}
                  pin={pin}
                  onPinChange={onPinChange}
                  reveal={reveal}
                  onToggleReveal={() => setReveal((v) => !v)}
                  pending={pending}
                  redirecting={redirecting}
                  locked={locked}
                  errorMessage={lockMessage ?? error?.message ?? null}
                  canResubmit={
                    !!error && (error.code === "NETWORK_ERROR" || error.code === "INTERNAL_ERROR") && pin.length === PIN_LENGTH
                  }
                  onResubmit={() => void submit(pin)}
                />
              ) : null}

              {step === "pin" && !selected ? (
                <div className="flex flex-col gap-3">
                  <ErrorText message="找不到這個身分，請重新選擇。" />
                  <Button variant="primary" size="lg" block onClick={() => goTo("role")}>
                    重新選擇身分
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}

interface PinStepProps {
  selectedSummary: ReturnType<typeof selectionSummary>;
  pin: string;
  onPinChange: (next: string) => void;
  reveal: boolean;
  onToggleReveal: () => void;
  pending: boolean;
  redirecting: boolean;
  locked: boolean;
  errorMessage: string | null;
  canResubmit: boolean;
  onResubmit: () => void;
}

function PinStep({
  selectedSummary,
  pin,
  onPinChange,
  reveal,
  onToggleReveal,
  pending,
  redirecting,
  locked,
  errorMessage,
  canResubmit,
  onResubmit,
}: PinStepProps) {
  const busy = pending || redirecting;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border-2 border-blue-600 bg-blue-50 px-4 py-3">
        <p className="text-base font-bold text-blue-800">
          {selectedSummary.roleLabel}
          {selectedSummary.subtitle ? `｜${selectedSummary.subtitle}` : ""}
        </p>
        <p className="text-2xl font-black leading-snug text-slate-900 [overflow-wrap:anywhere]">{selectedSummary.title}</p>
      </div>

      <PinPad
        value={pin}
        onChange={onPinChange}
        disabled={busy || locked}
        reveal={reveal}
        onToggleReveal={onToggleReveal}
        invalid={!!errorMessage && !busy}
        status={
          <div aria-live="polite" className="flex min-h-8 flex-col gap-3">
            {busy ? (
              <p className="flex items-center gap-2 text-lg font-bold text-blue-800">
                <Loader2 className="size-6 animate-spin" aria-hidden />
                {redirecting ? "登入成功，前往你的頁面…" : "登入中…"}
              </p>
            ) : null}
            {canResubmit && !busy ? (
              <Button variant="primary" size="lg" block onClick={onResubmit}>
                <LogIn className="size-6" aria-hidden />
                重新送出
              </Button>
            ) : null}
            {!busy ? <ErrorText message={errorMessage} /> : null}
            {!busy && !errorMessage ? (
              <p className="text-base text-slate-600">輸入滿 6 位數會自動登入。忘記 PIN 請找總召。</p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
