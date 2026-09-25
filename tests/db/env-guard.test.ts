/**
 * DB 測試的環境變數防呆（SPEC 第三十節）：純函式，不連資料庫，一律執行。
 * 同時印出一次「這次 DB 測試會不會執行、原因」（其他 DB 測試檔 skip 時不重複印）。
 */
import { describe, expect, it } from "vitest";
import { DbTestEnvError, reportDbTestEnvStatus, resolveDbTestEnv } from "./helpers/env";

reportDbTestEnvStatus();

const TEST_URL = "http://127.0.0.1:54321";
const TEST_KEY = "test-service-role";

describe("resolveDbTestEnv", () => {
  it("沒有設定測試專用變數 → skip 並說明原因（不 fail）", () => {
    const r = resolveDbTestEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "prod" });
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") {
      expect(r.reason).toContain("SUPABASE_TEST_URL");
      expect(r.reason).toContain("SUPABASE_TEST_SERVICE_ROLE_KEY");
    }
  });

  it("只設定其中一個、或是空字串 → skip", () => {
    expect(resolveDbTestEnv({ SUPABASE_TEST_URL: TEST_URL }).kind).toBe("skip");
    expect(resolveDbTestEnv({ SUPABASE_TEST_URL: "  ", SUPABASE_TEST_SERVICE_ROLE_KEY: TEST_KEY }).kind).toBe("skip");
  });

  it("絕不沿用正式變數：只有 NEXT_PUBLIC_SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY 時 skip", () => {
    const r = resolveDbTestEnv({ NEXT_PUBLIC_SUPABASE_URL: TEST_URL, SUPABASE_SERVICE_ROLE_KEY: TEST_KEY });
    expect(r.kind).toBe("skip");
  });

  it("SUPABASE_TEST_URL 與 NEXT_PUBLIC_SUPABASE_URL 相同 → throw", () => {
    expect(() =>
      resolveDbTestEnv({
        SUPABASE_TEST_URL: TEST_URL,
        SUPABASE_TEST_SERVICE_ROLE_KEY: TEST_KEY,
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321/",
      }),
    ).toThrow(DbTestEnvError);
  });

  it("SUPABASE_TEST_SERVICE_ROLE_KEY 與 SUPABASE_SERVICE_ROLE_KEY 相同 → throw", () => {
    expect(() =>
      resolveDbTestEnv({
        SUPABASE_TEST_URL: TEST_URL,
        SUPABASE_TEST_SERVICE_ROLE_KEY: TEST_KEY,
        NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: TEST_KEY,
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("不同的 project → ok（anon key 可選）", () => {
    const r = resolveDbTestEnv({
      SUPABASE_TEST_URL: TEST_URL,
      SUPABASE_TEST_SERVICE_ROLE_KEY: TEST_KEY,
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "prod",
    });
    expect(r).toEqual({ kind: "ok", env: { url: TEST_URL, serviceKey: TEST_KEY, anonKey: null } });
    const withAnon = resolveDbTestEnv({
      SUPABASE_TEST_URL: TEST_URL,
      SUPABASE_TEST_SERVICE_ROLE_KEY: TEST_KEY,
      SUPABASE_TEST_ANON_KEY: "anon",
    });
    expect(withAnon.kind === "ok" && withAnon.env.anonKey).toBe("anon");
  });
});
