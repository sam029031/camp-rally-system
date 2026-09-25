import { randomInt } from "node:crypto";
import { hash } from "bcryptjs";
import type { NextRequest } from "next/server";
import { PIN_LENGTH } from "@/lib/constants";
import type { Role } from "@/lib/types";
import { requireAdmin } from "@/lib/server/auth";
import { getIdentity, type IdentityPublic } from "@/lib/server/db";
import { notFound } from "@/lib/server/errors";
import { apiRoute, jsonOk, readJsonBody } from "@/lib/server/http";
import { listIdentityEntries } from "@/lib/server/identity-list";
import { asStatusResult, callRpc, RpcFailure, throwIfRejected } from "@/lib/server/rpc";
import { setSessionCookie, signSession } from "@/lib/server/session";
import { getServiceClient } from "@/lib/server/supabase";
import { parseAdminResetPins } from "@/lib/server/validate";

/** bcrypt cost（bcryptjs 純 JS：10 約 60~100ms／筆，全部重設 38 筆仍在數秒內） */
const BCRYPT_ROUNDS = 10;

function randomPin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

/**
 * POST /api/admin/pins/reset：重設此 PIN／重設全部 PIN／指定新 PIN（第二十五節）。
 * - DB 只存 bcrypt hash；新 PIN 只出現在這次回應。
 * - 先在記憶體產生全部 PIN 與 hash，再以「一次」set_identity_pins 呼叫（單一 transaction）寫入：
 *   要嘛全部換新、要嘛全部不動。被拒絕時不回傳任何 PIN，避免總召拿到一份只有部分生效的 PIN 總表。
 * - set_identity_pins 會把每個身分的 pin_version + 1，該身分所有裝置都要重新登入（第二十節）。
 * - 總召重設到自己的 PIN 時，讀回新的 pin_version 換發自己的 cookie，才不會在列印 PIN 總表時被登出。
 */
export const POST = apiRoute("POST /api/admin/pins/reset", async (req: NextRequest) => {
  const { session } = await requireAdmin(req);
  const body = parseAdminResetPins(await readJsonBody(req));
  const client = getServiceClient();

  let targets: IdentityPublic[];
  if (body.all) {
    targets = (await listIdentityEntries(client, { includeInactive: false })).map((e) => e.identity);
  } else {
    const one = await getIdentity(client, body.identityId as string);
    if (!one) throw notFound("找不到這個身分。");
    targets = [one];
  }
  if (targets.length === 0) return jsonOk({ pins: [] });

  // 1. 先產生全部 PIN 與 hash（bcrypt 慢，不放在 transaction 內）
  const pins: Array<{ identityId: string; label: string; role: Role; pin: string }> = [];
  const hashes: string[] = [];
  for (const idn of targets) {
    const pin = body.pin ?? randomPin();
    hashes.push(await hash(pin, BCRYPT_ROUNDS));
    pins.push({ identityId: idn.id, label: idn.label, role: idn.role, pin });
  }

  // 2. 一次寫入（全有或全無）
  const r = asStatusResult(
    "set_identity_pins",
    await callRpc<unknown>(client, "set_identity_pins", {
      p_ids: targets.map((t) => t.id),
      p_hashes: hashes,
      p_actor: session.identityId,
    }),
  );
  throwIfRejected("set_identity_pins", r, (code) =>
    code === "NOT_FOUND" ? "有身分已被刪除，請重新整理後再試；這次沒有任何 PIN 被更改。" : undefined,
  );
  if (r.status !== "ok") {
    throw new RpcFailure("set_identity_pins", `未預期的回傳：${JSON.stringify(r)}`);
  }

  // 3. 成功才回傳 PIN；總召自己的 PIN 被換掉時換發 cookie（pin_version 以 DB 讀回的為準）
  const res = jsonOk({ pins });
  if (targets.some((t) => t.id === session.identityId)) {
    // PIN 已經寫入：這裡失敗也一定要把 PIN 回傳給總召（最壞只是自己要用新 PIN 重新登入）
    try {
      const me = await getIdentity(client, session.identityId);
      if (me && me.is_active) {
        const token = await signSession({ ...session, pinVersion: me.pin_version });
        setSessionCookie(res, token, session.exp, req);
      }
    } catch (e) {
      console.error("[api] POST /api/admin/pins/reset 換發總召 cookie 失敗", e);
    }
  }
  return res;
});
