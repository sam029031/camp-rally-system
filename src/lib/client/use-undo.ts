"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, UndoReminder, UndoRequest, UndoResponse } from "@/lib/api/contract";
import { ERROR_MESSAGES, type ErrorCode } from "@/lib/errors";
import type { CheckRecordRow } from "@/lib/types";
import { postApi, type ClientApiError } from "@/lib/client/api";
import { getClientInfo } from "@/lib/client/client-info";

export type UndoOutcome =
  | { ok: true; record: CheckRecordRow | null; reminder: UndoReminder | null }
  | { ok: false; error: ApiError | ClientApiError };

export interface UndoOptions {
  /** 撤銷成功後呼叫（通常用來 reset 對應的 useCheckAction，讓下一次按下產生新的 clientRequestId） */
  onUndone?: (recordId: string, record: CheckRecordRow | null) => void;
  /** 成功後重抓快照 */
  refetch?: () => Promise<void> | void;
}

export interface UndoState {
  /** POST /api/undo（現場撤銷，60 秒內、同一 identity；server 容許到 75 秒） */
  undo: (recordId: string) => Promise<UndoOutcome | null>;
  pending: boolean;
  /** 正在撤銷的紀錄 id */
  pendingRecordId: string | null;
  error: string | null;
  errorCode: ErrorCode | null;
  /**
   * 撤銷成功後要顯示的提醒（第二十二節，UndoReminderDialog 用）；
   * ADMIN 自己撤銷時 server 回傳 null，不跳視窗。
   */
  reminder: UndoReminder | null;
  /** 「我知道了」 */
  dismissReminder: () => void;
  clearError: () => void;
}

/** 現場撤銷（第二十二節）。 */
export function useUndo(options: UndoOptions = {}): UndoState {
  const [pendingRecordId, setPendingRecordId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code: ErrorCode } | null>(null);
  const [reminder, setReminder] = useState<UndoReminder | null>(null);
  const pendingRef = useRef(false);
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const undo = useCallback(async (recordId: string): Promise<UndoOutcome | null> => {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPendingRecordId(recordId);
    setError(null);
    try {
      const body: UndoRequest = { recordId, clientInfo: getClientInfo() };
      // 撤銷是冪等的（同一筆撤銷兩次會得到 ALREADY_VOIDED），網路錯誤可以安全重試
      const res = await postApi<UndoResponse>("/api/undo", body, { retry: true });
      if (!res.ok) {
        if (res.code === "ALREADY_VOIDED") {
          // 例如第一次其實成功了、回應在路上遺失：視為已撤銷（提醒內容已無法取得，改用通用提示）
          optsRef.current.onUndone?.(recordId, res.record ?? null);
          void optsRef.current.refetch?.();
          setError({ message: ERROR_MESSAGES.ALREADY_VOIDED, code: "ALREADY_VOIDED" });
          return { ok: true, record: res.record ?? null, reminder: null };
        }
        setError({ message: res.message || ERROR_MESSAGES.INTERNAL_ERROR, code: res.code });
        return { ok: false, error: res };
      }
      setReminder(res.reminder);
      optsRef.current.onUndone?.(recordId, res.record);
      void optsRef.current.refetch?.();
      return { ok: true, record: res.record, reminder: res.reminder };
    } finally {
      pendingRef.current = false;
      setPendingRecordId(null);
    }
  }, []);

  const dismissReminder = useCallback(() => setReminder(null), []);
  const clearError = useCallback(() => setError(null), []);

  return {
    undo,
    pending: pendingRecordId !== null,
    pendingRecordId,
    error: error?.message ?? null,
    errorCode: error?.code ?? null,
    reminder,
    dismissReminder,
    clearError,
  };
}
