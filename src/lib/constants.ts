/**
 * 程式常數（README「設計決策」有列出位置）。
 *
 * 分兩類：
 * - APP 時間（跟排程有關，Demo 倍速下會跟著加速）：用 app_now() 比較。
 * - REAL 時間（跟操作有關，不乘倍速）：用真實時間比較。
 */

export const TIMEZONE = "Asia/Taipei";
/** event_date + 'HH:mm' 一律視為 +08:00（不依賴執行環境時區） */
export const TAIPEI_OFFSET = "+08:00";

// ---------------------------------------------------------------------
// APP 時間（排程相關）
// ---------------------------------------------------------------------

/** 關卡剩餘 <= 2:00 → ENDING_SOON（黃） */
export const ENDING_SOON_MS = 120_000;
/** 跑關剩餘 <= 2:00 → 黃色（只改顏色，不發通知、不新增狀態） */
export const TRANSITION_WARNING_MS = 120_000;
/** 隊輔都到關後，關主超過 3 分鐘未開始 → STATION_NOT_STARTED */
export const STATION_NOT_STARTED_MS = 180_000;
/** 比預定開始早超過 7 分鐘按進關 → 前端跳確認 */
export const EARLY_CHECK_IN_CONFIRM_MS = 420_000;
/** 計時已開始 90 秒，隊輔仍未按進關 → TEAM_NOT_CHECKED_IN */
export const TEAM_CHECK_IN_GRACE_MS = 90_000;
/** 關主出關 90 秒後，隊輔仍未按出關 → TEAM_NOT_CHECKED_OUT */
export const TEAM_CHECK_OUT_GRACE_MS = 90_000;
/** 同一隊隊輔出關與關主出關時間差超過 60 秒 → CHECKOUT_TIME_DIFF（紀錄不一致） */
export const CHECKOUT_DIFF_THRESHOLD_MS = 60_000;
/**
 * 隊輔已出關、關主未出關：超過這個寬限才建立 RECORD_MISMATCH / TEAM_OUT_STATION_NOT_OUT 通知（跳 Toast）。
 * 自訂決策：兩邊幾乎同時按時避免誤報；關主頁的醒目橫幅不受寬限影響，立即顯示。
 */
export const TEAM_OUT_STATION_NOT_OUT_GRACE_MS = 15_000;

// ---------------------------------------------------------------------
// REAL 時間（操作相關，不乘倍速）
// ---------------------------------------------------------------------

/** 現場撤銷視窗（前端顯示） */
export const SELF_UNDO_WINDOW_MS = 60_000;
/** 撤銷視窗結束後，「超過 1 分鐘，請聯絡活動長…」提示再顯示多久（之後隱藏，避免畫面長期堆著舊提示） */
export const UNDO_EXPIRED_HINT_MS = 180_000;
/** 現場撤銷 server 端容許上限（涵蓋網路延遲） */
export const SELF_UNDO_SERVER_LIMIT_MS = 75_000;
/**
 * 撤銷重送：回應遺失後重送同一筆撤銷，若這筆是本人在最近 90 秒（真實時間）內自己撤銷的，
 * 仍回傳成功與撤銷提醒（第二十二節：提醒必做，不可因重送而漏掉）。
 */
export const SELF_UNDO_RETRY_WINDOW_MS = 90_000;
/** 登入：1 分鐘內錯 5 次鎖 1 分鐘 */
export const LOGIN_FAIL_WINDOW_MS = 60_000;
export const LOGIN_FAIL_LIMIT = 5;
/** 打卡送出逾時與自動重試 */
export const SUBMIT_TIMEOUT_MS = 8_000;
export const SUBMIT_MAX_RETRIES = 2;
/** 同一個通知 key 每台裝置最多每 5 秒再試一次 */
export const NOTIFICATION_RETRY_MS = 5_000;
/** 備援輪詢 */
export const POLL_INTERVAL_MS = 30_000;
/** 超過 60 秒沒成功抓取 → 「資料可能過期」 */
export const STALE_AFTER_MS = 60_000;
/** 重新校時間隔 */
export const CLOCK_RESYNC_MS = 60_000;
/** Realtime 事件合併重抓的 debounce */
export const REFETCH_DEBOUNCE_MS = 250;
/** 前端 Supabase 讀取（REST／RPC）逾時：卡住的請求要失敗，下一次重抓才跑得動（第二十七節） */
export const READ_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------
// 其他
// ---------------------------------------------------------------------

export const PIN_LENGTH = 6;
export const SESSION_COOKIE = "camp_session";
export const DEVICE_COOKIE = "camp_device";
/** Demo 倍速選項 */
export const SIM_SPEEDS = [1, 5, 10, 20] as const;
/** 幹部隊 */
export const STAFF_TEAM_CODE = "S";
export const STAFF_TEAM_NAME = "幹部隊";

/** 正式時段（第三節）：import 時 Excel 解析出的時段必須與此完全一致 */
export const OFFICIAL_SLOTS: Record<"gold" | "land", ReadonlyArray<readonly [string, string]>> = {
  gold: [
    ["09:10", "09:25"],
    ["09:32", "09:47"],
    ["09:54", "10:09"],
    ["10:16", "10:31"],
    ["10:38", "10:53"],
    ["11:00", "11:15"],
    ["11:22", "11:37"],
    ["11:44", "11:59"],
  ],
  land: [
    ["13:05", "13:25"],
    ["13:32", "13:52"],
    ["13:59", "14:19"],
    ["14:26", "14:46"],
    ["14:53", "15:13"],
    ["15:20", "15:40"],
    ["15:47", "16:07"],
    ["16:14", "16:34"],
  ],
};

/** 遊戲設定（import 建立 games 時的預設值；end_policy / min_play_seconds 之後只由 admin 修改） */
export const GAME_DEFAULTS = {
  gold: {
    name: "黃金傳奇",
    stationDurationSeconds: 900,
    transitionDurationSeconds: 420,
    teamsPerStation: 1,
    endPolicy: "FULL_DURATION",
    minPlaySeconds: 600,
    sortOrder: 1,
  },
  land: {
    name: "大地遊戲",
    stationDurationSeconds: 1200,
    transitionDurationSeconds: 420,
    teamsPerStation: 2,
    endPolicy: "FIXED_END",
    minPlaySeconds: 600,
    sortOrder: 2,
  },
} as const;

export const GAME_NAMES: Record<"gold" | "land", string> = {
  gold: "黃金傳奇",
  land: "大地遊戲",
};
