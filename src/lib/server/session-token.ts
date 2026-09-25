/**
 * Session token（jose HS256）純函式：簽章、驗證、到期時間（第二十節）。
 * secret 由呼叫端傳入（src/lib/server/session.ts 從 env 讀），因此這裡可以直接做單元測試。
 */
import { SignJWT, jwtVerify } from "jose";
import type { Role, SessionPayload } from "@/lib/types";
import { endOfTaipeiDayMs, isValidDateString } from "@/lib/server/time-input";

const ALG = "HS256";
const ISSUER = "camp-rally";
const ROLES: readonly Role[] = ["ADMIN", "STATION", "TEAM", "VIEWER"];
/** session 最短 24 小時 */
export const MIN_SESSION_MS = 24 * 60 * 60 * 1000;

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * 到期時間（epoch 秒）= max(活動日 23:59:59 +08:00, now + 24h)（第二十節「至少維持到活動當天結束」）。
 * 活動日未知時只用 now + 24h。
 */
export function computeSessionExp(eventDate: string | null, nowMs: number): number {
  const minExp = nowMs + MIN_SESSION_MS;
  const eventEnd = eventDate && isValidDateString(eventDate) ? endOfTaipeiDayMs(eventDate) : -Infinity;
  return Math.floor(Math.max(minExp, eventEnd) / 1000);
}

export async function signSessionToken(payload: SessionPayload, secret: string): Promise<string> {
  return new SignJWT({
    identityId: payload.identityId,
    role: payload.role,
    stationId: payload.stationId,
    teamId: payload.teamId,
    pinVersion: payload.pinVersion,
  })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(payload.identityId)
    .setIssuedAt()
    .setExpirationTime(payload.exp)
    .sign(keyOf(secret));
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/**
 * 驗證 token；簽章錯誤、過期、內容形狀不對一律回 null（呼叫端當成未登入／已失效）。
 * nowMs 只給測試用（預設真實時間：session 到期屬於「操作類」時間，不跟 Demo 時鐘）。
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowMs?: number,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: [ALG],
      issuer: ISSUER,
      currentDate: nowMs === undefined ? undefined : new Date(nowMs),
    });
    const { identityId, role, stationId, teamId, pinVersion, exp } = payload as Record<string, unknown>;
    if (
      typeof identityId !== "string" ||
      typeof role !== "string" ||
      !(ROLES as readonly string[]).includes(role) ||
      !isNullableString(stationId) ||
      !isNullableString(teamId) ||
      typeof pinVersion !== "number" ||
      !Number.isInteger(pinVersion) ||
      typeof exp !== "number"
    ) {
      return null;
    }
    return { identityId, role: role as Role, stationId, teamId, pinVersion, exp };
  } catch {
    // 簽章錯誤、過期、亂碼、演算法不符：一律視為無效
    return null;
  }
}
