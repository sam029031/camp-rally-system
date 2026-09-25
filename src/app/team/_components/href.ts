import type { GameCode } from "@/lib/types";

/**
 * 隊輔頁網址：`/team`、`/team?team=2`、`/team?game=land`、`/team?team=2&game=land`。
 * - team：ADMIN／其他身分指定要看的隊伍（隊伍代碼）；null = 自己的隊伍（TEAM）或隊伍選單。
 * - game：手動切換的遊戲；null = 依時間自動選（規則同 /dashboard）。
 */
export function teamPageHref({ game, team }: { game: GameCode | null; team: string | null }): string {
  const params = new URLSearchParams();
  if (team) params.set("team", team);
  if (game) params.set("game", game);
  const q = params.toString();
  return q ? `/team?${q}` : "/team";
}
