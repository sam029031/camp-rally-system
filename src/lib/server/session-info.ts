/**
 * SessionInfo 相關純函式（server component 與 route 共用；單元測試可直接 import）。
 */
import type { SessionInfo } from "@/lib/types";

/** 登入後／首頁導向（第二十節「登入後自動導向自己的關卡頁／隊伍頁」、ARCHITECTURE 第 7 節） */
export function homePathForSession(info: Pick<SessionInfo, "role" | "station">): string {
  switch (info.role) {
    case "STATION":
      return info.station
        ? `/station/${info.station.gameCode}/${encodeURIComponent(info.station.code)}`
        : "/dashboard";
    case "TEAM":
      return "/team";
    case "ADMIN":
      return "/admin";
    case "VIEWER":
    default:
      return "/dashboard";
  }
}
