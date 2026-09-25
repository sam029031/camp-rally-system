import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";

/**
 * Service role client（第二十節：所有寫入都經 server，用 SUPABASE_SERVICE_ROLE_KEY 呼叫 RPC）。
 * 不保存 session、不自動 refresh token；同一個 lambda 內重用同一個 instance。
 * 所有請求一律 no-store：狀態必須是最新的（第二十七節），不可被任何 fetch cache 攔下。
 */
let cached: SupabaseClient | null = null;

const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: noStoreFetch, headers: { "x-client-info": "camp-rally-server" } },
  });
  return cached;
}
