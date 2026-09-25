"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { NotificationCheckRequest, NotificationCheckResponse } from "@/lib/api/contract";
import { NOTIFICATION_RETRY_MS } from "@/lib/constants";
import { conditionKey } from "@/lib/derive";
import type { DerivedGame } from "@/lib/derive/types";
import { isConditionRelevant, isRelevantNotification, isToastNotification, type PageContext } from "@/lib/notifications/classify";
import type { AppNotification, GameSnapshot } from "@/lib/types";
import { postApi } from "@/lib/client/api";
import { showBrowserNotification } from "@/lib/client/browser-notification";
import { playSound } from "@/lib/client/sound";
import { mergeToast, mergedToastText } from "@/lib/client/toast-merge";
import { pushToast } from "@/lib/client/toast-store";
import { vibrate } from "@/lib/client/vibrate";

export interface NotificationWatcherOptions {
  snapshot: GameSnapshot | null;
  derived: DerivedGame | null;
  /** 本頁的身分脈絡（決定哪些條件要偵測、哪些通知要跳 Toast） */
  context: PageContext;
  /** 校正後真實時間（5 秒重試間隔用真實時間） */
  realNow: () => number;
  /** false 時完全不偵測、不跳 Toast（例如尚未登入）；預設 true */
  enabled?: boolean;
  /** 離線時不送偵測請求；預設 true */
  online?: boolean;
  /** 偵測到通知已建立（created / exists）時重抓快照，讓通知盡快出現在本機列表 */
  refetch?: () => Promise<void> | void;
  /** 點 Toast 的「查看」→ 通常是打開通知中心 */
  onOpenCenter?: () => void;
  /** 是否嘗試系統通知（仍需使用者授權過）；預設 true */
  browserNotification?: boolean;
}

export interface NotificationWatcher {
  /** 與本頁相關的通知（新的在前），給 NotificationCenter 顯示 */
  notifications: AppNotification[];
  /** 載入後新出現、尚未在通知中心看過的相關通知數 */
  unreadCount: number;
  /** 打開通知中心時呼叫 */
  markAllRead: () => void;
}

/** 每個 hook 實例自己的記憶體狀態（不寫 localStorage：refresh 後重新初始化，符合第十五節） */
class WatcherStore {
  gameId: string | null = null;
  seen = new Set<string>();
  unread = new Set<string>();
  lastAttempt = new Map<string, number>();
  inFlight = new Set<string>();
  version = 0;
  private listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** 第一次載入（或換遊戲）：當下所有通知標為已看過，不跳 Toast */
  init(gameId: string, ids: Iterable<string>): void {
    this.gameId = gameId;
    this.seen = new Set(ids);
    this.lastAttempt.clear();
    this.inFlight.clear();
    if (this.unread.size > 0) {
      this.unread = new Set();
      this.emit();
    }
  }

  addUnread(ids: string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) this.unread.add(id);
    this.emit();
  }

  clearUnread(): void {
    if (this.unread.size === 0) return;
    this.unread = new Set();
    this.emit();
  }
}

function getServerVersion(): number {
  return 0;
}

/**
 * 通知偵測與提醒（第十五節；docs/ARCHITECTURE.md 第 6 節）。
 *
 * (1) 偵測：derived.conditions 中與本頁相關、本機通知列表還沒有的條件 →
 *     POST /api/notifications/check（只帶 kind/subkind/assignmentId/teamId，不帶時間）；
 *     not_yet 不是錯誤：同一個 key 每 5 秒（真實時間）最多再試一次，直到本機列表出現那一筆。
 * (2) 提醒：第一次載入把當下所有通知標為已看過（不跳）；之後新出現、相關、A 類且未失效的通知 →
 *     合併成一則 Toast + 聲音（已解鎖時）+ Android 震動 +（可選）系統通知。B 類只進通知中心。
 */
export function useNotificationWatcher(opts: NotificationWatcherOptions): NotificationWatcher {
  const { snapshot, derived, realNow, refetch, onOpenCenter } = opts;
  const enabled = opts.enabled ?? true;
  const online = opts.online ?? true;
  const wantBrowser = opts.browserNotification ?? true;
  const { page, stationId = null, teamId = null } = opts.context;

  const [store] = useState(() => new WatcherStore());
  const version = useSyncExternalStore(store.subscribe, store.getVersion, getServerVersion);

  // ---- (2) 新通知 → Toast / 聲音 / 震動 / 系統通知 ----
  useEffect(() => {
    if (!enabled || !snapshot) return;
    const ctx: PageContext = { page, stationId, teamId };
    const gameId = snapshot.game.id;

    if (store.gameId !== gameId) {
      store.init(
        gameId,
        snapshot.notifications.map((n) => n.id),
      );
      return;
    }

    const fresh = snapshot.notifications.filter((n) => !store.seen.has(n.id));
    if (fresh.length === 0) return;
    for (const n of fresh) store.seen.add(n.id);

    let relevant: AppNotification[] = [];
    let toastable: AppNotification[] = [];
    try {
      relevant = fresh.filter((n) => isRelevantNotification(n, snapshot, ctx));
      toastable = relevant.filter((n) => n.invalidatedAt === null && isToastNotification(n, snapshot, ctx));
    } catch (e) {
      console.error("[useNotificationWatcher] 通知分類失敗", e);
      return;
    }
    store.addUnread(relevant.map((n) => n.id));

    const merged = mergeToast(toastable.map((n) => ({ id: n.id, kind: n.kind, subkind: n.subkind, message: n.message })));
    if (!merged) return;

    // 順序：先 Toast 與聲音，再震動，最後才嘗試系統通知（失敗靜默略過）
    pushToast({
      id: `alert-${merged.ids[0]}`,
      tone: merged.tone,
      title: merged.title,
      body: merged.body,
      lines: merged.lines,
      action: onOpenCenter ? { label: "查看", onClick: onOpenCenter } : undefined,
    });
    playSound(merged.sound);
    vibrate(merged.sound === "overtime" ? "overtime" : "notification");
    if (wantBrowser) void showBrowserNotification(merged.title, mergedToastText(merged), `camp-${gameId}`);
  }, [snapshot, enabled, page, stationId, teamId, store, onOpenCenter, wantBrowser]);

  // ---- (1) 偵測推導型條件 → /api/notifications/check ----
  useEffect(() => {
    if (!enabled || !online || !snapshot || !derived) return;
    if (store.gameId !== snapshot.game.id) return;
    const ctx: PageContext = { page, stationId, teamId };

    let existing: Set<string>;
    try {
      existing = new Set(snapshot.notifications.map((n) => conditionKey(n)));
    } catch (e) {
      console.error("[useNotificationWatcher] conditionKey 失敗", e);
      return;
    }
    const nowReal = realNow();

    for (const c of derived.conditions) {
      let key: string;
      try {
        if (!isConditionRelevant(c, snapshot, ctx)) continue;
        key = conditionKey(c);
      } catch (e) {
        console.error("[useNotificationWatcher] 條件判斷失敗", e);
        continue;
      }
      if (existing.has(key)) {
        store.lastAttempt.delete(key);
        continue;
      }
      if (store.inFlight.has(key)) continue;
      const last = store.lastAttempt.get(key);
      if (last !== undefined && nowReal - last < NOTIFICATION_RETRY_MS) continue;

      store.lastAttempt.set(key, nowReal);
      store.inFlight.add(key);
      const body: NotificationCheckRequest = {
        kind: c.kind,
        subkind: c.subkind,
        assignmentId: c.assignmentId,
        teamId: c.teamId,
      };
      const k = key;
      void postApi<NotificationCheckResponse>("/api/notifications/check", body, { retry: false })
        .then((res) => {
          if (res.ok && res.result !== "not_yet") void refetch?.();
        })
        .finally(() => {
          store.inFlight.delete(k);
        });
    }
  }, [derived, snapshot, enabled, online, page, stationId, teamId, store, realNow, refetch]);

  // ---- 通知中心列表 ----
  const notifications = useMemo(() => {
    if (!snapshot) return [];
    const ctx: PageContext = { page, stationId, teamId };
    try {
      return snapshot.notifications
        .filter((n) => isRelevantNotification(n, snapshot, ctx))
        .sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
      console.error("[useNotificationWatcher] 通知分類失敗", e);
      return [...snapshot.notifications].sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [snapshot, page, stationId, teamId]);

  const unreadCount = useMemo(() => {
    void version;
    const ids = new Set(notifications.map((n) => n.id));
    let count = 0;
    for (const id of store.unread) if (ids.has(id)) count += 1;
    return count;
  }, [notifications, store, version]);

  const markAllRead = useCallback(() => store.clearUnread(), [store]);

  return { notifications, unreadCount, markAllRead };
}
