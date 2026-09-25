/**
 * 時間格式化（第二十三節）。
 *
 * - DB 存 UTC timestamptz；推導一律用 epoch 毫秒；顯示一律 Asia/Taipei。
 * - 所有格式化都用 Intl.DateTimeFormat 明確指定 timeZone，不依賴執行環境（Vercel 跑在 UTC）。
 * - event_date + 'HH:mm' 一律視為 +08:00（TAIPEI_OFFSET）。
 */

import { TAIPEI_OFFSET, TIMEZONE } from "@/lib/constants";

// ---------------------------------------------------------------------
// Intl formatter（建立成本高，快取起來；Dashboard 每秒會呼叫很多次）
// ---------------------------------------------------------------------

let timeFormatter: Intl.DateTimeFormat | null = null;
let dateFormatter: Intl.DateTimeFormat | null = null;

function getTimeFormatter(): Intl.DateTimeFormat {
  if (!timeFormatter) {
    timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
  return timeFormatter;
}

function getDateFormatter(): Intl.DateTimeFormat {
  if (!dateFormatter) {
    dateFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return dateFormatter;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

interface TaipeiTimeParts {
  hour: string;
  minute: string;
  second: string;
}

function taipeiTimeParts(ms: number): TaipeiTimeParts {
  if (!Number.isFinite(ms)) throw new Error(`時間格式錯誤：${String(ms)}`);
  const parts = getTimeFormatter().formatToParts(new Date(ms));
  let hour = "00";
  let minute = "00";
  let second = "00";
  for (const p of parts) {
    if (p.type === "hour") hour = p.value === "24" ? "00" : p.value;
    else if (p.type === "minute") minute = p.value;
    else if (p.type === "second") second = p.value;
  }
  return { hour, minute, second };
}

// ---------------------------------------------------------------------
// 時刻
// ---------------------------------------------------------------------

/** 'HH:mm:ss'（Asia/Taipei）。打卡時間一律用這個（第二十三節）。 */
export function formatHms(ms: number): string {
  const p = taipeiTimeParts(ms);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 'HH:mm'（Asia/Taipei）。預定時段、下一隊時間可以只顯示到分。 */
export function formatHm(ms: number): string {
  const p = taipeiTimeParts(ms);
  return `${p.hour}:${p.minute}`;
}

/**
 * 剛好在整分時顯示 'HH:mm'，否則 'HH:mm:ss'（第二十三節）。
 * 例：晚開始的黃金 official_end = started_at + 15 分，常常不在整分，要顯示到秒。
 */
export function formatClockSmart(ms: number): string {
  return ms % 60_000 === 0 ? formatHm(ms) : formatHms(ms);
}

/** 時段範圍 '09:10–09:25'（en dash，與 SPEC 顯示一致） */
export function formatHmRange(startMs: number, endMs: number): string {
  return `${formatHm(startMs)}–${formatHm(endMs)}`;
}

/** 'YYYY-MM-DD'（Asia/Taipei 的日期） */
export function msToTaipeiDate(ms: number): string {
  if (!Number.isFinite(ms)) throw new Error(`時間格式錯誤：${String(ms)}`);
  const parts = getDateFormatter().formatToParts(new Date(ms));
  let y = "";
  let m = "";
  let d = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") d = p.value;
  }
  return `${y}-${m}-${d}`;
}

/** 'HH:mm:ss'（admin 修正時間表單的 <input type="time" step="1"> 用） */
export function msToTaipeiTimeInput(ms: number): string {
  return formatHms(ms);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

function taipeiOffsetMs(): number {
  const m = OFFSET_RE.exec(TAIPEI_OFFSET);
  if (!m) throw new Error(`TAIPEI_OFFSET 格式錯誤：${TAIPEI_OFFSET}`);
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000);
}

/**
 * 'YYYY-MM-DD' + 'HH:mm[:ss]' 視為 +08:00，轉成 epoch 毫秒。
 * 不依賴執行環境的時區（第二十三節）。格式不正確時 throw。
 */
export function taipeiLocalToMs(date: string, time: string): number {
  const dm = DATE_RE.exec(date.trim());
  if (!dm) throw new Error(`日期格式錯誤（應為 YYYY-MM-DD）：${date}`);
  const tm = TIME_RE.exec(time.trim());
  if (!tm) throw new Error(`時間格式錯誤（應為 HH:mm 或 HH:mm:ss）：${time}`);
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const second = tm[3] ? Number(tm[3]) : 0;
  const milli = tm[4] ? Number(tm[4].padEnd(3, "0")) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`日期不正確：${date}`);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`時間不正確：${time}`);
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, milli);
  // 檢查日期是否真的存在（例如 02-30 會被 Date.UTC 進位）
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`日期不存在：${date}`);
  }
  return utc - taipeiOffsetMs();
}

// ---------------------------------------------------------------------
// 長度（倒數、較預定）
// ---------------------------------------------------------------------

function formatClockLength(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

/**
 * 倒數 'MM:SS'（>= 1 小時 'H:MM:SS'）。
 * 取絕對值顯示；正數用 ceil 秒（剩 0.2 秒仍顯示 00:01，到 0 才顯示 00:00），
 * 負數用 floor 秒（超時 0.2 秒即顯示 00:01）。呼叫端依正負自行加「超時 +」之類的字樣。
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--";
  const seconds = ms >= 0 ? Math.ceil(ms / 1000) : -Math.floor(ms / 1000);
  return formatClockLength(seconds);
}

/**
 * 帶正負號的長度，例如較預定 '+00:18' / '-01:05'（第八節）。
 * 秒數無條件捨去（往 0 取整）；0 顯示 '+00:00'。
 */
/**
 * 固定長度（不是倒數）的 'MM:SS'：例如「本場縮短 03:00」「可玩 17:00」。
 * 取 floor 秒，與 formatSignedDuration（較預定）一致；倒數用 formatCountdown（ceil）。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--";
  return formatClockLength(Math.floor(Math.abs(ms) / 1000));
}

export function formatSignedDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--";
  const sign = ms < 0 ? "-" : "+";
  const seconds = Math.floor(Math.abs(ms) / 1000);
  return `${sign}${formatClockLength(seconds)}`;
}

/**
 * 中文長度文字：「10 分鐘」「1 分 30 秒」「45 秒」「1 小時 5 分鐘」。取絕對值、捨去到秒。
 * 用在延後標籤（「第3時段起已延後 10 分鐘」）等。
 */
export function formatDurationText(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    if (m === 0 && s === 0) return `${h} 小時`;
    if (s === 0) return `${h} 小時 ${m} 分鐘`;
    return `${h} 小時 ${m} 分 ${s} 秒`;
  }
  if (m > 0) return s === 0 ? `${m} 分鐘` : `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}
