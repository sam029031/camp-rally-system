import { apiRoute, jsonOk } from "@/lib/server/http";
import { clearSessionCookie } from "@/lib/server/session";

/** POST /api/auth/logout：清掉 camp_session（不影響同一組 PIN 的其他裝置） */
export const POST = apiRoute("POST /api/auth/logout", async (req) => {
  const res = jsonOk({});
  clearSessionCookie(res, req);
  return res;
});
