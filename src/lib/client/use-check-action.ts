"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, CheckRequest, CheckResponse, CheckStatus } from "@/lib/api/contract";
import { ERROR_MESSAGES, type ErrorCode } from "@/lib/errors";
import { formatHms } from "@/lib/time";
import type { CheckAction, CheckRecordRow } from "@/lib/types";
import { newClientRequestId, postApi, type ClientApiError } from "@/lib/client/api";
import { getClientInfo } from "@/lib/client/client-info";
import { unlockSound } from "@/lib/client/sound";

/** 一個打卡按鈕對應的目標 */
export interface CheckActionTarget {
  /** null = 目前沒有可按的場次（submit 不會送出） */
  assignmentId: string | null;
  action: CheckAction;
  /** 隊輔側動作 = 本隊 id；關主側動作一律 null */
  teamId: string | null;
}

/** submit 時額外帶的欄位 */
export type CheckExtra = Pick<CheckRequest, "noShow" | "confirmedTeamIds" | "singleTeamOverride" | "reason">;

export type CheckOutcome =
  | {
      ok: true;
      status: CheckStatus;
      record: CheckRecordRow;
      /** 例：「已由另一裝置於 09:10:18 記錄」（其他情況為 null） */
      notice: string | null;
    }
  | { ok: false; error: ApiError | ClientApiError };

export interface CheckActionOptions {
  /** 成功（含 ALREADY_RECORDED、重送 existing）後呼叫，例如顯示撤銷按鈕 */
  onSuccess?: (record: CheckRecordRow, status: CheckStatus) => void;
  /** 成功後重抓快照（通常傳 useLiveGame().refetch） */
  refetch?: () => Promise<void> | void;
}

export interface CheckActionState {
  /**
   * 送出打卡。按下立即進入 pending（按鈕應 disabled）；pending 中重複呼叫會被忽略並回傳 null。
   * 網路錯誤／逾時／5xx 會用同一個 clientRequestId 自動重試 2 次；
   * 仍失敗時 error =「網路中斷，請重新送出」，再按一次仍沿用同一個 clientRequestId。
   */
  submit: (extra?: CheckExtra) => Promise<CheckOutcome | null>;
  /** 送出中（含自動重試） */
  pending: boolean;
  /** 目前第幾次嘗試（1 = 第一次；2、3 = 自動重試中）；未送出為 0 */
  attempt: number;
  /** 顯示在按鈕下方的錯誤訊息（中文） */
  error: string | null;
  errorCode: ErrorCode | null;
  /** 非錯誤的提示，例如「已由另一裝置於 HH:mm:ss 記錄」 */
  notice: string | null;
  /** 最近一次成功（或已由別台記錄）的紀錄 */
  lastRecord: CheckRecordRow | null;
  /** 清除狀態並丟棄 clientRequestId（撤銷成功後呼叫，下一次按下是新的操作） */
  reset: () => void;
}

interface InnerState {
  key: string;
  pending: boolean;
  attempt: number;
  error: string | null;
  errorCode: ErrorCode | null;
  notice: string | null;
  lastRecord: CheckRecordRow | null;
}

function targetKey(t: CheckActionTarget): string {
  return `${t.assignmentId ?? ""}|${t.action}|${t.teamId ?? ""}`;
}

function emptyState(key: string): InnerState {
  return { key, pending: false, attempt: 0, error: null, errorCode: null, notice: null, lastRecord: null };
}

/** 「已由另一裝置於 HH:mm:ss 記錄」（第二十一節） */
export function alreadyRecordedNotice(record: Pick<CheckRecordRow, "recorded_at">): string {
  return `已由另一裝置於 ${formatHms(Date.parse(record.recorded_at))} 記錄`;
}

/**
 * 一個打卡按鈕一個 hook（第二十一、二十八節）。
 *
 * clientRequestId 的生命週期：
 * - 新的一次按下（沒有待重送的 id）→ 產生新 id；
 * - 自動重試、失敗後「重新送出」→ 沿用同一個 id；
 * - 成功、ALREADY_RECORDED、撤銷（reset）或目標（assignment/action/team）改變 → 丟棄，下次產生新的。
 */
export function useCheckAction(target: CheckActionTarget, options: CheckActionOptions = {}): CheckActionState {
  const key = targetKey(target);
  const [raw, setRaw] = useState<InnerState>(() => emptyState(key));
  const state = raw.key === key ? raw : emptyState(key);

  const pendingRef = useRef(false);
  const idRef = useRef<{ key: string; id: string } | null>(null);
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const update = useCallback((k: string, patch: Partial<InnerState>) => {
    setRaw((prev) => ({ ...(prev.key === k ? prev : emptyState(k)), ...patch, key: k }));
  }, []);

  const { assignmentId, action, teamId } = target;

  const submit = useCallback(
    async (extra?: CheckExtra): Promise<CheckOutcome | null> => {
      if (!assignmentId || pendingRef.current) return null;
      pendingRef.current = true;
      const k = `${assignmentId}|${action}|${teamId ?? ""}`;

      // 關主按進關本身也算手勢：順便解鎖聲音（第十五節）
      void unlockSound();

      if (!idRef.current || idRef.current.key !== k) idRef.current = { key: k, id: newClientRequestId() };
      const clientRequestId = idRef.current.id;

      update(k, { pending: true, attempt: 1, error: null, errorCode: null, notice: null });

      const body: CheckRequest = {
        clientRequestId,
        assignmentId,
        action,
        teamId,
        ...extra,
        clientInfo: getClientInfo(),
      };

      try {
        const res = await postApi<CheckResponse>("/api/check", body, {
          retry: true,
          onAttempt: (n) => update(k, { attempt: n }),
        });

        // 別台裝置先按（可能以 ok:false + ALREADY_RECORDED + record 回傳）→ 視為完成，不是錯誤
        if (!res.ok && res.code === "ALREADY_RECORDED" && res.record) {
          idRef.current = null;
          const notice = alreadyRecordedNotice(res.record);
          update(k, { pending: false, attempt: 0, lastRecord: res.record, notice, error: null, errorCode: null });
          optsRef.current.onSuccess?.(res.record, "already_recorded");
          void optsRef.current.refetch?.();
          return { ok: true, status: "already_recorded", record: res.record, notice };
        }

        if (!res.ok) {
          // 4xx：顯示 server 訊息；網路錯誤：「網路中斷，請重新送出」。都保留 clientRequestId 供重新送出
          update(k, { pending: false, attempt: 0, error: res.message || ERROR_MESSAGES.INTERNAL_ERROR, errorCode: res.code });
          return { ok: false, error: res };
        }

        const record = res.record;
        if (res.status === "existing" && record.voided_at) {
          // 同一個 id 的紀錄已被撤銷：這個 id 不能再用，請使用者重新按（會產生新 id）
          idRef.current = null;
          const msg = "這次操作先前已被撤銷，請再按一次。";
          update(k, { pending: false, attempt: 0, error: msg, errorCode: "ALREADY_VOIDED" });
          return { ok: false, error: { ok: false, code: "ALREADY_VOIDED", message: msg } };
        }

        idRef.current = null;
        const notice = res.status === "already_recorded" ? alreadyRecordedNotice(record) : null;
        update(k, { pending: false, attempt: 0, lastRecord: record, notice, error: null, errorCode: null });
        optsRef.current.onSuccess?.(record, res.status);
        void optsRef.current.refetch?.();
        return { ok: true, status: res.status, record, notice };
      } finally {
        pendingRef.current = false;
      }
    },
    [assignmentId, action, teamId, update],
  );

  const reset = useCallback(() => {
    idRef.current = null;
    setRaw(emptyState(key));
  }, [key]);

  return {
    submit,
    pending: state.pending,
    attempt: state.attempt,
    error: state.error,
    errorCode: state.errorCode,
    notice: state.notice,
    lastRecord: state.lastRecord,
    reset,
  };
}
