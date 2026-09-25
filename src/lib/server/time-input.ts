/**
 * Server 端時間輸入轉換（純函式，單元測試見 tests/unit/server-time-input.test.ts）。
 *
 * 第二十三節：event_date + 'HH:mm' 一律視為 +08:00，不依賴執行環境時區（Vercel 跑在 UTC）。
 */
import { TAIPEI_OFFSET, TIMEZONE } from "@/lib/constants";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** 'YYYY-MM-DD' 且是真實存在的日期 */
export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 'HH:mm' 或 'HH:mm:ss' → { h, m, s }；格式錯誤回 null */
export function parseTimeOfDay(s: string): { h: number; m: number; s: number } | null {
  const t = TIME_RE.exec(s.trim());
  if (!t) return null;
  return { h: Number(t[1]), m: Number(t[2]), s: t[3] ? Number(t[3]) : 0 };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 活動日（Asia/Taipei）的 'HH:mm[:ss]' → epoch ms。
 * 例：('2026-10-17', '09:20') → 2026-10-17T01:20:00Z
 */
export function taipeiDateTimeToMs(eventDate: string, time: string): number {
  if (!isValidDateString(eventDate)) throw new Error(`活動日期格式不正確：${eventDate}`);
  const t = parseTimeOfDay(time);
  if (!t) throw new Error(`時間格式不正確：${time}`);
  return Date.parse(`${eventDate}T${pad2(t.h)}:${pad2(t.m)}:${pad2(t.s)}${TAIPEI_OFFSET}`);
}

/** 同上，回傳 ISO（給 RPC 的 timestamptz 參數） */
export function taipeiDateTimeToIso(eventDate: string, time: string): string {
  return new Date(taipeiDateTimeToMs(eventDate, time)).toISOString();
}

/**
 * Demo「跳到指定時刻」：'HH:mm[:ss]'（活動日 +08:00）或帶時區的 ISO 字串 → ISO（第三十一節）。
 */
export function resolveJumpTo(eventDate: string, input: string): string {
  const trimmed = input.trim();
  if (parseTimeOfDay(trimmed)) return taipeiDateTimeToIso(eventDate, trimmed);
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) throw new Error(`時間格式不正確：${input}`);
  return new Date(ms).toISOString();
}

/** 活動日當天最後一秒（+08:00）的 epoch ms */
export function endOfTaipeiDayMs(eventDate: string): number {
  return taipeiDateTimeToMs(eventDate, "23:59:59");
}

/** DB 回傳的 timestamptz 字串（可能帶 6 位小數）→ epoch ms；無法解析回 null */
export function parseDbTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  // 小數秒超過 3 位時截斷，避免不同 JS 引擎解析差異
  const normalized = value.replace(/(\.\d{3})\d+/, "$1").replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** epoch ms → 'YYYY-MM-DD HH:mm:ss'（Asia/Taipei；CSV 匯出用） */
export function formatTaipeiDateTime(ms: number): string {
  const parts: Record<string, string> = {};
  for (const p of dateTimeFormatter.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** DB 時間字串 → 'YYYY-MM-DD HH:mm:ss'（Asia/Taipei）；null → '' */
export function formatDbTimestampTaipei(value: unknown): string {
  const ms = parseDbTimestamp(value);
  return ms === null ? "" : formatTaipeiDateTime(ms);
}
