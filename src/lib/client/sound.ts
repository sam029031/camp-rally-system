"use client";

/**
 * 聲音提醒（第十五、十七節）。
 *
 * - iOS / Android 需要使用者手勢才能播放：「開啟聲音」按鈕呼叫 unlockSound()（播放一段無聲音訊解鎖）；
 *   關主按進關等打卡按鈕本身也算手勢（use-check-action 會呼叫 unlockSound）。
 * - 未解鎖時 playSound() 什麼都不做，只靠畫面提示。
 * - 使用 WebAudio 產生短音，不需要音檔。
 */

import { useSyncExternalStore } from "react";

export type SoundKind = "warning" | "overtime" | "notification";

type AudioContextCtor = typeof AudioContext;

const PREF_KEY = "camp:sound-enabled";

let ctx: AudioContext | null = null;
let unlocked = false;
let gestureHookInstalled = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function getCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isSoundSupported(): boolean {
  return getCtor() !== null;
}

export function isSoundUnlocked(): boolean {
  return unlocked;
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function rememberPreference(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(PREF_KEY, "1");
    else window.localStorage.removeItem(PREF_KEY);
  } catch {
    // 私密瀏覽等情況無法寫入：忽略（只是偏好設定）
  }
}

function wantsSound(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

/** 已解鎖後，iOS 切到背景會把 AudioContext 暫停；之後任何一次觸控都順便恢復 */
function installGestureResume(): void {
  if (gestureHookInstalled || typeof window === "undefined") return;
  gestureHookInstalled = true;
  const resume = () => {
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => undefined);
    else if (!ctx && wantsSound()) void unlockSound();
  };
  window.addEventListener("pointerdown", resume, { passive: true });
  window.addEventListener("keydown", resume);
}

/**
 * 解鎖聲音。必須在使用者手勢（click / touch）的處理函式裡同步呼叫。
 * @returns 是否成功解鎖
 */
export async function unlockSound(): Promise<boolean> {
  const Ctor = getCtor();
  if (!Ctor) return false;
  try {
    if (!ctx) ctx = new Ctor();
    // 播放 1 個 sample 的無聲 buffer：iOS 解鎖音訊的標準做法
    const buffer = ctx.createBuffer(1, 1, 22_050);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
    if (ctx.state !== "running") await ctx.resume();
    const ok = (ctx.state as string) === "running";
    if (ok !== unlocked) {
      unlocked = ok;
      emit();
    }
    if (ok) {
      rememberPreference(true);
      installGestureResume();
    }
    return ok;
  } catch {
    return false;
  }
}

/** 使用者曾經開啟過聲音：頁面載入後第一次觸控就自動解鎖（仍需要手勢） */
export function armSoundFromPreference(): void {
  if (typeof window === "undefined" || unlocked) return;
  if (wantsSound()) installGestureResume();
}

interface Tone {
  freq: number;
  /** 開始時間（秒，相對） */
  at: number;
  dur: number;
}

const PATTERNS: Record<SoundKind, Tone[]> = {
  // 剩 2:00：兩聲中音
  warning: [
    { freq: 880, at: 0, dur: 0.16 },
    { freq: 880, at: 0.24, dur: 0.16 },
  ],
  // 時間到／超時：三聲高音
  overtime: [
    { freq: 1175, at: 0, dur: 0.2 },
    { freq: 1175, at: 0.28, dur: 0.2 },
    { freq: 1175, at: 0.56, dur: 0.32 },
  ],
  // 一般 A 類通知：上揚雙音
  notification: [
    { freq: 660, at: 0, dur: 0.14 },
    { freq: 990, at: 0.17, dur: 0.22 },
  ],
};

/** 播放短音；未解鎖或失敗時靜默略過（不能影響畫面提示） */
export function playSound(kind: SoundKind): void {
  if (!unlocked || !ctx) return;
  try {
    const c = ctx;
    if (c.state !== "running") void c.resume().catch(() => undefined);
    const t0 = c.currentTime + 0.02;
    for (const tone of PATTERNS[kind]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "square";
      osc.frequency.value = tone.freq;
      const start = t0 + tone.at;
      const end = start + tone.dur;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.015);
      gain.gain.setValueAtTime(0.28, end - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // 靜默略過
  }
}

function getServerSnapshot(): boolean {
  return false;
}

/** React：聲音是否已解鎖 */
export function useSoundUnlocked(): boolean {
  return useSyncExternalStore(subscribeSound, isSoundUnlocked, getServerSnapshot);
}
