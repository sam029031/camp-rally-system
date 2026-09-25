import type { LoginOption } from "@/lib/api/contract";
import { GAME_NAMES } from "@/lib/constants";
import { ROLE_LABEL } from "@/lib/labels";
import type { GameCode, Role } from "@/lib/types";

/** 登入頁的步驟 */
export type LoginStep = "role" | "game" | "station" | "team" | "identity" | "pin";

/** 身分類型按鈕的順序（第二十節：關主／隊輔／總召／唯讀） */
export const ROLE_ORDER: readonly Role[] = ["STATION", "TEAM", "ADMIN", "VIEWER"];

export const ROLE_DESCRIPTION: Record<Role, string> = {
  STATION: "負責一個關卡，按確認進關／出關",
  TEAM: "帶小隊跑關，按確認抵達／出關",
  ADMIN: "管理全場、修正紀錄、調整排程",
  VIEWER: "只看全場 Dashboard，不能操作",
};

export interface GameChoice {
  code: GameCode;
  name: string;
  stationCount: number;
}

export function optionsForRole(options: readonly LoginOption[], role: Role): LoginOption[] {
  return options.filter((o) => o.role === role);
}

/** 有關主身分的遊戲（依 server 排序：遊戲順序） */
export function stationGames(options: readonly LoginOption[]): GameChoice[] {
  const out: GameChoice[] = [];
  for (const o of options) {
    if (o.role !== "STATION" || !o.gameCode) continue;
    const found = out.find((g) => g.code === o.gameCode);
    if (found) found.stationCount += 1;
    else out.push({ code: o.gameCode, name: o.gameName ?? GAME_NAMES[o.gameCode], stationCount: 1 });
  }
  return out;
}

export function stationsForGame(options: readonly LoginOption[], game: GameCode): LoginOption[] {
  return options.filter((o) => o.role === "STATION" && o.gameCode === game);
}

/** 隊伍按鈕上的名稱（第1~13小隊、幹部隊） */
export function teamOptionName(o: LoginOption): string {
  return o.teamName ?? o.label;
}

/** PIN 步驟上方顯示的「你選的身分」 */
export function selectionSummary(o: LoginOption): { roleLabel: string; title: string; subtitle: string | null } {
  const roleLabel = ROLE_LABEL[o.role];
  if (o.role === "STATION") {
    const game = o.gameName ?? (o.gameCode ? GAME_NAMES[o.gameCode] : "");
    const station = [o.stationCode, o.stationName].filter(Boolean).join(" ");
    return { roleLabel, title: station || o.label, subtitle: game || null };
  }
  if (o.role === "TEAM") return { roleLabel, title: teamOptionName(o), subtitle: "黃金傳奇、大地遊戲共用" };
  return { roleLabel, title: o.label, subtitle: null };
}

/**
 * 某個身分類型選完後的下一步；只有一個選項（總召、唯讀）時直接選好並跳到 PIN。
 */
export function stepAfterRole(
  options: readonly LoginOption[],
  role: Role,
): { step: LoginStep; identityId: string | null; game: GameCode | null } {
  if (role === "STATION") {
    const games = stationGames(options);
    if (games.length === 1) return { step: "station", identityId: null, game: games[0].code };
    return { step: "game", identityId: null, game: null };
  }
  if (role === "TEAM") return { step: "team", identityId: null, game: null };
  const list = optionsForRole(options, role);
  if (list.length === 1) return { step: "pin", identityId: list[0].identityId, game: null };
  return { step: "identity", identityId: null, game: null };
}

/** 「上一步」要回到哪裡 */
export function previousStep(options: readonly LoginOption[], step: LoginStep, role: Role | null): LoginStep {
  switch (step) {
    case "game":
    case "team":
    case "identity":
      return "role";
    case "station":
      return stationGames(options).length > 1 ? "game" : "role";
    case "pin":
      if (role === "STATION") return "station";
      if (role === "TEAM") return "team";
      if (role && optionsForRole(options, role).length > 1) return "identity";
      return "role";
    case "role":
    default:
      return "role";
  }
}

/** 步驟標題（畫面上方，讓使用者知道在第幾步） */
export function stepTitle(step: LoginStep, role: Role | null): { index: number; title: string } {
  switch (step) {
    case "role":
      return { index: 1, title: "你是誰？" };
    case "game":
      return { index: 2, title: "選擇遊戲" };
    case "station":
      return { index: 2, title: "選擇你的關卡" };
    case "team":
      return { index: 2, title: "選擇你的小隊" };
    case "identity":
      return { index: 2, title: role ? `選擇${ROLE_LABEL[role]}身分` : "選擇身分" };
    case "pin":
    default:
      return { index: 3, title: "輸入 6 位數 PIN" };
  }
}

/** 從 LOGIN_LOCKED 的訊息「請 N 秒後再試」取出秒數；取不到就當 60 秒 */
export function parseRetrySeconds(message: string): number {
  const m = /(\d+)\s*秒/.exec(message);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 60;
}
