"use client";

/**
 * [admin-b] 管理頁分頁共用的 hook 與小元件：
 * - useAdminIdentities：GET /api/admin/identities（身分 label、PIN 總表）
 * - useQrDataUrls：登入網址 → QR code data URL（qrcode 套件，不含 PIN）
 * - PrintPortal：只在列印時出現的內容（window.print 時隱藏頁面其他部分）
 * - AdminLoading / TabHeader
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { toDataURL } from "qrcode";
import { Loader2, RefreshCw } from "lucide-react";
import type { AdminAuditLogsResponse, AdminIdentitiesResponse, AdminIdentity, ApiError } from "@/lib/api/contract";
import type { GameCode } from "@/lib/types";
import { getApi, postApi } from "@/lib/client/api";
import { pushToast } from "@/lib/client/toast-store";
import { cn } from "@/lib/client/cn";
import { useIsClient } from "@/lib/client/use-is-client";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/error-text";
import { apiErrorText, type AuditLogItem } from "./b-helpers";

// ---------------------------------------------------------------------
// 身分清單
// ---------------------------------------------------------------------

export interface AdminIdentitiesState {
  identities: AdminIdentity[] | null;
  /** identity id → label（操作者顯示） */
  labelById: Map<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface IdentitiesData {
  identities: AdminIdentity[] | null;
  error: string | null;
  loading: boolean;
}

/** GET /api/admin/identities（GET 會自動重試；寫入一律不重試） */
export function useAdminIdentities(): AdminIdentitiesState {
  const [data, setData] = React.useState<IdentitiesData>({ identities: null, error: null, loading: true });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void getApi<AdminIdentitiesResponse>("/api/admin/identities").then((res) => {
      if (cancelled) return;
      if (res.ok) setData({ identities: res.identities, error: null, loading: false });
      else setData((prev) => ({ identities: prev.identities, error: apiErrorText(res), loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = React.useCallback(() => {
    setData((prev) => ({ ...prev, loading: true }));
    setNonce((n) => n + 1);
  }, []);

  const labelById = React.useMemo(() => new Map((data.identities ?? []).map((i) => [i.id, i.label])), [data.identities]);

  return { identities: data.identities, labelById, loading: data.loading, error: data.error, reload };
}

/** 操作者文字 */
export function actorText(labelById: Map<string, string>, identityId: string | null | undefined): string {
  if (!identityId) return "系統";
  return labelById.get(identityId) ?? "（已刪除的身分）";
}

// ---------------------------------------------------------------------
// 管理操作送出（絕不自動重試：規則拒絕／網路錯誤都直接顯示，讓總召自己決定是否重送）
// ---------------------------------------------------------------------

export interface AdminPostState {
  pending: boolean;
  /** 錯誤訊息（顯示在送出按鈕下方） */
  error: string | null;
  setError: (msg: string | null) => void;
  /**
   * 送出 POST；成功回傳 server 回應並推一則成功 Toast、呼叫 onSuccess；失敗回傳 null 並設定 error。
   */
  run: <T extends { ok: true }>(url: string, body: unknown, successTitle?: string, opts?: AdminPostOptions) => Promise<T | null>;
}

export interface AdminPostOptions {
  /** 單次逾時（預設 8 秒；重設全部 PIN 等較久的操作要加長，避免 server 已完成但前端逾時而看不到結果） */
  timeoutMs?: number;
}

export function useAdminPost(onSuccess?: () => void): AdminPostState {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const onSuccessRef = React.useRef(onSuccess);
  React.useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  const run = React.useCallback(
    async <T extends { ok: true }>(url: string, body: unknown, successTitle?: string, opts?: AdminPostOptions): Promise<T | null> => {
      setPending(true);
      setError(null);
      const res = await postApi<T | ApiError>(url, body, { retry: false, timeoutMs: opts?.timeoutMs });
      setPending(false);
      if (!res.ok) {
        setError(apiErrorText(res));
        return null;
      }
      if (successTitle) pushToast({ tone: "success", title: successTitle });
      onSuccessRef.current?.();
      return res;
    },
    [],
  );

  return { pending, error, setError, run };
}

// ---------------------------------------------------------------------
// Audit log 讀取
// ---------------------------------------------------------------------

export interface AuditQuery {
  limit?: number;
  /** 上一頁最後一筆的 id（分頁） */
  before?: number | null;
  action?: string | null;
  game?: GameCode | null;
}

export type AuditFetchResult = { ok: true; logs: AuditLogItem[] } | { ok: false; error: string };

/** GET /api/admin/audit-logs（依 id 由新到舊） */
export async function fetchAuditLogs(q: AuditQuery): Promise<AuditFetchResult> {
  const sp = new URLSearchParams();
  if (q.limit) sp.set("limit", String(q.limit));
  if (q.before) sp.set("before", String(q.before));
  if (q.action) sp.set("action", q.action);
  if (q.game) sp.set("game", q.game);
  const res = await getApi<AdminAuditLogsResponse>(`/api/admin/audit-logs?${sp.toString()}`);
  if (!res.ok) return { ok: false, error: apiErrorText(res) };
  return { ok: true, logs: res.logs };
}

// ---------------------------------------------------------------------
// QR code
// ---------------------------------------------------------------------

/**
 * 產生每個網址的 QR code data URL（非同步，完成後才出現）。
 * 內容只有登入網址（含 identity id），絕對不放 PIN（第二十五節）。
 */
export function useQrDataUrls(urls: ReadonlyArray<string>): Map<string, string> {
  const [map, setMap] = React.useState<Map<string, string>>(() => new Map());
  const key = urls.join("\n");

  React.useEffect(() => {
    let cancelled = false;
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    void Promise.all(
      list.map(async (u) => {
        try {
          const dataUrl = await toDataURL(u, { errorCorrectionLevel: "M", margin: 1, width: 320 });
          return [u, dataUrl] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const p of pairs) if (p) next.set(p[0], p[1]);
      setMap(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}

// ---------------------------------------------------------------------
// 列印
// ---------------------------------------------------------------------

const PRINT_CSS = `
@media screen { .b-print-root { display: none !important; } }
@media print {
  body > *:not(.b-print-root) { display: none !important; }
  .b-print-root { display: block !important; }
  html, body { background: #fff !important; }
  @page { margin: 10mm; }
}
.b-print-card { break-inside: avoid; page-break-inside: avoid; }
`;

/**
 * 只在列印時顯示的內容：portal 到 body，列印時隱藏 body 的其他子元素。
 * 同一時間只放一個 PrintPortal。
 */
export function PrintPortal({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(
    <div className="b-print-root bg-white text-black">
      <style>{PRINT_CSS}</style>
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------
// 小元件
// ---------------------------------------------------------------------

export function AdminLoading({ text = "讀取資料中…", error }: { text?: string; error?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white p-8 text-center">
      {!error && <Loader2 className="size-10 animate-spin text-slate-600" aria-hidden />}
      <p className="text-xl font-bold text-slate-800">{error ? "讀取失敗" : text}</p>
      <ErrorText message={error} />
    </div>
  );
}

export interface TabHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 右側動作（按鈕） */
  actions?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}

export function TabHeader({ title, description, actions, onRefresh, refreshing = false, className }: TabHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
        {description && <p className="mt-1 text-base text-slate-700">{description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {onRefresh && (
          <Button variant="secondary" onClick={onRefresh} loading={refreshing} loadingText="重新整理中…">
            <RefreshCw className="size-5" aria-hidden />
            重新整理
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
