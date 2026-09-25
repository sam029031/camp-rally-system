"use client";

/**
 * [admin-b] PIN 總表（第二十、二十五節）。
 *
 * - DB 只存 bcrypt hash，不存明碼：總表列出每個身分（角色、遊戲、關卡／隊伍、label、啟用）與登入網址的 QR code（不含 PIN）。
 * - 「重設此 PIN」（隨機新 PIN）、「修改 PIN」（指定 6 位數字）、「重設全部 PIN」（二次確認＋輸入確認字）。
 *   改 PIN 後該身分所有裝置都要重新登入（pin_version + 1）；總召改到自己的 PIN 時 server 會換發 cookie，這台仍保持登入。
 * - 新 PIN 只顯示在重設後的結果畫面，可以直接列印（每個身分一張可裁切的卡片：label + QR + 新 PIN）；離開頁面就看不到了。
 * - 初次匯入的完整 PIN 清單以 import 產生的本機 CSV 為準。
 */

import * as React from "react";
import { flushSync } from "react-dom";
import { KeyRound, Printer, QrCode, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { AdminIdentity, AdminResetPinsResponse } from "@/lib/api/contract";
import { GAME_NAMES, PIN_LENGTH } from "@/lib/constants";
import { ROLE_LABEL } from "@/lib/labels";
import { formatHms, msToTaipeiDate } from "@/lib/time";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import type { AdminTabProps } from "./types";
import { AdminLoading, PrintPortal, TabHeader, useAdminIdentities, useAdminPost, useQrDataUrls } from "./b-shared";

type RoleFilter = "all" | Role;

const ROLE_ORDER: readonly Role[] = ["ADMIN", "STATION", "TEAM", "VIEWER"];

const ROLE_TONE: Record<Role, "red" | "blue" | "purple" | "gray"> = {
  ADMIN: "red",
  STATION: "blue",
  TEAM: "purple",
  VIEWER: "gray",
};

const PIN_RE = new RegExp(`^\\d{${PIN_LENGTH}}$`);
/** 重設全部要輸入的確認字 */
const RESET_ALL_CONFIRM = "PIN";
/** 重設全部：server 逐一 bcrypt，給足時間，避免 server 已完成但前端逾時而看不到新 PIN */
const RESET_ALL_TIMEOUT_MS = 90_000;

type NewPin = Extract<AdminResetPinsResponse, { ok: true }>["pins"][number];

interface ResetResult {
  /** 最近一次重設的 app 時間 */
  at: number;
  /** 最新的在前 */
  pins: NewPin[];
}

type DialogState = { kind: "reset-one"; identity: AdminIdentity } | { kind: "set-pin"; identity: AdminIdentity } | { kind: "reset-all" } | { kind: "qr"; identity: AdminIdentity } | null;

function gameText(i: Pick<AdminIdentity, "role" | "gameCode">): string {
  if (i.role === "TEAM") return "黃金／大地共用";
  if (i.gameCode) return GAME_NAMES[i.gameCode];
  return "—";
}

function targetText(i: Pick<AdminIdentity, "role" | "stationName" | "stationCode" | "teamName" | "teamCode">): string {
  if (i.role === "STATION") return i.stationName ?? i.stationCode ?? "—";
  if (i.role === "TEAM") return i.teamName ?? (i.teamCode ? `第${i.teamCode}小隊` : "—");
  return "—";
}

/** 列印卡片上的小字：「關主・黃金傳奇・九九乘法」 */
function identitySubText(i: AdminIdentity): string {
  return [ROLE_LABEL[i.role], gameText(i), targetText(i)].filter((x) => x && x !== "—").join("・");
}

export function PinsTab({ live, session }: AdminTabProps) {
  const ids = useAdminIdentities();
  const identities = React.useMemo(() => ids.identities ?? [], [ids.identities]);
  const qrUrls = React.useMemo(() => identities.map((i) => i.loginUrl), [identities]);
  const qr = useQrDataUrls(qrUrls);

  const [roleFilter, setRoleFilter] = React.useState<RoleFilter>("all");
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [pinInput, setPinInput] = React.useState("");
  const [result, setResult] = React.useState<ResetResult | null>(null);
  const [printMode, setPrintMode] = React.useState<"result" | "qr">("qr");
  const reload = ids.reload;
  const post = useAdminPost(reload);

  // 有新 PIN 顯示時，離開頁面前提醒（新 PIN 離開後就看不到了）
  React.useEffect(() => {
    if (!result) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [result]);

  const byId = React.useMemo(() => new Map(identities.map((i) => [i.id, i])), [identities]);

  if (!ids.identities) {
    return <AdminLoading text="讀取身分清單中…" error={ids.error} />;
  }

  const counts = new Map<RoleFilter, number>([["all", identities.length]]);
  for (const r of ROLE_ORDER) counts.set(r, identities.filter((i) => i.role === r).length);
  const shown = roleFilter === "all" ? identities : identities.filter((i) => i.role === roleFilter);
  const activeCount = identities.filter((i) => i.isActive).length;

  const openDialog = (d: DialogState) => {
    post.setError(null);
    setPinInput("");
    setDialog(d);
  };
  const closeDialog = () => {
    if (post.pending) return;
    setDialog(null);
  };

  /** 新 PIN 累加到結果畫面（同一個身分以最新的為準），避免連續重設時前一次的新 PIN 被蓋掉 */
  const finish = (pins: NewPin[]) => {
    const at = live.getNow();
    setResult((prev) => {
      const fresh = new Set(pins.map((p) => p.identityId));
      const kept = prev ? prev.pins.filter((p) => !fresh.has(p.identityId)) : [];
      return { at, pins: [...pins, ...kept] };
    });
    setPrintMode("result");
    setDialog(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetOne = async (identity: AdminIdentity) => {
    const res = await post.run<Extract<AdminResetPinsResponse, { ok: true }>>("/api/admin/pins/reset", { identityId: identity.id }, "已重設 PIN");
    if (res) finish(res.pins);
  };

  const setPin = async (identity: AdminIdentity) => {
    const pin = pinInput.trim();
    if (!PIN_RE.test(pin)) {
      post.setError(`PIN 必須是 ${PIN_LENGTH} 位數字。`);
      return;
    }
    const res = await post.run<Extract<AdminResetPinsResponse, { ok: true }>>("/api/admin/pins/reset", { identityId: identity.id, pin }, "已修改 PIN");
    if (res) finish(res.pins);
  };

  const resetAll = async () => {
    const res = await post.run<Extract<AdminResetPinsResponse, { ok: true }>>(
      "/api/admin/pins/reset",
      { all: true },
      "已重設全部 PIN",
      { timeoutMs: RESET_ALL_TIMEOUT_MS },
    );
    if (res) finish(res.pins);
  };

  const print = (mode: "result" | "qr") => {
    flushSync(() => setPrintMode(mode));
    window.print();
  };

  const hideResult = () => {
    setResult(null);
    setPrintMode("qr");
  };

  const selfNote = (identity: AdminIdentity) =>
    identity.id === session.identityId
      ? "這是你目前登入的身分：重設後這台裝置仍保持登入，其他用這組 PIN 登入的裝置要用新 PIN 重新登入。"
      : "重設後，所有用這組 PIN 登入的裝置都要用新 PIN 重新登入。";

  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        title="PIN 總表"
        description={`共 ${identities.length} 個身分（啟用 ${activeCount}）。DB 只存加密後的 PIN，無法查看目前的 PIN；初次匯入的完整 PIN 清單以 import 產生的本機 CSV 為準。QR code 只含登入網址，不含 PIN。`}
        onRefresh={reload}
        refreshing={ids.loading}
        actions={
          <>
            <Button variant="secondary" onClick={() => print("qr")}>
              <QrCode className="size-5" aria-hidden />
              列印 QR 總表（不含 PIN）
            </Button>
            <Button variant="danger" onClick={() => openDialog({ kind: "reset-all" })}>
              <RotateCcw className="size-5" aria-hidden />
              重設全部 PIN
            </Button>
          </>
        }
      />
      <ErrorText message={ids.error} />

      {result && (
        <ResultPanel
          result={result}
          byId={byId}
          qr={qr}
          onPrint={() => print("result")}
          onHide={hideResult}
        />
      )}

      {/* 角色篩選 */}
      <nav aria-label="角色篩選" className="flex flex-wrap gap-2">
        {(["all", ...ROLE_ORDER] as RoleFilter[]).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={roleFilter === r}
            onClick={() => setRoleFilter(r)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-xl border-2 px-4 text-base font-bold",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
              roleFilter === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100",
            )}
          >
            {r === "all" ? "全部" : ROLE_LABEL[r]}
            <span className="text-sm opacity-80">{counts.get(r) ?? 0}</span>
          </button>
        ))}
      </nav>

      {/* 桌機：表格 */}
      <div className="hidden overflow-x-auto rounded-2xl border-2 border-slate-300 bg-white lg:block">
        <table className="w-full border-collapse text-left text-base">
          <thead className="bg-slate-100 text-sm font-bold text-slate-800">
            <tr>
              <th className="px-3 py-3">角色</th>
              <th className="px-3 py-3">遊戲</th>
              <th className="px-3 py-3">關卡／隊伍</th>
              <th className="px-3 py-3">名稱（label）</th>
              <th className="px-3 py-3">啟用</th>
              <th className="px-3 py-3">登入 QR</th>
              <th className="px-3 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className={cn("border-t-2 border-slate-200 align-middle", !i.isActive && "bg-slate-50 text-slate-500")}>
                <td className="px-3 py-2">
                  <Badge tone={ROLE_TONE[i.role]} size="sm">
                    {ROLE_LABEL[i.role]}
                  </Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{gameText(i)}</td>
                <td className="px-3 py-2 font-bold">{targetText(i)}</td>
                <td className="px-3 py-2">
                  <span className="font-bold">{i.label}</span>
                  {i.id === session.identityId && (
                    <Badge tone="green" size="sm" className="ml-2">
                      你
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ActiveBadge active={i.isActive} />
                </td>
                <td className="px-3 py-2">
                  <QrThumb src={qr.get(i.loginUrl)} label={i.label} onOpen={() => openDialog({ kind: "qr", identity: i })} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: "set-pin", identity: i })}>
                      修改 PIN
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => openDialog({ kind: "reset-one", identity: i })}>
                      重設此 PIN
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 手機／平板：卡片 */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {shown.map((i) => (
          <li key={i.id} className={cn("flex flex-col gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4", !i.isActive && "bg-slate-50")}>
            <div className="flex items-start gap-3">
              <QrThumb src={qr.get(i.loginUrl)} label={i.label} onOpen={() => openDialog({ kind: "qr", identity: i })} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ROLE_TONE[i.role]} size="sm">
                    {ROLE_LABEL[i.role]}
                  </Badge>
                  <ActiveBadge active={i.isActive} />
                  {i.id === session.identityId && (
                    <Badge tone="green" size="sm">
                      你
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-lg font-black leading-snug text-slate-950">{i.label}</p>
                <p className="text-base text-slate-700">
                  {gameText(i)}
                  {i.role === "STATION" || i.role === "TEAM" ? `・${targetText(i)}` : ""}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => openDialog({ kind: "set-pin", identity: i })}>
                修改 PIN
              </Button>
              <Button variant="danger" onClick={() => openDialog({ kind: "reset-one", identity: i })}>
                重設此 PIN
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {/* ---- 對話框 ---- */}
      <ConfirmDialog
        open={dialog?.kind === "reset-one"}
        title="重設此 PIN"
        description={dialog?.kind === "reset-one" ? `確定重設【${dialog.identity.label}】的 PIN？系統會隨機產生新的 ${PIN_LENGTH} 位數 PIN。` : null}
        confirmLabel="確定重設"
        tone="danger"
        pending={post.pending}
        error={post.error}
        onConfirm={() => (dialog?.kind === "reset-one" ? resetOne(dialog.identity) : undefined)}
        onCancel={closeDialog}
      >
        {dialog?.kind === "reset-one" && <p className="text-base text-slate-700">{selfNote(dialog.identity)}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "set-pin"}
        title="修改 PIN"
        description={dialog?.kind === "set-pin" ? `指定【${dialog.identity.label}】的新 PIN` : null}
        confirmLabel="確定修改"
        tone="primary"
        pending={post.pending}
        error={post.error}
        onConfirm={() => (dialog?.kind === "set-pin" ? setPin(dialog.identity) : undefined)}
        onCancel={closeDialog}
      >
        {dialog?.kind === "set-pin" && (
          <div className="flex flex-col gap-3">
            <Field label={`新 PIN（${PIN_LENGTH} 位數字）`} htmlFor="b-set-pin" required>
              <Input
                id="b-set-pin"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH));
                  post.setError(null);
                }}
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={PIN_LENGTH}
                placeholder={"0".repeat(PIN_LENGTH)}
                className="timer-digits text-center text-3xl tracking-[0.4em]"
                disabled={post.pending}
              />
            </Field>
            <p className="text-base text-slate-700">{selfNote(dialog.identity)}</p>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "reset-all"}
        title="重設全部 PIN"
        description={`確定重設全部 ${activeCount} 個啟用中身分的 PIN？`}
        confirmLabel="確定重設全部"
        tone="danger"
        pending={post.pending}
        error={post.error}
        typedConfirmation={{ text: RESET_ALL_CONFIRM, label: `請輸入 ${RESET_ALL_CONFIRM} 確認` }}
        onConfirm={() => (dialog?.kind === "reset-all" ? resetAll() : undefined)}
        onCancel={closeDialog}
      >
        <ul className="list-disc space-y-1 pl-6 text-base text-slate-800">
          <li>所有關主、隊輔、唯讀與總召的 PIN 都會換成新的隨機 PIN，現場所有裝置都要重新登入。</li>
          <li>你這台裝置會保持登入。</li>
          <li>新 PIN 只會顯示這一次，請立刻列印或抄下。</li>
          <li>停用中的身分不會重設。</li>
        </ul>
      </ConfirmDialog>

      <Dialog
        open={dialog?.kind === "qr"}
        onClose={closeDialog}
        title={dialog?.kind === "qr" ? dialog.identity.label : "登入 QR code"}
        description="掃描後開啟登入頁並自動選好身分，再輸入 PIN（QR code 不含 PIN）。"
        size="sm"
      >
        {dialog?.kind === "qr" && (
          <div className="flex flex-col items-center gap-3">
            {qr.get(dialog.identity.loginUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL，不經 next/image
              <img src={qr.get(dialog.identity.loginUrl)} alt={`${dialog.identity.label} 登入 QR code`} className="size-72 max-w-full" />
            ) : (
              <p className="text-base text-slate-700">QR code 產生中…</p>
            )}
            <p className="break-all text-center text-sm text-slate-700">{dialog.identity.loginUrl}</p>
          </div>
        )}
      </Dialog>

      {/* ---- 列印內容（只在 window.print 時出現） ---- */}
      <PrintPortal>
        {/* 兩份都先掛好（圖片先載入），列印時只顯示選到的那一份 */}
        {result && (
          <div className={printMode === "result" ? undefined : "hidden"}>
            <PrintSheet
              title={`新 PIN（${msToTaipeiDate(result.at)} ${formatHms(result.at)} 重設）`}
              note="請沿虛線剪下，交給對應的關主／隊輔。PIN 請勿公開張貼。"
              cards={result.pins.map((p) => {
                const idn = byId.get(p.identityId);
                return {
                  key: p.identityId,
                  label: p.label,
                  sub: idn ? identitySubText(idn) : ROLE_LABEL[p.role],
                  qr: idn ? qr.get(idn.loginUrl) : undefined,
                  pin: p.pin,
                };
              })}
            />
          </div>
        )}
        <div className={printMode === "result" && result ? "hidden" : undefined}>
          <PrintSheet
            title="登入 QR 總表"
            note="掃描 QR code 開啟登入頁並自動選好身分，再輸入 PIN。本表不含 PIN。"
            cards={identities
              .filter((i) => i.isActive)
              .map((i) => ({ key: i.id, label: i.label, sub: identitySubText(i), qr: qr.get(i.loginUrl), pin: null }))}
          />
        </div>
      </PrintPortal>
    </div>
  );
}

// ---------------------------------------------------------------------
// 小元件
// ---------------------------------------------------------------------

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="green" size="sm">
      啟用
    </Badge>
  ) : (
    <Badge tone="gray" size="sm">
      停用
    </Badge>
  );
}

function QrThumb({ src, label, onOpen }: { src: string | undefined; label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`放大 ${label} 的登入 QR code`}
      className="inline-flex size-20 shrink-0 items-center justify-center rounded-lg border-2 border-slate-300 bg-white p-1 hover:border-blue-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL，不經 next/image
        <img src={src} alt="" className="size-full" />
      ) : (
        <QrCode className="size-8 text-slate-400" aria-hidden />
      )}
    </button>
  );
}

function ResultPanel({
  result,
  byId,
  qr,
  onPrint,
  onHide,
}: {
  result: ResetResult;
  byId: Map<string, AdminIdentity>;
  qr: Map<string, string>;
  onPrint: () => void;
  onHide: () => void;
}) {
  const [confirmHide, setConfirmHide] = React.useState(false);
  return (
    <section aria-labelledby="b-pin-result-title" className="flex flex-col gap-4 rounded-2xl border-4 border-red-600 bg-white p-4 shadow-lg">
      <div className="flex flex-wrap items-start gap-3">
        <KeyRound className="size-8 shrink-0 text-red-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id="b-pin-result-title" className="text-2xl font-black text-slate-950">
            新 PIN（{result.pins.length} 組，最近一次 {formatHms(result.at)} 重設）
          </h3>
          <p className="mt-1 flex items-start gap-2 text-lg font-bold text-red-700">
            <ShieldAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
            新 PIN 只顯示這一次。離開此分頁或頁面後就看不到了，請先列印或抄下。
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" onClick={onPrint} className="sm:flex-1">
          <Printer className="size-6" aria-hidden />
          列印新 PIN
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setConfirmHide(true)} className="sm:flex-1">
          <X className="size-6" aria-hidden />
          隱藏新 PIN
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {result.pins.map((p) => {
          const idn = byId.get(p.identityId);
          const src = idn ? qr.get(idn.loginUrl) : undefined;
          return (
            <li key={p.identityId} className="flex items-center gap-3 rounded-xl border-2 border-slate-300 bg-slate-50 p-3">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL，不經 next/image
                <img src={src} alt="" className="size-20 shrink-0 rounded bg-white" />
              ) : (
                <QrCode className="size-12 shrink-0 text-slate-400" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-700">
                  {ROLE_LABEL[p.role]}
                  {idn && idn.role !== "ADMIN" && idn.role !== "VIEWER" ? `・${targetText(idn)}` : ""}
                </p>
                <p className="truncate text-lg font-black text-slate-950">{p.label}</p>
                <p className="timer-digits text-4xl font-black tracking-widest text-slate-950">{p.pin}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirmHide}
        title="隱藏新 PIN"
        description="隱藏後就再也看不到這些新 PIN（只能再重設一次）。確定已經列印或抄下了？"
        confirmLabel="確定隱藏"
        tone="danger"
        onConfirm={() => {
          setConfirmHide(false);
          onHide();
        }}
        onCancel={() => setConfirmHide(false)}
      />
    </section>
  );
}

interface PrintCard {
  key: string;
  label: string;
  sub: string;
  qr: string | undefined;
  pin: string | null;
}

/** 列印版：每個身分一張可裁切的卡片（虛線框），兩欄 */
function PrintSheet({ title, note, cards }: { title: string; note: string; cards: PrintCard[] }) {
  return (
    <div className="p-2 text-black">
      <h1 className="text-xl font-black">{title}</h1>
      <p className="mb-3 text-sm">{note}</p>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.key} className="b-print-card flex items-center gap-3 border-2 border-dashed border-black p-3">
            {c.qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL，不經 next/image
              <img src={c.qr} alt="" className="size-32 shrink-0" />
            ) : (
              <div className="size-32 shrink-0 border border-black" />
            )}
            <div className="min-w-0">
              <p className="text-sm">{c.sub}</p>
              <p className="text-xl font-black leading-tight">{c.label}</p>
              {c.pin !== null && (
                <p className="mt-1 font-mono text-3xl font-black tracking-widest">
                  PIN {c.pin}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
