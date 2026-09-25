# 架構合約（給所有實作者）

規格全文：`docs/SPEC.md`（使用者的最終 prompt，第一～三十四節）。本文件補充**模組分工、函式介面、RPC 介面與已做的工程決策**。
兩者衝突時以 SPEC 為準，但本文件列出的「自訂決策」是刻意的，要照做並寫進 README「設計決策」。

已寫好、不可改簽名的合約檔（可以「新增」export，不可以改既有型別語意）：

- `src/lib/types.ts` — DB row 型別與正規化快照 `GameSnapshot`
- `src/lib/derive/types.ts` — 推導輸出型別 `DerivedGame` 等
- `src/lib/constants.ts` — 所有門檻常數、正式時段
- `src/lib/errors.ts` — error codes 與中文訊息
- `src/lib/api/contract.ts` — 所有 Route Handler 的 request/response 型別
- `supabase/migrations/20260925000100_schema.sql` — tables / indexes / views / `app_now()` / `get_clock()`

技術：Next.js 16 App Router（**請先讀 `node_modules/next/dist/docs/` 相關章節**，Next 16 有 breaking changes：
`middleware.ts` 改名 `proxy.ts`、`params`/`searchParams`/`cookies()` 都是 async、`next lint` 已移除改用 `eslint`），
TypeScript strict、Tailwind v4、Supabase（supabase-js v2）、jose、bcryptjs、Vitest。UI 元件自己寫在 `src/components/ui/`（shadcn 風格：cva + clsx + tailwind-merge），不另外裝 Radix。

---

## 1. 目錄與模組擁有者

```
src/lib/types.ts, derive/types.ts, constants.ts, errors.ts, api/contract.ts   合約（已完成）
src/lib/time.ts                 時間格式化（Asia/Taipei）             [core]
src/lib/clock.ts                統一時鐘（純函式）                      [core]
src/lib/schedule.ts             排程輔助：延後預覽、預設 k、dashboard 導向 [core]
src/lib/derive/index.ts (+ derive/*.ts)  狀態推導（第十節）           [core]
src/lib/notifications/*.ts      通知條件 key、訊息、失效判斷、Toast 分類  [core]
src/lib/labels.ts               狀態中文文字、顏色 class、隊名              [core]
src/lib/data/snapshot.ts        讀取遊戲快照（client 與 server 共用）      [core]
src/lib/import/*.ts             Excel 解析 / overrides / validation     [import]
scripts/import-schedule.ts      import CLI                              [import]
supabase/migrations/*_functions.sql, *_security_realtime.sql            [sql]
src/lib/server/*.ts             env / service client / session / auth / 通知失效 [server]
src/proxy.ts                    發 device_id cookie                      [server]
src/app/api/**/route.ts         所有 Route Handlers                     [server]
src/lib/client/*.ts             browser supabase / hooks / submit / 通知 / 聲音 / wake lock [client]
src/components/ui/*             Button / Card / Dialog / Badge ...      [client]
src/components/*.tsx            共用：Timer、狀態徽章、頂端列、通知中心、撤銷按鈕…  [client]
src/app/layout.tsx, manifest.ts, icon, apple-icon, globals.css          [client]
src/app/login, dashboard, station, team, admin                          [pages]
tests/unit/*.test.ts            純函式測試（各模組擁有者寫自己的）
tests/db/*.test.ts              真 Postgres 測試                        [dbtests]
README.md                       繁體中文                                 [docs]
```

---

## 2. 時間模型

- DB：timestamptz（UTC）。推導：epoch 毫秒。顯示：Asia/Taipei（`src/lib/time.ts`，一律 `Intl.DateTimeFormat` 指定 `timeZone: 'Asia/Taipei'`，不依賴執行環境時區）。
- **所有「現在」都來自 app 時鐘**：
  - SQL：`app_now_for_event(event_id)`（RPC 內一律用這個，event 由 assignment → game → event 取得）；`app_now()` = active event 的。
  - 前端：`get_clock()` 校時 → `offset = server_now − Date.now()`（用 RTT/2 修正）→ 每秒 `realNow = Date.now() + offset`，`appNow = computeAppNow(realNow, clockSettings)`。
  - server（Route Handler）：需要 now 時呼叫 `get_clock(event_id)` 取 `app_now`，**不可用 `Date.now()` 當 app 時間**。
- 跟排程有關的長度（15/20 分、7 分、2:00、3 分、90 秒、60 秒、早 7 分確認）用 app 時間；
  跟操作有關的（60/75 秒現場撤銷、登入鎖、8 秒逾時、5 秒通知重試、30 秒輪詢、60 秒過期）用真實時間。

`src/lib/time.ts`（core）至少提供：
```ts
formatHms(ms: number): string            // 'HH:mm:ss'（Asia/Taipei）
formatHm(ms: number): string             // 'HH:mm'
formatCountdown(ms: number): string      // 'MM:SS'（>= 1 小時 'H:MM:SS'）；取絕對值；正數用 ceil 秒、負數用 floor 秒
formatSignedDuration(ms: number): string // '+00:18' / '-01:05'（較預定）
taipeiLocalToMs(date: string, time: string): number   // 'YYYY-MM-DD' + 'HH:mm[:ss]' 視為 +08:00
msToTaipeiDate(ms: number): string                     // 'YYYY-MM-DD'
msToTaipeiTimeInput(ms: number): string                // 'HH:mm:ss'（admin 修正時間表單用）
```

`src/lib/clock.ts`（core）：
```ts
computeAppNow(realNowMs: number, clock: ClockSettings): number
clockSettingsFromEventRow(row: EventRow): ClockSettings
clockSettingsFromRpc(r: ClockRpcResult): ClockSettings
computeServerOffset(serverNowIso: string, requestStartReal: number, responseEndReal: number): number
```

---

## 3. 狀態推導（core，`src/lib/derive/index.ts`）

```ts
deriveGame(snap: GameSnapshot, now: number): DerivedGame
stationRowsForSlot(snap: GameSnapshot, d: DerivedGame, slotNumber: number): StationRowView[]
/** 關主頁主卡片：該關「最早一個尚未關主出關、且未取消」的 assignment；全部完成 → null */
stationFocusAssignment(snap: GameSnapshot, d: DerivedGame, stationId: string): AssignmentDerived | null
/** 該關所有 assignment（依時段），含取消的 */
stationAssignments(snap: GameSnapshot, d: DerivedGame, stationId: string): AssignmentDerived[]
/** 通知 dedupe key：kind|subkind|assignmentId|teamId|triggerRecordId|triggerOverrideId（null 寫成空字串） */
conditionKey(c: NotificationCondition | AppNotification): string
/** server 用：從目前成立的條件中找出 (kind, subkind, assignmentId, teamId) 相符的那一個 */
findCondition(d: DerivedGame, req: { kind: NotificationKind; subkind: string | null; assignmentId: string | null; teamId: string | null }): NotificationCondition | null
```

規則全部照 SPEC 第八、九、十節，以下是補充與**自訂決策**：

1. 有效紀錄 = `voidedAt === null`。每個 assignment 每個 (action, teamId) 最多一筆有效（DB 保證）。
2. `startedAt = max(stationCheckIn.recordedAt, slot.scheduledStart)`；
   `officialEnd`：有效 override → override；FULL_DURATION → `startedAt + duration`；FIXED_END → `min(startedAt + duration, slot.scheduledEnd)`。
3. 關卡時段狀態優先序：CANCELLED > CHECKED_OUT > （有 stationCheckIn：now < startedAt → READY；否則依 remaining：> 2:00 IN_PROGRESS、0 < r <= 2:00 ENDING_SOON、r <= 0 OVERTIME）>（任一隊有 team_check_in → READY）> WAITING。
4. 小隊路線 = 該隊在本遊戲的 assignment（依時段），**排除被取消的**。被取消 assignment 上的紀錄不影響小隊狀態。
5. 「該隊的有效紀錄」= 未撤銷且 team_id = 該隊的隊輔側紀錄 + 該隊所在 assignment 上 team_id NULL 的關主側紀錄。
6. last = 路線中最後一個有「該隊有效紀錄」的 assignment。
   - 無 last：目標 = 路線第一個；deadline = 其 scheduledStart；now < deadline → WAITING，否則 TRANSITION_OVERDUE（overdueFirstStation = true）。
   - last 有關主出關（含 no_show）：last 是路線最後一個 → COMPLETED；否則目標 = 路線中 last 的下一個，
     deadline = max(出關.recordedAt + transitionDuration, 目標.scheduledStart)；now < deadline → TRANSITIONING，否則 TRANSITION_OVERDUE。
   - last 無關主出關：有 stationCheckIn 且 now >= startedAt → AT_STATION；否則 ARRIVED（detail 優先序：
     WAITING_START（關主已進關）> QUEUED（queueBlocked）> WAITING_OPPONENT（大地且對手無任何抵達紀錄）> TEAM_REPORTED）。
7. 抵達 = 該隊在目標 assignment 的 team_check_in 或該 assignment 的 station_check_in（取最早）。有抵達紀錄 ⇒ 它就成為 last，所以跑關自然停止。
8. `prevAssignmentId` / `nextAssignmentId` / `queueBlocked`：同一關卡依時段，跳過休息（沒有 assignment）與被取消的 assignment。
9. 次要標籤（`tags`，每隊各自算；CANCELLED 與 no_show 的 assignment 不算）：
   - TEAM_NOT_CHECKED_IN：now >= startedAt + 90s，該隊沒有 team_check_in。trigger = stationCheckIn。
     （條件成立的時點：該隊 team_check_in 不存在或 recordedAt > startedAt + 90s — 後者只用於失效判斷。）
   - TEAM_NOT_CHECKED_OUT：有 stationCheckOut（非 no_show），now >= 出關 + 90s，該隊沒有 team_check_out。trigger = stationCheckOut。
   - TEAM_OUT_STATION_NOT_OUT：該隊有 team_check_out、沒有 stationCheckOut。標籤立即顯示；
     通知（notify = true）要 now >= teamCheckOut + 15s（`TEAM_OUT_STATION_NOT_OUT_GRACE_MS`，自訂決策）。trigger = teamCheckOut。
   - CHECKOUT_TIME_DIFF：兩邊都有出關且 |差| > 60s。trigger = teamCheckOut。
   - TEAM_CHECK_IN_MISSING：該隊有 team_check_out 但沒有 team_check_in。trigger = teamCheckOut。
   - PREV_NOT_CHECKED_OUT：該隊路線中 assignment X 沒有有效 stationCheckOut，但該隊在 X 之後的 assignment 已有抵達紀錄。
     trigger = X 之後「第一個有抵達紀錄的 assignment」上最早那筆抵達紀錄。標籤文字「未出關（隊伍已到下一關）」。
     X 完全沒有關主進關時，文字改為「未到（隊伍已在下一關），待按本隊未到」。
10. 通知條件（`conditions`，全部 key 都含 trigger，所以撤銷後重做 = 新事件）：
    - STATION_OVERTIME：有 stationCheckIn、無 stationCheckOut、now >= officialEnd。teamId = null，trigger = stationCheckIn，
      triggerOverrideId = 目前有效 override 的 id（延長後再超時 = 新事件，自訂決策）。
    - TRANSITION_OVERDUE：每隊一筆；assignmentId = 目標，teamId = 該隊，trigger = previousCheckOut（第一關 null）。
    - STATION_NOT_STARTED：assignment 未取消、無 stationCheckIn、所有隊伍都有 team_check_in、上一場已出關（非 queueBlocked），
      且 now >= max(最後一筆 team_check_in、scheduledStart、上一場出關時間) + 3 分。teamId = null，trigger = 最後到的那筆 team_check_in。
    - PREV_NOT_CHECKED_OUT：assignmentId = X，teamId = 該隊，trigger 同上。
    - RECORD_MISMATCH：tag.notify 為 true 的每個標籤；subkind = 標籤 kind，teamId = 該隊，trigger = tag.triggerRecordId。
11. `current`（目前時段 k）：照 SPEC 第十一節。
12. `grid`：slots × stations；沒有 assignment 的格子 state = REST。
13. `stationRowsForSlot`：照 SPEC 第十一節「每一個關卡列顯示哪個 assignment」。
14. `summary`：以 `current.slotNumber` 的關卡列計算；transitioning / transitionOverdue 數隊伍。
15. `activeAdjustmentLabel`：有未撤銷調整時，例如「第3時段起已延後 10 分鐘」（多筆時以最早受影響時段與該時段的總 offset 描述）。

`src/lib/notifications/`（core）：
```ts
// validity.ts：撤銷／修正／延長／取消後，哪些「推導型」通知的條件其實沒有成立過 → 要標 invalidated
notificationsToInvalidate(snap: GameSnapshot, now: number): string[]
//   規則：trigger record 已撤銷 → 失效；STATION_OVERTIME 的 triggerOverrideId 與目前有效 override 不同 → 失效；
//   用目前有效紀錄重算「條件是否曾經成立」（例如修正出關時間到 officialEnd 之前 → 失效；
//   TRANSITION_OVERDUE：抵達時間 <= deadline → 失效；目標被取消 → 失效）。
//   SCHEDULE_ADJUSTED / SELF_UNDO / STATION_SHORTENED 不在這裡處理（STATION_SHORTENED：trigger 撤銷 → 失效）。
// messages.ts
buildConditionMessage(c: NotificationCondition, snap: GameSnapshot, d: DerivedGame): string
//   例：「九九乘法 第2小隊 關卡超時」「第2小隊 跑關逾期（前往 3的倍數）」「第8小隊 未到第一關（ㄇㄉㄈㄎ）」
// classify.ts
type PageContext = { page: 'dashboard' | 'station' | 'team' | 'admin'; stationId?: string | null; teamId?: string | null }
isRelevantNotification(n: AppNotification, snap: GameSnapshot, ctx: PageContext): boolean
isToastNotification(n: AppNotification, snap: GameSnapshot, ctx: PageContext): boolean   // A 類且相關；TEAM_OUT_STATION_NOT_OUT 只在該關關主頁
isConditionRelevant(c: NotificationCondition, snap: GameSnapshot, ctx: PageContext): boolean // 頁面只偵測自己已載入/相關的條件
```
通知對象：STATION_OVERTIME / STATION_NOT_STARTED → 所有 Dashboard、該關關主頁、相關隊伍隊輔頁；
TRANSITION_OVERDUE → Dashboard、該隊隊輔頁、目標關卡關主頁；PREV_NOT_CHECKED_OUT → Dashboard、X 的關主頁、該隊隊輔頁；
STATION_SHORTENED → Dashboard、admin；SCHEDULE_ADJUSTED → 全部頁面；SELF_UNDO、其他 RECORD_MISMATCH → 只進通知中心（B 類）。

`src/lib/labels.ts`（core）：狀態中文、顏色 class（灰/紫/綠/黃/紅/藍/橘，照 SPEC 第十四節）、`teamName(team, { short })`（「第N小隊」/「第N隊」/「幹部隊」）、`actionLabel(action)`（確認進關／確認出關…）。

`src/lib/schedule.ts`（core）：
```ts
previewAdjustment(slots: Slot[], fromSlotNumber: number, offsetMs: number): { rows: Array<{ slotNumber: number; oldStart: number; oldEnd: number; newStart: number; newEnd: number; affected: boolean }>; newLastEnd: number; overlapWarning: boolean }
defaultAdjustFromSlot(snap: GameSnapshot, now: number): number | null   // 有效開始 > now 且該時段及之後沒有有效 station_check_in 的第一個時段
dashboardGameForNow(goldSlots: Slot[], now: number): GameCode           // 黃金最後時段結束前 → gold，其後 → land
```

`src/lib/data/snapshot.ts`（core）：
```ts
loadActiveEvent(client: SupabaseClient): Promise<EventRow | null>
loadGameSnapshot(client: SupabaseClient, sel: { gameCode: GameCode; eventId?: string } | { gameId: string }): Promise<GameSnapshot>
normalizeSnapshot(raw: RawGameSnapshot): GameSnapshot   // 純函式，測試用
```
讀：`events`、`games`、`v_slot_times`、`stations`、`teams`、`assignments`、`v_check_records`（game_id 過濾）、
`v_assignment_cancellations`、`v_assignment_end_overrides`、`schedule_adjustments`、`notifications`。
client 端用 anon client，server 端用 service client，同一份程式。

---

## 4. 資料庫 RPC（sql，`supabase/migrations/20260925000200_functions.sql`）

全部 `language plpgsql`、`set search_path = public`；**只給 service_role 執行**（security migration 裡 REVOKE/GRANT）。
規則拒絕一律 **return** `jsonb {status:'rejected', code}`（不 raise，讓 audit log 能 commit）；只有真正的程式錯誤才 raise。
回傳紀錄一律是 `v_check_records` 形狀的 jsonb（`to_jsonb(v)`），前端型別 `CheckRecordRow`。
每個 RPC 內的 now 都用 `app_now_for_event(該遊戲的 event_id)`；「真實時間」比較用 `now()`。

```sql
record_check(
  p_client_request_id uuid, p_assignment_id uuid, p_action text, p_team_id uuid, p_identity_id uuid,
  p_source text default 'ui',                  -- 'ui' | 'admin_correction' | 'admin_force'
  p_recorded_at timestamptz default null,      -- 只有 admin_correction 用
  p_no_show boolean default false,
  p_confirmed_team_ids uuid[] default null,
  p_single_team_override boolean default false,
  p_reason text default null,
  p_client_info jsonb default null
) returns jsonb   -- {status:'created'|'existing'|'already_recorded'|'rejected', code?, record?}
```
固定順序（SPEC 第二十一節）：(1) client_request_id 已存在 → `existing` + 那一筆（已撤銷也回傳）；
(2) `SELECT … FOR UPDATE` 鎖 assignment（隊輔側另外鎖該隊 teams 列；關主側也鎖本關上一場／下一場 assignment 以配合撤銷的順序保護）；
(3) 驗規則（identity 有效且有權限：STATION 只能自己的 station 的關主側動作、TEAM 只能自己隊的隊輔側動作、ADMIN 全部、VIEWER 全拒）；
(4) `INSERT … ON CONFLICT (assignment_id, action, team_id) WHERE voided_at IS NULL DO NOTHING`，沒插入 → 查出有效那筆回 `already_recorded`（寫 audit `DUPLICATE_ATTEMPT`）。
規則（違反回 rejected + 寫 audit `REJECTED_CHECK`）：SPEC 第二十一節全部，另外：
- 被取消 → ASSIGNMENT_CANCELLED；大地 station_check_in confirmed_team_ids 必須恰為兩隊（集合相等）否則 BOTH_TEAMS_REQUIRED，
  除非 single_team_override 且 identity 是 ADMIN 且 p_reason 非空（寫 audit `SINGLE_TEAM_START`）。
- FIXED_END station_check_in（source ui / admin_force）：app_now >= slot scheduled_end 且沒有「未來的有效 override」→ SLOT_ALREADY_ENDED。
- 寫入 station_check_in 後，若 FIXED_END 且 可玩時間 < min_play_seconds → 同一 transaction 建 STATION_SHORTENED 通知（trigger = 該筆）。
- admin_correction：p_recorded_at 必填；同側「出關 >= 進關」（CHECKOUT_BEFORE_CHECKIN）；不檢查 SLOT_ALREADY_ENDED；ADMIN only。
- admin_force：只允許 station_check_out、ADMIN only、需要有效 station_check_in。

```sql
undo_check(p_record_id uuid, p_identity_id uuid, p_client_info jsonb default null) returns jsonb
  -- {status:'voided'|'rejected', code?, record?}；現場撤銷：同 identity、now() - real_created_at <= 75 秒（真實時間）、順序保護（SPEC 第二十二節）
  -- void_reason = 'SELF_UNDO'；寫 audit SELF_UNDO；建 SELF_UNDO 通知（trigger = 該筆）；把 trigger_record_id = 該筆的其他通知標 invalidated
admin_void_record(p_record_id uuid, p_identity_id uuid, p_reason text, p_client_info jsonb default null) returns jsonb
  -- 順序保護（下一隊已進關不能撤出關、已出關不能撤進關），不檢查「隊伍已到下一關」
admin_correct_record(p_record_id uuid, p_new_recorded_at timestamptz, p_identity_id uuid, p_reason text,
                     p_client_request_id uuid, p_client_info jsonb default null) returns jsonb
  -- 同一 transaction：撤銷原紀錄 + 新增 source='admin_correction'（replaces_record_id = 原紀錄）；驗 出關 >= 進關；回 {status:'created', record}
adjust_schedule(p_game_id uuid, p_from_slot_number int, p_input_mode text, p_offset_seconds int, p_start_at timestamptz,
                p_reason text, p_identity_id uuid) returns jsonb
  -- START_AT：offset = p_start_at − 第 k 時段目前有效開始；拒絕：ADJUST_SLOT_STARTED / ADJUST_SLOT_HAS_CHECKINS / ADJUST_RESULT_IN_PAST（調整後開始 <= app_now，自訂決策）/ ADJUST_INVALID（offset = 0）
  -- 成功：建 SCHEDULE_ADJUSTED（trigger_adjustment_id）；message 例「黃金傳奇 第3時段起延後 10 分鐘，第3時段改為 10:04 開始」
void_last_adjustment(p_game_id uuid, p_identity_id uuid, p_reason text) returns jsonb
  -- 最近一筆未撤銷調整；受影響時段（目前有效開始）都要 > app_now 且沒有有效 station_check_in，撤銷後的開始也要 > app_now；
  -- 建 SCHEDULE_ADJUSTED（trigger_phase 'VOID'），message 寫撤銷後的時間
cancel_assignments(p_assignment_ids uuid[], p_reason text, p_identity_id uuid) returns jsonb
  -- 全部成功或全部失敗；進行中（有效 station_check_in 且無 station_check_out）→ CANCEL_IN_PROGRESS；已取消 → CANCEL_ALREADY_CANCELLED
  -- 一次建立一則 SCHEDULE_ADJUSTED（trigger_cancellation_id = 第一筆），message 例「下午茶極與極 第3時段起取消（下雨）」
void_cancellation(p_cancellation_id uuid, p_identity_id uuid, p_reason text) returns jsonb   -- 建 SCHEDULE_ADJUSTED VOID
set_end_override(p_assignment_id uuid, p_official_end timestamptz, p_reason text, p_identity_id uuid) returns jsonb
  -- 同一 transaction 撤銷舊的有效 override 再新增；official_end 必須 > 該場 started_at（若已進關）→ 否則 OVERRIDE_INVALID_TIME
void_end_override(p_override_id uuid, p_identity_id uuid, p_reason text) returns jsonb
update_game_settings(p_game_id uuid, p_end_policy text, p_min_play_seconds int, p_identity_id uuid) returns jsonb
update_event_settings(p_event_id uuid, p_event_date date, p_team_group_label text, p_station_group_label text,
                      p_lead_title text, p_identity_id uuid) returns jsonb   -- null 參數 = 不改
set_clock(p_event_id uuid, p_enabled boolean, p_speed double precision, p_jump_to timestamptz, p_identity_id uuid) returns jsonb
  -- 重設 anchor：anchor_real = now()、anchor_virtual = coalesce(p_jump_to, 改動當下的 app_now)；
  -- p_jump_to 早於本活動任何有效紀錄的 recorded_at → CLOCK_JUMP_BEFORE_RECORDS；寫 audit DEMO_SETTINGS
  -- （APP_ENV 限制在 Route Handler 檢查，DB 不知道 APP_ENV）
reset_game_records(p_game_id uuid, p_identity_id uuid, p_reason text, p_disable_sim boolean default false) returns jsonb
  -- 單一 transaction 依序 DELETE notifications、check_records、assignment_end_overrides、assignment_cancellations、schedule_adjustments（不用 TRUNCATE）
  -- 最後 update games set updated_at = now()；p_disable_sim → events.sim_enabled = false；audit RESET 保留
create_notification(p_kind text, p_subkind text, p_game_id uuid, p_assignment_id uuid, p_team_id uuid,
                    p_trigger_record_id uuid, p_trigger_override_id uuid, p_message text) returns jsonb
  -- INSERT … ON CONFLICT DO NOTHING（created_at = app_now_for_event）；回 {result:'created'|'exists', notification}
invalidate_notifications(p_ids uuid[]) returns integer   -- 只更新 invalidated_at is null 的
write_audit(p_actor uuid, p_game_id uuid, p_action text, p_target_table text, p_target_id text,
            p_before jsonb, p_after jsonb, p_reason text, p_client_info jsonb) returns void
login_lock_status(p_device_id text, p_identity_id uuid) returns jsonb   -- {locked, retry_after_seconds}；任一 device 或 identity 最近 60 秒失敗 >= 5 → locked
record_login_attempt(p_device_id text, p_identity_id uuid, p_success boolean) returns void
set_identity_pin(p_identity_id uuid, p_pin_hash text, p_actor uuid) returns jsonb  -- pin_version + 1、寫 audit PIN_CHANGED
```

Audit action 名稱（固定）：`CHECK_RECORDED`（可選）、`REJECTED_CHECK`、`DUPLICATE_ATTEMPT`、`SELF_UNDO`、`ADMIN_VOID`、`ADMIN_CORRECT`、
`ADMIN_ADD`、`ADMIN_FORCE_END`、`NO_SHOW`、`SINGLE_TEAM_START`、`LOGIN_FAILED`、`PIN_CHANGED`、`SCHEDULE_ADJUSTED`、
`SCHEDULE_ADJUSTMENT_VOIDED`、`ASSIGNMENT_CANCELLED`、`CANCELLATION_VOIDED`、`END_OVERRIDE_SET`、`END_OVERRIDE_VOIDED`、
`GAME_SETTINGS`、`EVENT_SETTINGS`、`DEMO_SETTINGS`、`RESET`、`IMPORT`。

`supabase/migrations/20260925000300_security_realtime.sql`（sql）：所有 table enable RLS；
公開 table（events、games、time_slots、stations、teams、assignments、check_records、notifications、schedule_adjustments、
assignment_cancellations、assignment_end_overrides）對 anon, authenticated 只有 SELECT policy；identities、audit_logs、login_attempts 無 policy；
REVOKE INSERT/UPDATE/DELETE/TRUNCATE 給 anon, authenticated；views GRANT SELECT TO anon, authenticated；
每個寫入 function：`REVOKE EXECUTE ON FUNCTION f(args) FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`；
`app_now()`、`app_now_for_event(uuid)`、`get_clock(uuid)` GRANT EXECUTE TO anon, authenticated；
`ALTER PUBLICATION supabase_realtime ADD TABLE check_records, notifications, events, games, schedule_adjustments, assignment_cancellations, assignment_end_overrides;`
（加 `REPLICA IDENTITY` 不需要，client 收到事件一律重抓。）

---

## 5. Server（server）

- `src/lib/server/env.ts`：讀 `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SESSION_SECRET`、`APP_ENV`、`EVENT_DATE`；
  `isDemoAllowed()` = APP_ENV ∈ {development, demo}（未設定 → false）。檔案開頭 `import "server-only"`。
- `src/lib/server/supabase.ts`：`getServiceClient()`（service role，`auth: { persistSession: false }`）。
- `src/lib/server/session.ts`：jose HS256 `signSession(payload)` / `verifySession(token)`；cookie `camp_session`（httpOnly、sameSite lax、secure in production、path /）；
  到期：`max(活動日 23:59:59 +08:00, now + 24h)`。
- `src/lib/server/auth.ts`：`requireSession(req, { roles?, write? })` → 驗 cookie → service role 讀 identity →
  is_active=false 或 pin_version 不符 → 401 SESSION_EXPIRED 並清 cookie。`getSessionInfo()` 給 server component 用。
- 權限：STATION 只能操作自己的 station（assignment.station_id 比對 session.stationId）；TEAM 只能自己的隊（teamId 以 session 為準，body 的 teamId 必須相同）；
  ADMIN 全部；VIEWER 不能寫。**RPC 內也會再檢查一次（defense in depth）**。
- `src/lib/server/notifications.ts`：`reconcileNotifications(gameId)` = 載入快照 + `get_clock` → `notificationsToInvalidate` → `invalidate_notifications`。
  所有「撤銷／修正／補登／強制結束／取消／撤銷取消／延長／撤銷延長／延後／撤銷延後」成功後呼叫（失敗只 log，不影響回應）。
- `POST /api/notifications/check`：任一有效 session（含 VIEWER）；載入快照 + app_now → `deriveGame` → `findCondition`；
  找不到 → `not_yet`；找到 → `create_notification`（message = `buildConditionMessage`）→ `created` / `exists`。
- `src/proxy.ts`：沒有 `camp_device` cookie 就發一個（httpOnly、1 年、隨機 uuid）。
- Route 清單見 `src/lib/api/contract.ts`；另外 `GET /api/admin/export?type=…&game=…` 回 CSV（UTF-8 BOM，Excel 可開）。
- 所有 route 回應 `Cache-Control: no-store`。

## 6. Client（client）

```ts
// src/lib/client/supabase.ts
getBrowserSupabase(): SupabaseClient            // anon key，單例
// src/lib/client/use-live-game.ts
useLiveGame(gameCode: GameCode): LiveGame
interface LiveGame {
  snapshot: GameSnapshot | null; derived: DerivedGame | null;
  now: number;                  // app 時間（每秒更新）
  getNow: () => number;         // 事件處理用
  realNow: () => number;        // 校正後真實時間（撤銷 60 秒倒數用）
  status: { online: boolean; channel: 'connecting' | 'subscribed' | 'error' | 'closed'; lastFetchOkAt: number | null; stale: boolean; error: string | null };
  refetch: () => Promise<void>;
}
```
- 一台裝置一個 channel；postgres_changes：check_records、notifications、schedule_adjustments、assignment_cancellations、
  assignment_end_overrides（不加 filter）、games（`id=eq.<gameId>`）、events（`id=eq.<eventId>`）。收到事件 / SUBSCRIBED / visibilitychange / online → debounce 重抓完整快照；每 30 秒輪詢。
- 校時：`get_clock` RPC，每 60 秒、回到前景、online 時重校。
- `src/lib/client/api.ts`：`postApi<T>(url, body, { retry: boolean })`：8 秒逾時；網路錯誤／逾時／5xx 用同一個 body（含 clientRequestId）重試最多 2 次；4xx 不重試。
- `src/lib/client/use-check-action.ts`：一個按鈕一個 hook：`{ submit(extra?), pending, error, lastRecord }`；按下立即 pending（disabled），
  產生 clientRequestId（失敗後重新送出沿用；成功或撤銷後才換新的）。ALREADY_RECORDED → 視為完成，顯示「已由另一裝置於 HH:mm:ss 記錄」。
- `src/lib/client/use-notification-watcher.ts`：(1) 偵測 `derived.conditions` 中與本頁相關、本機通知列表還沒有的 → POST /api/notifications/check（每個 key 每 5 秒最多一次，直到收到該通知）；
  (2) 已看過 id 集合：第一次載入把當下所有通知標為已看過；之後新出現、相關、A 類的 → Toast + 聲音 + Android 震動 + （可選）Browser Notification；同時多筆合併成一則。
- `src/lib/client/sound.ts`（開啟聲音按鈕：播放無聲音檔解鎖；WebAudio 短音）、`wake-lock.ts`（`useWakeLock(active)`，visibilitychange 重新 request，失敗提示一次）、`vibrate.ts`、`browser-notification.ts`（有 SW registration 用 showNotification，否則 new Notification，全部 try/catch）。
- 共用元件（`src/components/`）：`Timer`（超大倒數，依剩餘變色）、`StationStateBadge`、`TeamStateBadge`、`LiveTopBar`（遊戲切換、時間、連線狀態、資料可能過期、DEMO 橫幅、延後標籤、開啟聲音、通知中心按鈕、以總召身分操作標示）、
  `NotificationCenter`（抽屜；已解除顯示「已解除」）、`ToastStack`、`UndoButton`（依 real_created_at 與校正後真實時間倒數 60 秒）、`UndoReminderDialog`（不能點背景關閉，要按「我知道了」；複製訊息；失敗改顯示可長按選取的文字框）、`ConfirmDialog`（大按鈕）、`ErrorText`。
- 按鈕至少 56px 高（`h-14`），主要按鈕更大。每頁只顯示當下能按的主要按鈕。Light 高對比配色，戶外可讀。

## 7. 頁面（pages）

- `/`：依 session 導向（未登入 → /login；STATION → /station/<game>/<code>；TEAM → /team；ADMIN → /admin；VIEWER → /dashboard）。
- `/login`：身分類型 → 關主選遊戲與關卡／隊輔選隊伍（1~13 + 幹部隊）／總召／唯讀 → 6 位數 PIN（數字鍵盤 `inputMode="numeric"`）。
- `/dashboard` → 依 `dashboardGameForNow` 導向；`/dashboard/[game]`：頂端資訊、時段切換（上一／目前／下一）、摘要列、只看異常、關卡（桌機 table／手機 card；大地 VS 卡片）、「小隊視角」分頁、通知中心。ADMIN 在卡片上有「延長」「取消」「強制結束」等快捷。
- `/station/[game]/[code]`：SPEC 第十七、十八節。非本關身分 → 唯讀＋提示「你登入的是 X 關，前往我的關卡」。ADMIN → 有按鈕並顯示「以總召身分操作」。
- `/team`：SPEC 第十六節；TEAM 自己的隊；ADMIN / 其他身分用 `/team?team=<code>`（非本隊 → 唯讀）。依時間自動選遊戲，可手動切換。
- `/admin`：SPEC 第二十五節全部（分頁：總覽設定／排程調整／取消與延長／打卡紀錄與修正／異常／PIN／Audit／Demo 與 Reset／匯出）。

所有頁面需要登入（沒有 session → /login）；資料仍是公開可讀（SPEC 第二十節最後一點）。

## 8. 自訂決策（寫進 README）

1. 通知 dedupe key 另外包含 `trigger_override_id`：延長後再次超時是新事件。
2. TEAM_OUT_STATION_NOT_OUT 通知有 15 秒寬限（常數），避免兩邊幾乎同時按出關時誤跳 Toast；關主頁橫幅立即顯示。
3. RECORD_MISMATCH 的 trigger_record_id 使用對應紀錄（見第 3 節第 9 點），撤銷後重做視為新事件；仍滿足「每個 assignment＋隊伍＋subkind（＋紀錄）只建一筆」。
4. STATION_NOT_STARTED 在上一場尚未出關（排隊中）時不發，並從上一場出關時間起算 3 分鐘（因為關主在上一場出關前無法按進關）。
5. 延後／提前另外拒絕「調整後的開始時間 <= app_now」的情況（否則等於回頭改已經開始的時段）。
6. `app_now_for_event(event_id)`：每個活動各自的時鐘，DB 測試可以用自己的非 active 測試活動控制時間，不影響正式活動。
7. 小隊路線排除被取消的 assignment；被取消 assignment 上既有紀錄保留但不影響小隊狀態。
8. check_records 多存 `single_team_override`、`confirmed_team_ids`、`reason`（單隊開始原因、修正原因）以便 Dashboard 顯示；game/slot/station 仍經 assignment join（`v_check_records`）。
9. 所有頁面需登入才顯示 UI（資料本身非機密，anon 可讀）。
10. 登入鎖定：最近 60 秒內失敗 >= 5 次即鎖定；鎖定中的嘗試不計入失敗，所以最多鎖 1 分鐘。
