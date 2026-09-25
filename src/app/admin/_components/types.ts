/** 管理頁各分頁共用 props（合約：[admin-a] 與 [admin-b] 共用）。 */
import type { GameCode, SessionInfo } from "@/lib/types";
import type { LiveGame } from "@/lib/client/use-live-game";

export interface AdminTabProps {
  /** 目前選擇的遊戲（管理頁頂端切換） */
  gameCode: GameCode;
  /** useLiveGame(gameCode) 的結果（整頁只呼叫一次） */
  live: LiveGame;
  session: SessionInfo;
}
