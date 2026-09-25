"use client";

/**
 * 全域 Toast 佇列（ToastStack 在 layout 的 Providers 裡渲染）。
 * 任何地方都可以 pushToast；A 類通知由 use-notification-watcher 合併後推入。
 */

import { useSyncExternalStore } from "react";
import type { ToastTone } from "@/lib/client/toast-merge";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string | null;
  lines?: string[];
  /** 自動關閉毫秒數；null = 需手動關閉 */
  durationMs: number | null;
  action?: ToastAction;
}

export type ToastInput = Omit<ToastItem, "id" | "durationMs"> & { id?: string; durationMs?: number | null };

/** 同時最多顯示幾則（再多就把最舊的擠掉） */
export const MAX_VISIBLE_TOASTS = 3;

const DEFAULT_DURATION: Record<ToastTone, number | null> = {
  danger: 20_000,
  warning: 15_000,
  info: 8_000,
  success: 3_500,
};

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit(): void {
  for (const l of listeners) l();
}

function clearTimer(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

export function dismissToast(id: string): void {
  clearTimer(id);
  const next = toasts.filter((x) => x.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

/** 推入一則 Toast，回傳 id（同 id 會取代舊的） */
export function pushToast(input: ToastInput): string {
  seq += 1;
  const id = input.id ?? `toast-${seq}`;
  const item: ToastItem = {
    ...input,
    id,
    durationMs: input.durationMs === undefined ? DEFAULT_DURATION[input.tone] : input.durationMs,
  };
  const next = [item, ...toasts.filter((x) => x.id !== id)];
  for (const dropped of next.slice(MAX_VISIBLE_TOASTS)) clearTimer(dropped.id);
  toasts = next.slice(0, MAX_VISIBLE_TOASTS);
  clearTimer(id);
  if (item.durationMs !== null && typeof window !== "undefined") {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), item.durationMs),
    );
  }
  emit();
  return id;
}

export function clearToasts(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  toasts = [];
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): ToastItem[] {
  return toasts;
}

const EMPTY: ToastItem[] = [];
function getServerSnapshot(): ToastItem[] {
  return EMPTY;
}

/** 目前顯示中的 Toast（新的在前） */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
