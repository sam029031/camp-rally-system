import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import type { SessionPayload } from "@/lib/types";
import {
  computeSessionExp,
  MIN_SESSION_MS,
  signSessionToken,
  verifySessionToken,
} from "@/lib/server/session-token";
import { homePathForSession } from "@/lib/server/session-info";

const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const OTHER = "other-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const DURING_EVENT = Date.parse("2026-10-17T01:00:00Z");

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    identityId: "11111111-1111-4111-8111-111111111111",
    role: "STATION",
    stationId: "22222222-2222-4222-8222-222222222222",
    teamId: null,
    pinVersion: 3,
    exp: Math.floor(Date.parse("2026-10-17T15:59:59Z") / 1000),
    ...overrides,
  };
}

describe("computeSessionExp（第二十節：至少維持到活動當天結束）", () => {
  it("活動前一天登入 → 到活動日 23:59:59 +08:00", () => {
    const now = Date.parse("2026-10-16T02:00:00Z");
    expect(computeSessionExp("2026-10-17", now)).toBe(Math.floor(Date.parse("2026-10-17T23:59:59+08:00") / 1000));
  });

  it("活動當天晚上登入 → 至少 24 小時", () => {
    const now = Date.parse("2026-10-17T14:00:00Z"); // 台北 22:00
    expect(computeSessionExp("2026-10-17", now)).toBe(Math.floor((now + MIN_SESSION_MS) / 1000));
  });

  it("活動日未知或格式錯誤 → now + 24h", () => {
    const now = Date.parse("2026-09-25T00:00:00Z");
    expect(computeSessionExp(null, now)).toBe(Math.floor((now + MIN_SESSION_MS) / 1000));
    expect(computeSessionExp("2026-13-40", now)).toBe(Math.floor((now + MIN_SESSION_MS) / 1000));
  });
});

describe("signSessionToken / verifySessionToken", () => {
  it("簽章後可以驗回同一份內容", async () => {
    const p = payload();
    const token = await signSessionToken(p, SECRET);
    await expect(verifySessionToken(token, SECRET, DURING_EVENT)).resolves.toEqual(p);
  });

  it("TEAM / ADMIN 的 null 欄位保留", async () => {
    const team = payload({ role: "TEAM", stationId: null, teamId: "33333333-3333-4333-8333-333333333333" });
    await expect(verifySessionToken(await signSessionToken(team, SECRET), SECRET, DURING_EVENT)).resolves.toEqual(team);
    const admin = payload({ role: "ADMIN", stationId: null, teamId: null });
    await expect(verifySessionToken(await signSessionToken(admin, SECRET), SECRET, DURING_EVENT)).resolves.toEqual(admin);
  });

  it("secret 不同 → null", async () => {
    const token = await signSessionToken(payload(), SECRET);
    await expect(verifySessionToken(token, OTHER, DURING_EVENT)).resolves.toBeNull();
  });

  it("過期 → null", async () => {
    const p = payload();
    const token = await signSessionToken(p, SECRET);
    await expect(verifySessionToken(token, SECRET, (p.exp + 5) * 1000)).resolves.toBeNull();
  });

  it("被竄改（改 role）→ null", async () => {
    const token = await signSessionToken(payload(), SECRET);
    const [h, body, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    decoded.role = "ADMIN";
    const tampered = [h, Buffer.from(JSON.stringify(decoded)).toString("base64url"), sig].join(".");
    await expect(verifySessionToken(tampered, SECRET, DURING_EVENT)).resolves.toBeNull();
  });

  it("亂碼 → null", async () => {
    await expect(verifySessionToken("not-a-jwt", SECRET)).resolves.toBeNull();
    await expect(verifySessionToken("", SECRET)).resolves.toBeNull();
  });

  it("簽章正確但內容形狀不對（沒有 pinVersion、未知 role）→ null", async () => {
    const key = new TextEncoder().encode(SECRET);
    const exp = Math.floor(Date.parse("2026-10-18T00:00:00Z") / 1000);
    const noPin = await new SignJWT({ identityId: "x", role: "ADMIN", stationId: null, teamId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("camp-rally")
      .setExpirationTime(exp)
      .sign(key);
    await expect(verifySessionToken(noPin, SECRET, DURING_EVENT)).resolves.toBeNull();
    const badRole = await new SignJWT({ identityId: "x", role: "ROOT", stationId: null, teamId: null, pinVersion: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("camp-rally")
      .setExpirationTime(exp)
      .sign(key);
    await expect(verifySessionToken(badRole, SECRET, DURING_EVENT)).resolves.toBeNull();
  });

  it("issuer 不同（別的系統簽的）→ null", async () => {
    const key = new TextEncoder().encode(SECRET);
    const p = payload();
    const foreign = await new SignJWT({ ...p })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("someone-else")
      .setExpirationTime(p.exp)
      .sign(key);
    await expect(verifySessionToken(foreign, SECRET, DURING_EVENT)).resolves.toBeNull();
  });
});

describe("homePathForSession（登入後導向）", () => {
  it("依角色導向", () => {
    expect(
      homePathForSession({
        role: "STATION",
        station: { id: "s", code: "A", name: "九九乘法", gameCode: "gold", gameId: "g" },
      }),
    ).toBe("/station/gold/A");
    expect(homePathForSession({ role: "TEAM", station: null })).toBe("/team");
    expect(homePathForSession({ role: "ADMIN", station: null })).toBe("/admin");
    expect(homePathForSession({ role: "VIEWER", station: null })).toBe("/dashboard");
  });
});
