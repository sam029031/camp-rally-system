/**
 * Browser Notification（第十五節，可有可無的最後一步）。
 *
 * - 先顯示 Toast 與播放聲音，再嘗試系統通知。
 * - 有註冊 service worker 時用 registration.showNotification()，否則用 new Notification()
 *   （Android Chrome 不支援 new Notification()，會丟錯）。
 * - 整段 try/catch，失敗就靜默略過，不能影響 Toast 與聲音。不做 Web Push。
 */

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export function browserNotificationPermission(): BrowserNotificationPermission {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

/** 向使用者要求系統通知權限（必須在使用者手勢內呼叫）。 */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (Notification.permission !== "default") return Notification.permission;
    return await Notification.requestPermission();
  } catch {
    return browserNotificationPermission();
  }
}

/**
 * 顯示系統通知；沒有權限或任何錯誤都回傳 false，不丟錯。
 * @param tag 相同 tag 的通知會互相取代，避免疊一整排
 */
export async function showBrowserNotification(title: string, body: string, tag = "camp-alert"): Promise<boolean> {
  try {
    if (browserNotificationPermission() !== "granted") return false;
    const options: NotificationOptions = { body, tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" };
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
      if (reg) {
        await reg.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
