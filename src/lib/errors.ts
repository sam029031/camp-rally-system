/**
 * Error codes（RPC / API / 前端共用）與中文提示（直接顯示在按鈕下方）。
 * RPC 回傳 { status: 'rejected', code } 時，code 一定是這裡的其中一個。
 */

export const ERROR_MESSAGES = {
  // ---- 打卡規則（record_check） ----
  ASSIGNMENT_NOT_FOUND: "找不到這個關卡場次，請重新整理頁面。",
  ASSIGNMENT_CANCELLED: "本場已取消，不能打卡。",
  INVALID_ACTION: "操作類型不正確。",
  TEAM_NOT_IN_ASSIGNMENT: "這一隊不在本場次，請確認隊伍。",
  FORBIDDEN: "你沒有操作這個關卡／隊伍的權限。",
  BOTH_TEAMS_REQUIRED: "大地 PK 必須兩隊都到齊並勾選，才能開始。",
  SLOT_ALREADY_ENDED: "本時段已結束，請聯絡總召延長或取消本場。",
  PREV_ASSIGNMENT_NOT_CHECKED_OUT: "本關上一組還沒有出關，請先按上一組的確認出關。",
  NO_STATION_CHECK_IN: "尚未確認進關，不能出關。",
  NO_SHOW_HAS_CHECK_IN: "本場已經有關主進關紀錄，不能按「本隊未到」。",
  NO_SHOW_TOO_EARLY: "本時段預定結束後才能按「本隊未到」。",
  TEAM_NOT_CHECKED_IN: "本隊尚未確認進關，關主也還沒進關，不能出關。",
  TEAM_OUT_OF_ORDER: "你已經在更後面的關卡打過卡，不能對前面的關卡打卡。請聯絡總召修正。",
  CHECKOUT_BEFORE_CHECKIN: "出關時間不能早於進關時間。",
  ALREADY_RECORDED: "已由另一裝置記錄。",
  // ---- 撤銷 ----
  RECORD_NOT_FOUND: "找不到這筆紀錄。",
  ALREADY_VOIDED: "這筆紀錄已經撤銷過了。",
  UNDO_NOT_OWNER: "只能撤銷自己按的紀錄。",
  UNDO_WINDOW_EXPIRED: "超過 1 分鐘，不能自行撤銷，請聯絡總召修正。",
  UNDO_NEXT_CHECKED_IN: "下一隊已進關，請找總召修正。",
  UNDO_CHECKIN_HAS_CHECKOUT: "本場已經出關，不能撤銷進關；請先撤銷出關。",
  UNDO_TEAM_ARRIVED_NEXT: "隊伍已經在下一關打卡，請找總召修正。",
  // ---- 排程調整 / 取消 / 延長 ----
  ADJUST_SLOT_STARTED: "該時段已經開始（或已過開始時間），只能從尚未開始的時段起調整。",
  ADJUST_SLOT_HAS_CHECKINS: "該時段或之後的時段已有關主進關紀錄，不能調整。",
  ADJUST_RESULT_IN_PAST: "調整後的開始時間已經過去，請改用較晚的時間。",
  ADJUST_INVALID: "調整內容不正確。",
  ADJUST_NOTHING_TO_VOID: "目前沒有可以撤銷的調整。",
  CANCEL_IN_PROGRESS: "本場已經進行中，請先出關或強制結束後再取消。",
  CANCEL_ALREADY_CANCELLED: "本場已經取消過了。",
  CANCELLATION_NOT_FOUND: "找不到這筆取消紀錄（可能已撤銷）。",
  CANCEL_VOID_ORDER_CONFLICT: "本關或相關隊伍已經進行到後面的時段，不能撤銷這筆取消；請找總召改用修正紀錄處理。",
  OVERRIDE_NOT_FOUND: "找不到這筆延長紀錄（可能已撤銷）。",
  OVERRIDE_INVALID_TIME: "延長後的結束時間不正確。",
  // ---- Demo / Reset / 設定 ----
  CLOCK_JUMP_BEFORE_RECORDS: "要跳到的時間早於現有打卡紀錄，請先執行 Reset Demo Data。",
  DEMO_NOT_ALLOWED: "正式環境（APP_ENV）不允許開啟 Demo 模式。",
  RESET_NOT_ALLOWED: "正式環境（APP_ENV）不允許 Reset。",
  RESET_CONFIRM_MISMATCH: "確認字不正確，請輸入 RESET。",
  REASON_REQUIRED: "請填寫原因。",
  INVALID_REQUEST: "送出的資料不正確。",
  NOT_FOUND: "找不到資料。",
  // ---- 登入 / session ----
  UNAUTHORIZED: "請先登入。",
  SESSION_EXPIRED: "登入已失效（PIN 可能已更換），請重新登入。",
  IDENTITY_INACTIVE: "這個身分已停用，請聯絡總召。",
  LOGIN_INVALID_PIN: "PIN 不正確。",
  LOGIN_LOCKED: "錯誤次數太多，請 1 分鐘後再試。",
  // ---- 其他 ----
  NETWORK_ERROR: "網路中斷，請重新送出。",
  INTERNAL_ERROR: "系統錯誤，請稍後再試或聯絡總召。",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && code in ERROR_MESSAGES;
}

/** 取得中文提示；未知 code 回傳通用訊息 */
export function errorMessage(code: string | null | undefined): string {
  if (code && isErrorCode(code)) return ERROR_MESSAGES[code];
  return ERROR_MESSAGES.INTERNAL_ERROR;
}

/** 撤銷超過 1 分鐘時的提示（帶入活動長稱呼） */
export function undoExpiredMessage(leadTitle: string): string {
  return `超過 1 分鐘，請聯絡${leadTitle}由總召修正。`;
}
