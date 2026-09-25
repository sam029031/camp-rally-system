import { compare } from "bcryptjs";
import type { NextRequest } from "next/server";
import { DEVICE_COOKIE } from "@/lib/constants";
import { ApiHttpError, badRequest } from "@/lib/server/errors";
import { buildSessionInfo } from "@/lib/server/auth";
import { getActiveEvent, getIdentityWithHash } from "@/lib/server/db";
import { getEnvEventDate } from "@/lib/server/env";
import { apiRoute, jsonError, jsonOk, readJsonBody } from "@/lib/server/http";
import { callRpc, RpcFailure } from "@/lib/server/rpc";
import { computeSessionExp, setDeviceCookie, setSessionCookie, signSession } from "@/lib/server/session";
import { homePathForSession } from "@/lib/server/session-info";
import { getServiceClient } from "@/lib/server/supabase";
import { isUuid, parseLoginRequest } from "@/lib/server/validate";

/** begin_login_attempt 的回傳 */
interface BeginLoginAttempt {
  locked: boolean;
  retryAfterSeconds: number;
  attemptId: number | null;
}

function parseBeginLoginAttempt(data: unknown): BeginLoginAttempt {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { locked?: unknown; retry_after_seconds?: unknown; attempt_id?: unknown }
    | null
    | undefined;
  if (!row || typeof row !== "object" || typeof row.locked !== "boolean") {
    throw new RpcFailure("begin_login_attempt", `回傳格式不正確：${JSON.stringify(data)}`);
  }
  const rawId = row.attempt_id;
  const attemptId =
    typeof rawId === "number" && Number.isSafeInteger(rawId)
      ? rawId
      : typeof rawId === "string" && /^\d+$/.test(rawId)
        ? Number(rawId)
        : null;
  return { locked: row.locked, retryAfterSeconds: Number(row.retry_after_seconds) || 0, attemptId };
}

/**
 * POST /api/auth/login（第二十節）
 * 1. 讀取所選 identity（不存在 400、停用 403；這兩種不算登入嘗試。先讀是為了不把不存在的
 *    identity_id 寫進 login_attempts 的外鍵欄位）
 * 2. begin_login_attempt：在 DB 內以 advisory lock（identity → device 固定順序）判斷鎖定並先寫一筆
 *    「待定」嘗試（success = false）。任一在 60 秒內失敗 >= 5 次（待定的也算）→ 423。
 *    判斷與寫入在同一個 transaction，同時送出的多個請求不會一起繞過 5 次上限。
 * 3. 只比對所選那一個 identity 的 bcrypt hash（bcryptjs）
 * 4. finish_login_attempt(attempt_id, matched)：寫回結果；失敗時由它寫 audit LOGIN_FAILED → 401
 * 5. 成功：簽發 camp_session cookie，回傳 SessionInfo 與導向路徑
 */
export const POST = apiRoute("POST /api/auth/login", async (req: NextRequest) => {
  const { identityId, pin } = parseLoginRequest(await readJsonBody(req));
  const client = getServiceClient();

  // device_id：proxy 會先發；萬一沒有（例如直接呼叫 API）就在這裡補發
  const existingDevice = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice && isUuid(existingDevice) ? existingDevice : crypto.randomUUID();
  const issueDevice = deviceId !== existingDevice;

  const identity = await getIdentityWithHash(client, identityId);
  if (!identity) throw badRequest("找不到這個身分，請重新整理登入頁。");
  if (!identity.is_active) throw new ApiHttpError(403, "IDENTITY_INACTIVE");

  const begin = parseBeginLoginAttempt(
    await callRpc<unknown>(client, "begin_login_attempt", {
      p_device_id: deviceId,
      p_identity_id: identity.id,
    }),
  );
  if (begin.locked) {
    const retry = Math.max(1, Math.ceil(begin.retryAfterSeconds || 60));
    throw new ApiHttpError(423, "LOGIN_LOCKED", `錯誤次數太多，請 ${retry} 秒後再試。`);
  }
  if (begin.attemptId === null) {
    throw new RpcFailure("begin_login_attempt", "未鎖定但沒有回傳 attempt_id");
  }

  // 若 bcrypt 或之後的步驟丟例外，待定的嘗試會一直算成失敗（60 秒後自然過期），不會讓人多試
  const matched = await compare(pin, identity.pin_hash);

  await callRpc<null>(client, "finish_login_attempt", {
    p_attempt_id: begin.attemptId,
    p_success: matched,
  });

  if (!matched) {
    // audit LOGIN_FAILED 由 finish_login_attempt 在同一個 transaction 內寫入，這裡不重複寫
    // 失敗時也要帶回新發的 device cookie，否則鎖定計數會因每次換新 device 而歸零
    const res = jsonError(new ApiHttpError(401, "LOGIN_INVALID_PIN"), req);
    if (issueDevice) setDeviceCookie(res, deviceId, req);
    return res;
  }

  const activeEvent = await getActiveEvent(client);
  const exp = computeSessionExp(activeEvent?.event_date ?? getEnvEventDate(), Date.now());
  const token = await signSession({
    identityId: identity.id,
    role: identity.role,
    stationId: identity.station_id,
    teamId: identity.team_id,
    pinVersion: identity.pin_version,
    exp,
  });
  const session = await buildSessionInfo(client, identity);

  const res = jsonOk({ session, redirectTo: homePathForSession(session) });
  setSessionCookie(res, token, exp, req);
  if (issueDevice) setDeviceCookie(res, deviceId, req);
  return res;
});
