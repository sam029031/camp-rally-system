import "server-only";
import { after } from "next/server";
import { loadGameSnapshot } from "@/lib/data/snapshot";
import { notificationsToInvalidate, notificationsToRevalidate } from "@/lib/notifications/validity";
import { callRpc, getAppNow } from "@/lib/server/rpc";
import { getServiceClient } from "@/lib/server/supabase";

/**
 * 通知失效判斷（第十五節「撤銷或修正紀錄後，若某則通知的條件不再成立，標記 invalidated_at」）。
 * 載入快照 + get_clock → notificationsToInvalidate → invalidate_notifications；
 * 反向：條件又成立的已失效通知 → notificationsToRevalidate → revalidate_notifications（「已解除」要反映目前事實）。
 * 失敗只 log，不影響原本的回應。
 */
export async function reconcileNotifications(gameId: string): Promise<void> {
  try {
    const client = getServiceClient();
    const snap = await loadGameSnapshot(client, { gameId });
    const now = await getAppNow(client, snap.event.id);
    const ids = notificationsToInvalidate(snap, now);
    if (ids.length > 0) {
      await callRpc<number>(client, "invalidate_notifications", { p_ids: ids });
    }
    // 條件又成立的（例如撤銷延長／撤銷取消／時間改回來）→ 清掉 invalidated_at。
    // 兩份清單互斥（一個只看未失效、一個只看已失效）；恢復的 id 前端早已看過，不會重新跳 Toast。
    const revalidate = notificationsToRevalidate(snap, now);
    if (revalidate.length > 0) {
      await callRpc<number>(client, "revalidate_notifications", { p_ids: revalidate });
    }
  } catch (e) {
    console.error(`[notifications] reconcileNotifications(${gameId}) 失敗`, e);
  }
}

/**
 * 在回應送出後才做失效判斷（next/server after()；Vercel 上會以 waitUntil 延長生命週期），
 * 不拖慢關主／隊輔的撤銷與總召的修正操作。
 */
export function scheduleReconcile(gameIds: Iterable<string | null | undefined>): void {
  const unique = Array.from(new Set(Array.from(gameIds).filter((g): g is string => typeof g === "string" && g !== "")));
  if (unique.length === 0) return;
  after(async () => {
    for (const gameId of unique) await reconcileNotifications(gameId);
  });
}
