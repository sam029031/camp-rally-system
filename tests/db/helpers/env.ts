/**
 * 資料庫測試的環境變數（SPEC 第三十節）。
 *
 * - 只讀 SUPABASE_TEST_URL 與 SUPABASE_TEST_SERVICE_ROLE_KEY 這兩個專用變數（SUPABASE_TEST_ANON_KEY 可選，
 *   用來測「anon 不能寫入」）；絕不沿用 NEXT_PUBLIC_SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY。
 * - 沒有設定 → 印出原因並 skip（不 fail、也不假裝通過）。
 * - 和正式用的變數相同 → 直接 throw（測試檔失敗），提示改用另一個測試用 project。
 * - .env.local 用 dotenv 載入，但不覆蓋已經存在的 process.env（命令列指定的值優先）。
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";

export interface DbTestEnv {
  url: string;
  serviceKey: string;
  anonKey: string | null;
}

export type DbEnvResolution = { kind: "ok"; env: DbTestEnv } | { kind: "skip"; reason: string };

export class DbTestEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbTestEnvError";
  }
}

type EnvLike = Record<string, string | undefined>;

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

/** URL 比較用：去掉結尾斜線、小寫，localhost 與 127.0.0.1 視為相同 */
function urlKey(v: string): string {
  const raw = v.trim();
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase() === "localhost" ? "127.0.0.1" : u.hostname.toLowerCase();
    const port = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${host}:${port}${pathname}`;
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

/** 純函式：依環境變數決定 run / skip / throw（env-guard.test.ts 直接測它） */
export function resolveDbTestEnv(env: EnvLike): DbEnvResolution {
  const url = clean(env.SUPABASE_TEST_URL);
  const serviceKey = clean(env.SUPABASE_TEST_SERVICE_ROLE_KEY);

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_TEST_URL");
  if (!serviceKey) missing.push("SUPABASE_TEST_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    return {
      kind: "skip",
      reason:
        `未設定 ${missing.join("、")}，略過資料庫測試（tests/db）。` +
        "要執行時請在命令列指定專用的測試 Supabase（例如 npx supabase start 的本機 DB 或另開的測試 project），" +
        "不可以使用正式 project；詳見 README。",
    };
  }

  const prodUrl = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  if (prodUrl && urlKey(prodUrl) === urlKey(url)) {
    throw new DbTestEnvError(
      `SUPABASE_TEST_URL（${url}）與 NEXT_PUBLIC_SUPABASE_URL 相同。` +
        "資料庫測試會建立與刪除資料，不可以對 App 正在使用的 Supabase 執行；" +
        "請改用另一個測試用 project（或本機 npx supabase start），" +
        "或在命令列把 NEXT_PUBLIC_SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY 設為空值後再執行。",
    );
  }
  const prodKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (prodKey && prodKey === serviceKey) {
    throw new DbTestEnvError(
      "SUPABASE_TEST_SERVICE_ROLE_KEY 與 SUPABASE_SERVICE_ROLE_KEY 相同。" +
        "資料庫測試必須使用另一個測試用 project 的 service role key，" +
        "或在命令列把 NEXT_PUBLIC_SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY 設為空值後再執行。",
    );
  }

  const anonKey = clean(env.SUPABASE_TEST_ANON_KEY) || null;
  return { kind: "ok", env: { url, serviceKey, anonKey } };
}

/** 載入 .env.local（不覆蓋已存在的 process.env），再判斷 */
function resolveFromProcessEnv(): DbEnvResolution {
  loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: false, quiet: true });
  return resolveDbTestEnv(process.env);
}

/**
 * 每個 DB 測試檔在最上層呼叫：
 * - 回傳 null → 用 describe.skipIf(!env) 略過（原因由 env-guard.test.ts 統一印一次）
 * - 設定和正式變數相同 → throw（該測試檔失敗並顯示原因）
 */
export function loadDbTestEnv(): DbTestEnv | null {
  const r = resolveFromProcessEnv();
  return r.kind === "ok" ? r.env : null;
}

/**
 * 印出 DB 測試會不會執行（env-guard.test.ts 呼叫，整個 tests/db 只印這一次）。
 * 用 process.stderr：vitest 不顯示被 skip 的測試檔裡的 console 輸出。
 */
export function reportDbTestEnvStatus(): void {
  let line: string;
  try {
    const r = resolveFromProcessEnv();
    line = r.kind === "skip" ? r.reason : `資料庫測試將連線到 ${r.env.url}（anon 測試：${r.env.anonKey ? "執行" : "略過"}）。`;
  } catch (e) {
    line = e instanceof Error ? e.message : String(e);
  }
  process.stderr.write(`[tests/db] ${line}\n`);
}
