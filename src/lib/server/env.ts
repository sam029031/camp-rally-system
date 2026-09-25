import "server-only";

/**
 * Server 端環境變數（第二十節、第三十二節）。
 * SUPABASE_SERVICE_ROLE_KEY / SESSION_SECRET 只能在 server 讀取；本檔 import "server-only"，
 * client component 誤 import 時 build 會直接失敗。
 *
 * 全部用函式延遲讀取：`next build` 收集路由時不需要真的環境變數，缺少時在第一次使用時大聲失敗。
 */

/** SESSION_SECRET 最短長度（HS256 建議至少 256 bits） */
export const MIN_SESSION_SECRET_LENGTH = 32;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    const msg = `[env] 缺少環境變數 ${name}，請在 .env.local（本機）或 Vercel Project Settings → Environment Variables 設定。`;
    console.error(msg);
    throw new Error(msg);
  }
  return value.trim();
}

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getSessionSecret(): string {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    const msg = `[env] SESSION_SECRET 太短（目前 ${secret.length} 字元，至少需要 ${MIN_SESSION_SECRET_LENGTH} 字元），例如用 openssl rand -base64 48 產生。`;
    console.error(msg);
    throw new Error(msg);
  }
  return secret;
}

/** APP_ENV：development | demo | production；未設定視同 production */
export function getAppEnv(): string {
  const v = process.env.APP_ENV?.trim();
  return v && v !== "" ? v : "production";
}

/** 只有 development / demo 允許開啟 Demo 時鐘與 Reset（第二十五、三十一節）；未設定 → false */
export function isDemoAllowed(): boolean {
  const v = process.env.APP_ENV?.trim();
  return v === "development" || v === "demo";
}

/** .env 的 EVENT_DATE（只當沒有 active event 時的後備值），格式錯誤回 null */
export function getEnvEventDate(): string | null {
  const v = process.env.EVENT_DATE?.trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
