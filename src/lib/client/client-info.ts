import type { ClientInfo } from "@/lib/api/contract";

/**
 * 簡短裝置資訊（第六節：check_records.client_info 所有人都讀得到，不存 IP）。
 * 手機時間只放在這裡當參考，正式時間一律由 DB 的 app_now() 產生。
 */
export function getClientInfo(): ClientInfo {
  if (typeof navigator === "undefined") return {};
  const info: ClientInfo = {};
  try {
    info.ua = (navigator.userAgent || "").slice(0, 160);
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
    const platform = uaData?.platform || navigator.platform || "";
    if (platform) info.platform = `${platform}${uaData?.mobile ? " (mobile)" : ""}`.slice(0, 60);
    if (typeof screen !== "undefined") {
      const dpr = typeof window !== "undefined" && window.devicePixelRatio ? `@${Math.round(window.devicePixelRatio * 100) / 100}x` : "";
      info.screen = `${screen.width}x${screen.height}${dpr}`;
    }
    info.deviceTime = new Date().toISOString();
  } catch {
    // 取不到就算了
  }
  return info;
}
