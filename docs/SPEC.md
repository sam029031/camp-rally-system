你現在是一名資深 Full-Stack Engineer。請直接替我完成一套「宿營跑關即時管理系統」，不要只寫範例、架構說明或 pseudo code，我需要可以實際執行、測試、部署的完整專案。

在開始寫程式前，請先完整讀取我附上的兩份 Excel（目前放在工作目錄根目錄）：

1. 黃金新路線 的副本 的副本.xlsx
2. 大地新跑關 的副本 的副本.xlsx

這兩份 Excel 是本系統正式跑關排程的資料來源。
每份檔案各有兩張工作表，但每份只有一張是正式排程，另一張是舊版、必須忽略（見第三節）。

========================================
一、系統用途
========================================

這是一套大學宿營活動使用的即時跑關管理系統。

共有兩個遊戲，在同一天進行：

1. 黃金傳奇（上午）
2. 大地遊戲（下午）

系統主要使用者有：

- 活動組／關主
- 隊輔組
- 管理員／總召／活動長
- 其他幹部（唯讀查看即時狀態）

現場所有人主要使用手機，因此必須 Mobile First。
總召可能使用平板或筆電查看總 Dashboard。

這不是一般排程表，而是要做到：

「抵達確認＋進關／出關打卡＋關卡即時計時＋跑關計時＋全場即時 Dashboard＋超時通知＋現場突發狀況處理（誤按撤銷、整場延後、關卡取消、漏按出關）」。

========================================
二、技術架構
========================================

請使用以下技術：

Frontend:
- Next.js（App Router）
- TypeScript（strict）
- Tailwind CSS
- shadcn/ui 或同等簡潔 UI component library

Backend / Database:
- Supabase
- PostgreSQL
- Supabase Realtime

Deployment:
- Frontend 可部署到 Vercel
- Database / Realtime 使用 Supabase

必須能：
- 手機瀏覽器直接使用
- 不需要安裝 App
- iPhone / Android / Desktop responsive
- 多台手機同時操作
- 所有人看到的狀態即時同步
- Refresh 後資料不能消失

不要把關鍵狀態只存在 localStorage。
正式紀錄必須存在 Supabase。

PWA 基本能力（只為了讓幹部加入手機主畫面）：
- app/manifest.ts、icons、apple-touch-icon 與 iOS 主畫面相關 meta。
- 不要用 next-pwa（已停止維護，與新版 Next.js 常有 build 問題）。
- service worker 可以省略；若加，只快取靜態 app shell。
  絕對不可快取 API、Server Action、Supabase REST / Realtime 的回應，
  否則 refresh 會看到舊狀態。
- 不做 Background Sync、不做 Web Push。

========================================
三、非常重要：Excel 資料規則
========================================

### A. 黃金傳奇

正式資料來源（路線與時間的唯一來源）：

工作表：
「黃金新路線」

工作表版面（已確認）：
- 第 1 列 B~N 欄（B1:N1）：13 個關卡名稱
- 第 2~9 列：第 1~8 時段，一列一時段
- A2:A9：時段時間字串，格式 'HH:MM - HH:MM'
  （一般連字號，前後各一個空白，例如 '09:10 - 09:25'）
- B2:N9：該時段該關卡的小隊編號（整數 1~13）
- 第 10、11 列：空
- 第 12 列 B~N 欄（B12:N12）：關卡代號 A~M
- 第 13 列以後：全空（工作表尺寸雖然到第 22 列，不要當成資料）

import 固定讀第 1、2~9、12 列。

13 個關卡（代號＝欄位順序）：
A 九九乘法
B 按摩墊上的身影
C 3的倍數
D 繩采飛揚
E 下午茶極與極
F 吃定你了
G 表情包猜詞
H 鐵頭功
I 節奏達人
J 異口同聲
K 跳跳36格
L 幾隻小鳥幾隻腳(是大地變黃金)
M 紅旗白旗

關卡代號：
直接讀第 12 列作為 station code，
並 validation：必須恰為依欄位順序的 A~M，否則報錯。
（原檔 F12 曾誤植成「ㄍ」，我已改回 E。若你讀到的仍不是 A~M，直接報錯並告訴我是哪一格，不要自己改。）

關卡名稱：
L 關 Excel 標題裡的「(是大地變黃金)」是排程備註，不是關名。
畫面顯示名稱用「幾隻小鳥幾隻腳」，Excel 原文另存（例如 stations.source_name）。
其他關名一律照 Excel 原文，不要改字。

共有：
- 13 個小隊
- 13 個關卡
- 8 個時段
- 沒有幹部隊

每個時段每個關卡正好分配一個小隊。

正式時段：

第1時段 09:10–09:25
第2時段 09:32–09:47
第3時段 09:54–10:09
第4時段 10:16–10:31
第5時段 10:38–10:53
第6時段 11:00–11:15
第7時段 11:22–11:37
第8時段 11:44–11:59

關卡時間：
15 分鐘

每個時段之間跑關：
7 分鐘

因此：
09:10 開始
11:59 結束

7 分鐘的意思：
預估步行 5 分鐘 + 2 分鐘緩衝。
小隊通常會提早約 2 分鐘到下一關，
這 2 分鐘是先到關卡、跟關主互動（諂媚關主）的時間，
不算在關卡時間裡（見第八節）。

系統內所有期限、倒數、validation、通知一律用 7 分鐘。
5 分鐘只用在一個地方：跑關剩餘 <= 2:00（＝已超過預估步行 5 分鐘）時顯示黃色。
黃色只改顏色，不發通知、不新增狀態（避免警報疲乏）。

注意：

Excel 另一張工作表
「每個小隊跑的路線」
是舊版排程：
- 它的時段間隔是 5 分鐘（依步行時間排的，不是正式時段間隔）
- 它的路線已經和「黃金新路線」不一致
  （8 個時段每一段都有 4~8 個關卡對不上）
- 它本身也有錯（第 13 小隊的路線 E 關出現兩次）

請完全忽略這張工作表：
不要讀取、不要 cross-check、不要拿來做 validation。
每隊路線一律由「黃金新路線」的（時段 × 關卡 → 小隊）矩陣反推。

目前這份檔案已驗證的事實
（供你對照 import 結果與撰寫本次資料的測試；不要寫成通用 validation 規則，之後換年份的排程不一定相同）：
- 每個時段的 13 個隊號恰為 1~13 的排列
- 每隊 8 個時段走 8 個「不同」關卡
  （只走 13 關中的 8 關，這是正常的，不要檢查「每隊走完全部關卡」）
- 每個關卡 8 個時段接待 8 支不同小隊
- 第2小隊路線：A→C→B→M→K→L→J→H
  （九九乘法→3的倍數→按摩墊上的身影→紅旗白旗→跳跳36格→幾隻小鳥幾隻腳→異口同聲→鐵頭功）
- 第1小隊路線：D→A→C→B→M→K→L→J

========================================
### B. 大地遊戲
========================================

正式資料來源（路線與時間的唯一來源）：

工作表：
「大地新跑關」

工作表版面與黃金相同：
- B1:K1：10 個關卡名稱
- A2:A9：時段時間字串（同上格式）
- B2:K9：PK 格（見第四節），空格子 = 該關本時段休息
- 第 10、11 列空；B12:K12：關卡代號 A~J
- 第 13 列以後全空（工作表尺寸到第 26 列，不要當成資料）

共有：
- 10 個關卡
- 13 個小隊
- 1 個幹部隊
- 共 14 隊
- 8 個時段

每個 PK 關卡由 2 隊一起進行。

14 隊 / 2 = 每個時段 7 組 PK。

因此每個時段：
- 7 個關卡啟用
- 3 個關卡休息

10 個關卡：

A ㄇㄉㄈㄎ
B 歐北共
C 戲劇之王
D (水)你坡我擋
E 幾個人來的
F 就是要你濕濕(水)
G 跳跳TEMPO
H 敲敲杯(水)
I 躲避球
J 複製人

「(水)」是水關標記，關名照 Excel 原文保留，不要刪掉。
關卡代號讀第 12 列並 validation 必須恰為 A~J。

幹部隊：
- code = 'S'，顯示名稱「幹部隊」，is_staff_team = true
- Excel 裡的「幹」（例如 7/幹、12/幹）就是幹部隊
- 只出現在大地遊戲

正式時段：

第1時段 13:05–13:25
第2時段 13:32–13:52
第3時段 13:59–14:19
第4時段 14:26–14:46
第5時段 14:53–15:13
第6時段 15:20–15:40
第7時段 15:47–16:07
第8時段 16:14–16:34

關卡時間：
20 分鐘

跑關時間：
7 分鐘（語意同黃金：步行 5 分鐘 + 提早到關 2 分鐘緩衝）

因此：
13:05 開始
16:34 結束

注意：

另一張工作表
「各隊跑關情況」
是舊版排程：
- 時段間隔是 5 分鐘（步行時間），不是正式時間
- 已知有 3 處與「大地新跑關」不同，舊表是錯的、新表自洽：
  第 3 時段第 11 隊、第 4 時段幹部隊、第 6 時段第 8 隊

請完全忽略這張工作表：
不要讀取、不要 cross-check、不要拿來做 validation。

目前這份檔案已驗證的事實（套用第五節修正後；用途同黃金，不要寫成通用規則）：
- 每時段 7 組 PK、14 隊各恰好一次、3 關休息
- 每隊（含幹部隊）8 個時段去 8 個不同關卡
- 全天沒有重複的 PK 組合
- 各時段休息關卡：
  第1 E G J
  第2 A B I
  第3 D F H
  第4 C E G
  第5 B I J
  第6 A D H
  第7 C F I
  第8 A C F
- 各關卡全天啟用次數不同（A5 B6 C5 D6 E6 F5 G6 H6 I5 J6），這是正常的，
  不要檢查「各關啟用次數相同」

========================================
### C. 隊伍
========================================

- 第 1~13 小隊在兩個遊戲是同一批隊伍：
  teams 不綁 game_id，參與哪個遊戲由 assignments 決定。
- Excel 的「第 N 小隊」（黃金）與「第 N 隊」（大地）是同一隊。
- 畫面統一顯示「第N小隊」；PK 版面空間不夠時可寫「第N隊」。幹部隊顯示「幹部隊」。
- 黃金的隊伍列表、validation、小隊視角一律不出現幹部隊。

========================================
四、大地 Excel 特殊資料問題
========================================

Excel 有很多像：

6/8
4/10
2/12
1/13
7/幹
12/幹

這些不是日期。

意思是：

6/8
= 第6小隊 vs 第8小隊

7/幹
= 第7小隊 vs 幹部隊

格子左邊為 team_a、右邊為 team_b。

實際儲存狀況（已確認，不是「可能」）：
- 含「幹」的 8 格是字串（每個時段恰一格），例如 '7/幹'
- 其餘 47 格都被 Excel 存成日期：
  number_format = 'm/d'，年份 2026 是 Excel 自動補的，沒有意義
- C5（第4時段 B 關）是一個半形空白字元 ' '（見第五節）
  （我之後可能直接在 Excel 把 C5 改成 2/4，那時它會是第 48 個日期格。
  程式與測試兩種情況都要能正確處理，不要把「47」或「C5 是空白」寫死成必過條件。）
- 其他空格子 = 該關本時段休息

讀取規則（已用 SheetJS 實測）：

XLSX.readFile(path)

sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ''
})

- raw:false：日期格會輸出 Excel 顯示文字，例如 '6/8'
- defval:''：不加的話，空格子會是 undefined（列尾的空欄甚至不在陣列裡），
  String(v) 會變成 'undefined' 而被誤判成格式錯誤；加了之後每列長度固定、空格一律是 ''
- 不要用 cellDates:true，也不要自己拿 cell.v 的日期值：
  會得到台灣時間午夜的 Date（UTC 前一天 16:00），
  用 UTC 取日期會把 6/8 變成 6/7
- 每一格先 String(v).trim()；trim 後為空字串 = 該關本時段休息
- 黃金格子在 raw:false 下是字串 '2'，要轉成整數

PK 格解析：
/^(\d{1,2})\/(\d{1,2}|幹)$/
兩個隊號都要在 1~13 之間且不相同。

如果改用其他 library 而拿到日期值：
取它的 month / day（以台灣時間，不要用 UTC）
轉回 team_a = month、team_b = day。

例如：

Excel 儲存 2026/6/8

在本系統應解析成：

team_a = 6
team_b = 8

不是日期 2026-06-08。

時段字串解析：
/^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/
解析出來的 start/end 必須和本 prompt 列出的正式時段完全一致，否則報錯。

任何格子 trim 後非空、但不符合上述格式：
import 直接報錯，印出工作表名稱與儲存格座標（例如「大地新跑關!C5」）。

========================================
五、已知的大地資料修正
========================================

「大地新跑關」

第4時段：
14:26–14:46

B 關：
歐北共

原 Excel 該格（C5）內容是一個半形空白字元，不是 0（若我已經改成 2/4，就直接是日期格）。
同一列的 G 關（H5）才是真正的空格子，代表 G 關本時段休息，這是正確的。

C5 trim 後為空，第4時段就只剩 6 組 PK、缺第2與第4小隊。

正確值已由人工確認為：

第2小隊 vs 第4小隊

也就是：

2/4

修正機制：
- 在 import script 裡集中放一份 overrides 清單，每筆含 game、slot、station、value、reason，例如：
  { game: 'land', slot: 4, station: 'B', value: '2/4', reason: '原檔該格為空白字元，人工確認為第2、4小隊' }
- 不要把 2/4 散寫在 parser 裡，也不要自動修改 Excel 檔。
- 流程順序：讀取 Excel → 套用 overrides（terminal 印出套用了哪幾筆）→ validation → 匯入。
- 如果之後 Excel 該格已經被我改成 2/4：override 與原值相同時只印提示，不報錯。
- 如果該格變成其他非空值：報錯，要求人工確認，不要自動覆蓋。

除了這一格，兩份正式工作表其餘資料都已驗證合法，不需要其他修正。
import 若發現任何其他錯誤，直接報錯，不要自動猜測。

請在程式碼中加入 validation，
確認每一個大地遊戲時段：

13 個小隊 + 幹部隊
總共 14 隊
必須每隊恰好出現一次。

如果：
- 缺隊
- 同一隊重複
- 不是 7 組 PK

seed/import 時必須直接報錯。

========================================
六、資料庫設計
========================================

請設計合理 relational schema，正規化，不要硬塞 JSON
（client_info、audit log 的 before/after 可以用 jsonb）。

下面的欄位與約束是第七～二十二節能正確運作的前提。
命名可以調整，語意不可以改變。

events
- id, name
- event_date (date)
- timezone（'Asia/Taipei'）
- is_active
- Demo 時鐘欄位：sim_enabled, sim_speed, sim_anchor_real, sim_anchor_virtual（見第三十一節）
- 撤銷提醒用的名稱（admin 可改，見第二十二節）：
  team_group_label（預設「隊輔群」）、station_group_label（預設「活動組群」）、lead_title（預設「活動長」）

games
- id, event_id
- code（'gold' | 'land'）, name
- station_duration_seconds（900 / 1200）
- transition_duration_seconds（420）
- teams_per_station（1 / 2）
- end_policy：'FULL_DURATION' | 'FIXED_END'（黃金預設 FULL_DURATION、大地預設 FIXED_END，見第八節；admin 可改）
- min_play_seconds（FIXED_END 壓縮後的最短可玩時間門檻，大地預設 600）

time_slots
- id, game_id, slot_number（1..8）
- start_local (time), end_local (time)（原定時間，import 後不因延後而改）
- unique(game_id, slot_number)

schedule_adjustments（整場延後／提前，見第二十四節；append-only）
- id, game_id
- from_slot_number（從第幾時段起生效）
- offset_seconds（正數延後、負數提前）
- input_mode：'DELAY' | 'START_AT'（只是記錄管理員用哪種方式輸入，計算一律用 offset_seconds）
- reason, identity_id, created_at
- voided_at, voided_by, void_reason（撤銷調整用，不 hard delete）

排程完整時間由一個 view（例如 v_slot_times）計算：
scheduled_start = (event_date + start_local) 視為 Asia/Taipei 時間轉成 timestamptz，
  再加「該遊戲所有未撤銷、且 from_slot_number <= 本時段」的 offset_seconds 總和。
scheduled_end 同理。
view 同時輸出 original_start / original_end（未加延後）與 total_offset_seconds，給畫面顯示「原定 09:54」。
所有程式（SQL、server、前端）一律從這個 view 取排程時間，不可以各自計算。

assignment_cancellations（關卡取消，例如下雨停辦水關；append-only）
- id, assignment_id, reason, identity_id, created_at, voided_at, voided_by, void_reason
- 同一 assignment 只能有一筆有效取消（partial unique index WHERE voided_at IS NULL）

assignment_end_overrides（admin 延長或改結束時間；append-only）
- id, assignment_id, official_end timestamptz, reason, identity_id, created_at, voided_at, voided_by, void_reason
- 同一 assignment 只能有一筆有效 override

stations
- id, game_id, code, name（顯示名稱）, source_name（Excel 原文）, sort_order
- unique(game_id, code)

teams
- id, code（'1'..'13', 'S'）, name, is_staff_team

assignments
- id, game_id, slot_id, station_id
- team_a_id（not null）
- team_b_id（黃金一律 NULL；大地一律 NOT NULL 且 <> team_a_id）
- unique(slot_id, station_id)
- 大地休息的關卡不建立 assignment；UI 以「該時段該關卡沒有 assignment」顯示休息
- 「每隊每時段恰一次」由 import validation 保證
- assignments 與 teams 不得有 status、started_at、cancelled 之類的欄位（狀態一律推導，見第十節；
  取消與延長放在上面兩張 append-only 表）

黃金傳奇：
一個 assignment：
slot + station + team

大地遊戲：
一個 assignment：
slot + station + team_a + team_b

identities（access identities）
- id, role（ADMIN | STATION | TEAM | VIEWER）
- station_id（STATION 用）, team_id（TEAM 用）
- label, pin_hash, pin_version（int，每次改 PIN 就 +1）, is_active

check_records（append-only 正式打卡紀錄）
- id
- client_request_id uuid UNIQUE（冪等鍵，見第二十一節）
- assignment_id（not null）
- action：station_check_in | station_check_out | team_check_in | team_check_out
- team_id：關主側動作一律 NULL（大地兩隊共用）；隊輔側動作 = 該隊
- no_show boolean default false（「本隊未到」，見第十七節）
- recorded_at timestamptz：正式時間。
  source = 'ui' 或 'admin_force' 時由 DB 的 app_now() 產生，不接受 client 傳入；
  source = 'admin_correction' 時是管理員指定的時間（server 驗過 ADMIN session 後才傳入 RPC）。
- real_created_at timestamptz default now()
- identity_id
- source：'ui' | 'admin_correction' | 'admin_force'
- client_info jsonb（簡短裝置資訊即可；這張表所有人都讀得到，不要存 IP）
- voided_at, voided_by, void_reason, replaces_record_id（撤銷用，不 hard delete）
- 有效紀錄唯一（PostgreSQL 15+；要用 partial unique index，table constraint 不能帶 WHERE）：
  CREATE UNIQUE INDEX check_records_one_valid
    ON check_records (assignment_id, action, team_id) NULLS NOT DISTINCT
    WHERE voided_at IS NULL;
  一定要加 NULLS NOT DISTINCT，否則關主側 team_id 為 NULL 的紀錄擋不住重複。
- game / slot / station 一律經 assignment join 取得，不要重複存。

notifications
- id
- kind（第十五節）：
  STATION_OVERTIME | TRANSITION_OVERDUE | STATION_NOT_STARTED | PREV_NOT_CHECKED_OUT |
  STATION_SHORTENED | SCHEDULE_ADJUSTED | SELF_UNDO | RECORD_MISMATCH
- game_id（not null）
- subkind text（可為 NULL；RECORD_MISMATCH 用來區分第十節 C 的標籤種類，例如 TEAM_OUT_STATION_NOT_OUT、CHECKOUT_TIME_DIFF、TEAM_NOT_CHECKED_IN…）
- assignment_id, team_id, trigger_record_id, trigger_adjustment_id, trigger_cancellation_id（皆可為 NULL）
- trigger_phase：'CREATE' | 'VOID'（預設 CREATE；撤銷一筆調整或取消時建立 VOID 那一則，才不會和原本的通知撞 key）
- message text（直接存要顯示的文字，例如延後通知內容）
- invalidated_at（撤銷或修正讓事件不再成立時標記，不刪除）
- created_at（app_now()）
- CREATE UNIQUE INDEX notifications_once
    ON notifications (kind, subkind, assignment_id, team_id, trigger_record_id,
                      trigger_adjustment_id, trigger_cancellation_id, trigger_phase) NULLS NOT DISTINCT;

audit_logs
- id, actor_identity_id, action, target_table, target_id
- before jsonb, after jsonb, reason, client_info, created_at
- 要記錄：撤銷、修正時間、補登、強制結束、現場撤銷、本隊未到、被拒絕的打卡、重複打卡嘗試、
  登入失敗、PIN 修改、延後排程與撤銷延後、關卡取消、延長時間、大地單隊開始、Demo 設定變更、Reset。

========================================
七、進關／出關採「雙方紀錄」
========================================

活動組和隊輔組都要紀錄進關、出關。

兩邊不能覆蓋彼此資料。

例如：

九九乘法
第2小隊

Activity side:
09:10:18 關主確認進關

Team side:
09:10:23 隊輔確認進關

出關亦同。

需要記錄：

station_check_in
team_check_in

station_check_out
team_check_out

每一筆包含：

- timestamp（server 產生）
- user / identity
- assignment（由它得到 game、slot、station）
- team（隊輔側）
- action
- client/device information if useful
- created_at

不可只保留最後一個結果。

兩側紀錄的規則：
- 關主側（station_check_in / station_check_out）：掛在 assignment 上，team_id = NULL。
  黃金：一筆代表那一隊。大地：一筆代表 PK 兩隊共用（第十八節）。
  正式關卡計時只看關主側。
- 隊輔側（team_check_in / team_check_out）：掛在 assignment + team_id，大地兩隊各自一筆。
- 按的順序不限：隊輔可以比關主先按（小隊先到關卡時就按「確認進關」），關主也可以先按。
- 隊輔的紀錄不影響關卡計時；
  但隊輔「確認進關」代表該隊已經抵達，會結束該隊的跑關計時（第九節）。
- 抵達的兩種層級（不另外新增 action，靠既有兩種進關紀錄區分）：
  - 隊輔「確認進關」＝ 隊輔回報已抵達（自我回報，尚未經第三方確認）。
    畫面顯示「已到（隊輔回報）」，用虛線框與正式抵達區分。
  - 關主「確認進關」＝ 關主親眼確認正確的隊伍到了正確的關卡（正式抵達），同時決定計時起點（第八節）。
  - 關主頁要用大字顯示「本關預期隊伍」，避免隊伍跑錯關卻被確認。
  - 隊輔回報後關主遲遲沒有進關，由 STATION_NOT_STARTED 通知處理（第十五節）。
- 抵達的定義（寫進 README 的工作人員一頁說明）：隊輔和多數隊員到達關卡才算抵達，才可以按確認進關。
- 所有時間一律由 DB 產生（app_now()）。手機時間只能放進 client_info。

========================================
八、正式計時規則
========================================

正式「關卡計時」：

以「活動組／關主按下進關」為準，
但不早於該時段的預定開始時間：

started_at = max(station_check_in.recorded_at, slot.scheduled_start)

黃金傳奇：
15 分鐘

大地遊戲：
20 分鐘

remaining =
duration - (now - started_at)

提早到關：
- 小隊常會提早約 2 分鐘到（諂媚關主時間），關主可以在預定開始前就按進關。
- 紀錄保留實際按下時間，但倒數從 scheduled_start 才開始。
- 關主頁顯示「已進關 09:30:12，09:32 開始計時」，並倒數到開始。
- 例：第2時段 09:32 開始，關主 09:30 按進關 → 09:32 起倒數 15:00，09:47 時間到。
  不可以從 09:30 起算，否則 09:45 就提早結束，整條路線會越跑越早。
- 小隊晚到（09:35 才按）→ started_at = 09:35。結束時間依下面的 end_policy 決定。

正式結束時間 official_end（依 games.end_policy）：

FULL_DURATION（黃金預設）：
official_end = started_at + duration
晚開始就晚結束，一定玩滿 15 分鐘。

FIXED_END（大地預設）：
official_end = min(started_at + duration, 該時段 scheduled_end)
大地必須兩隊到齊才能開始（第十八節）。因為等人而晚開始時，壓縮遊戲時間，結束時間不往後拖。
- 例：第4時段 14:26–14:46，第4小隊晚到，14:29 才開始 → official_end 仍是 14:46，只玩 17 分鐘。
- scheduled_end 是 v_slot_times 的值，已包含整場延後（第二十四節）。

若該 assignment 有有效的 assignment_end_overrides，official_end 以 override 為準。

FIXED_END 的壓縮規則：
- 可玩時間 = official_end − started_at。小於 duration 時，Dashboard 與關主頁顯示「本場縮短 03:00，至 14:46 結束」。
- 關主按開始時，若可玩時間 < games.min_play_seconds：先跳確認「本場只剩 08:30，確定開始？」，
  開始後建立 STATION_SHORTENED 通知給總召，總召可在 /admin 或 Dashboard 一鍵延長（建立 end override）。
- app_now() 已經 >= scheduled_end 時，record_check 拒絕 station_check_in（error code SLOT_ALREADY_ENDED），
  關主頁提示「本時段已結束，請聯絡總召延長或取消本場」。
  已有有效 end override 且 override 在未來時，才允許開始。

不要單純靠前端：

remaining -= 1

必須用 server 紀錄的時間推導 started_at，
now 來自統一時鐘（第三十一節的 app_now()，前端做 server 時間校正）。

避免：
- 手機鎖屏
- browser background
- lag
- refresh
- 手機本身時鐘不準

造成計時錯誤。

所有裝置重新整理後，
倒數仍必須正確。

兩種倒數，不可混用：
1. 關卡剩餘（timer）= official_end − now。
   OVERTIME、紅色、超時通知、第三十四節的「時間到」都只指它。
2. 時段剩餘（排程）= scheduled_end − now，只用在 Dashboard 頂端。
例（黃金 FULL_DURATION）：09:13 才進關 → 關卡剩餘算到 09:28，時段剩餘算到 09:25；09:25–09:28 不算超時、不發通知。
例（大地 FIXED_END）：兩者結束時間相同。

Dashboard 與關主頁顯示「較預定 +00:18」（started_at − scheduled_start，正數代表延後）。

========================================
九、跑關 7 分鐘計時
========================================

關主按「確認出關」後（不是隊輔出關），
該隊立刻進入：

TRANSITIONING

下一關由排程自動算出：該隊在同一遊戲的下一個時段 assignment。

跑關期限：

deadline =
max(station_check_out.recorded_at + 7 分鐘, 下一時段 scheduled_start)

- 準時或晚出關：剛好給足 7 分鐘。
- 提早出關（例如 09:20）：期限是 09:32，不會在 09:27 誤報逾期。

跑關剩餘 = deadline − now

「抵達」＝ 該隊在下一關的 team_check_in 或該關的 station_check_in，取最早的一筆。
抵達即停止跑關計時。

例如：

第2小隊
已離開九九乘法

下一關：
3的倍數

須於 09:32:00 前抵達

跑關剩餘：
06:43

如果到了 deadline 仍未抵達：

狀態：
TRANSITION_OVERDUE

Dashboard 顯示警告並通知（第十五節）。

其他規則：
- 跑關剩餘 <= 2:00 顯示黃色：代表已超過預估步行 5 分鐘，應該快到了。
- 第1時段沒有上一關：deadline = 第1時段 scheduled_start。
- 該隊最後一個 assignment（第8時段）出關後直接 COMPLETED，不進入 TRANSITIONING。
- 跑關計時不跨遊戲：黃金結束不會倒數到大地。
- 隊伍已抵達，但下一關上一隊還沒出關（上一場超時）：
  小隊顯示「已到，排隊中（前一隊尚未出關）」，跑關已停止，延誤算在關卡端，不算隊伍逾期。
- 該隊的某個 assignment 被取消（第二十四節之二）：
  把被取消的時段當成「該隊在那一段沒有關卡」，
  上一段的跑關目標直接跳到取消時段之後的下一個 assignment，
  deadline = max(上一關出關 + 7 分鐘, 那個 assignment 的 scheduled_start)。
  隊輔頁顯示「第3時段 下午茶極與極 已取消（原因），下一關：…」。

大地遊戲同理。

大地一次有兩隊一起出關（共用同一筆關主出關），
兩隊各自有不同的下一關，各自計算抵達與逾期。
例：第1時段 A 關第6小隊 vs 第8小隊出關後，
第6小隊前往 D (水)你坡我擋，第8小隊前往 C 戲劇之王。

========================================
十、狀態機
========================================

不要到處用 boolean。

狀態不存成欄位。
DB 只存事件（check_records）與通知；
所有狀態由 pure function 推導：

狀態 = f(有效打卡紀錄, 排程時間（含延後）, 有效取消, 有效 end override, now)

Dashboard、關主頁、隊輔頁、小隊視角都呼叫同一組 function，並寫 unit test。
撤銷或修正紀錄後，狀態自動依剩餘的有效紀錄重算。

有兩台互相獨立的狀態機：

### A. 關卡時段狀態（每個 assignment 一個）

REST          該關本時段沒有 assignment（只有大地）
CANCELLED     該 assignment 有有效取消（優先於其他狀態；已有打卡紀錄也照樣顯示取消，紀錄保留）
WAITING       尚無任何抵達紀錄
READY         已抵達但計時尚未開始：
              隊輔已確認進關而關主還沒按；或關主已按但還沒到 scheduled_start
IN_PROGRESS   now >= started_at，尚未關主出關，剩餘 > 2:00（剩餘 = official_end − now）
ENDING_SOON   同上，0 < 剩餘 <= 2:00
OVERTIME      同上，剩餘 <= 0
CHECKED_OUT   已有有效 station_check_out（no_show = true 時顯示為「未到」）

### B. 小隊狀態（每隊每個遊戲一個）

「該隊的有效紀錄」＝未撤銷、且 team_id = 該隊的隊輔側紀錄，加上該隊所在 assignment 上 team_id 為 NULL 的關主側紀錄。
同一個 assignment 另一隊的隊輔紀錄不算（大地第6小隊隊輔按進關，不代表第8小隊到了）。

先找出該隊「最後一個有任何有效紀錄的 assignment」，稱為 last：

- 沒有 last（完全沒有紀錄）：
  目標是第一個 assignment；now < deadline → WAITING；否則 → TRANSITION_OVERDUE（文字「未到第一關」）
- last 已有關主出關：
  last 是最後一個 assignment → COMPLETED；
  否則目標是下一個 assignment → TRANSITIONING 或 TRANSITION_OVERDUE（deadline 見第九節）
- last 尚無關主出關：
  計時還沒開始 → ARRIVED；計時中 → AT_STATION（顏色跟隨該關卡狀態）

用「最後一個有紀錄的 assignment」而不是「第一個未出關的 assignment」，
是為了處理關主忘記按出關、小隊已經走到下一關的情況：
小隊狀態跟著小隊走，上一關那一列另外標示「未出關（隊伍已到下一關）」，讓關主或總召補按。

ARRIVED 的顯示細分（仍是同一個狀態，只是文字不同）：
- 「已到（隊輔回報）」：只有隊輔進關，關主尚未進關
- 「已到，等待開始」：關主已進關、尚未到 scheduled_start
- 「已到，等待對手」：大地，本隊已到、同組另一隊還沒有任何抵達紀錄
- 「已到，排隊中」：該關上一個 assignment 尚未關主出關

計算跑關時，被取消的 assignment 視為不存在（第九節）。

### C. 次要標籤（不改變主狀態與主色，用角標或邊框顯示）

每個 assignment 另外顯示雙方確認狀況：
- 「隊輔未確認進關」：計時已開始 90 秒，該隊隊輔仍未按進關
- 「隊輔未確認出關」：關主出關 90 秒後，該隊隊輔仍未按出關
- 「隊輔已出關，關主未出關」：最危險的一種（人已經離開，計時還在跑）。
  除了標籤，關主頁要顯示醒目橫幅「第2小隊隊輔已於 09:25:10 回報出關，請確認出關」
- 「紀錄不一致」：同一隊的隊輔出關與關主出關時間差超過 60 秒
- 「未出關（隊伍已到下一關）」：見上方 B 的說明
- 「隊輔漏按進關」：隊輔完全沒有進關紀錄就出關（第二十一節）

門檻（90 秒、60 秒）放在程式常數，README 寫明位置。
這些標籤由推導 function 算出，不寫 DB；
每一種標籤在同一 assignment＋隊伍只建立一次通知（第十五節）：
「未出關（隊伍已到下一關）」→ PREV_NOT_CHECKED_OUT；其他標籤 → RECORD_MISMATCH，subkind 標明是哪一種。
只有 subkind = TEAM_OUT_STATION_NOT_OUT（隊輔已出關，關主未出關）會對該關關主頁跳 Toast，其餘只進通知中心與異常清單。

========================================
十一、總 Dashboard
========================================

這是系統最重要頁面。

隊輔組、活動組、總召都能看。

路由：
/dashboard/gold
/dashboard/land
頂端可以切換遊戲。
/dashboard 自動導向：黃金最後時段結束前 → 黃金，其後 → 大地。

Dashboard 頂端顯示：

遊戲：
黃金傳奇 / 大地遊戲

目前時間（HH:mm:ss）

目前：
第幾時段

時段：
09:10–09:25

時段剩餘（預定）：
08:23

有整場延後時：
頂端顯示明顯標籤「第3時段起已延後 10 分鐘」，時段時間旁小字「原定 09:54」。

「目前時段」k 的定義（依 now 與 v_slot_times）：
- now < 第1時段開始：k = 1，顯示「尚未開始，09:10 開始」
- 時段進行中：顯示「第k時段 09:10–09:25 時段剩餘 08:23」
- 兩個時段之間的 7 分鐘：歸屬下一個時段，顯示「跑關中，第k時段 09:32 開始，還有 04:10」
- 最後時段結束後：顯示「本遊戲已結束」

可以切：

上一時段
目前時段
下一時段

切換只改變瀏覽的時段，不影響倒數、狀態、通知。
瀏覽非目前時段時明顯標示「檢視中：第N時段（非目前）」。

每一個關卡列顯示哪個 assignment（瀏覽目前時段時）：
- 該關上一個 assignment 的關卡時段狀態是 READY、IN_PROGRESS、ENDING_SOON 或 OVERTIME
  （例如超時拖到下一時段）→ 繼續顯示上一隊，顏色照它自己的狀態，
  下面小字顯示本時段的隊伍「第1小隊 前往中／已到 09:30」
- 上一個 assignment 仍是 WAITING（完全沒有紀錄）→ 不佔住這一列，直接顯示本時段的 assignment，
  另加標籤「上一時段 第N小隊 未到，待按本隊未到」，並列入「只看異常」。
  關主頁仍依第十七節停在那一隊，直到關主按開始或「本隊未到」。
- 否則顯示本時段的 assignment，包含正在前往的小隊（「第2小隊 前往中 剩 03:12」）
- 大地本時段沒有 assignment →「本時段休息」，小字顯示下一組時間與隊伍

- 被取消的 assignment →「已取消（原因）」灰色，不是故障

總召用的摘要列：
本時段 進行中／將結束／超時／等待開始／跑關中／跑關逾期 各幾個，
並提供「只看異常」切換（只顯示超時、跑關逾期、未出關、未到、第十節 C 的次要標籤）。

========================================
十二、黃金傳奇 Dashboard
========================================

用表格 / Card 顯示 13 關。

例如：

關卡
九九乘法

分配：
第2小隊

預定：
09:10–09:25

關主進關：
09:10:18

隊輔進關：
09:10:23

關主出關：
--

隊輔出關：
--

關卡剩餘：
08:21

較預定：
+00:18（started_at − scheduled_start，正數代表延後）

狀態：
進行中

同一頁一次顯示 13 關。

桌機使用 table。
手機可以 card / compact table。

========================================
十三、大地遊戲 Dashboard
========================================

一次顯示 10 關。

例如（第4時段 14:26–14:46）：

歐北共

第2小隊
VS
第4小隊

（兩隊各有自己的狀態標籤與隊輔進關／出關時間）

等人時：
第2小隊 已到 14:24（隊輔回報）　等待對手
第4小隊 前往中 剩 01:10
狀態：已到，等待對手

開始後：

關主進關：
14:29:08

結束：
14:46（本場縮短 03:08）

剩餘：
16:32

狀態：
進行中

沒有被分配的三關：

顯示：

本時段休息

不要顯示成故障或尚未進關。

========================================
十四、視覺狀態
========================================

關卡列／card 的主色依「關卡時段狀態」：

灰：
WAITING（尚未開始）、CHECKED_OUT（顯示進出時間）、REST（文字「本時段休息」）、CANCELLED（文字「已取消」）

紫：
READY（已到，等待開始）

綠：
IN_PROGRESS（正常進行）

黃：
ENDING_SOON（剩餘 <= 2 分鐘）

紅：
OVERTIME（超時）

小隊標籤的顏色依「小隊狀態」：

藍：
TRANSITIONING（跑關中；剩餘 <= 2:00 轉黃）

紅：
TRANSITION_OVERDUE（跑關逾期／未到）

紫：
ARRIVED（已到，等待開始／等待對手／排隊中）；「已到（隊輔回報）」用紫色虛線框

灰：
WAITING、COMPLETED

AT_STATION 跟隨關卡顏色。

「未到」（no_show）：灰底紅字。

第十節 C 的次要標籤：用橘色角標或邊框，不蓋掉主色。

FIXED_END 壓縮後可玩時間 < min_play_seconds：關卡卡片加黃色「時間不足」標籤。

但仍需保留文字，
不能只靠顏色判讀。

========================================
十五、超時通知
========================================

這是必要功能。

通知分兩類。

【A 類：會跳 Toast／聲音的主要通知】

1. STATION_OVERTIME（關卡超時）
   到了 official_end（第八節：黃金 started_at + 15 min；大地 min(started_at + 20 min, scheduled_end)；有 override 以 override 為準），
   關主還沒按出關。

2. TRANSITION_OVERDUE（跑關逾期）
   跑關 deadline 已到，小隊仍未抵達下一關。

3. STATION_NOT_STARTED（關主未開始）
   該關這一組的所有隊伍都已由隊輔確認到關（黃金 1 隊、大地 2 隊都到），
   但 max(最後一隊的隊輔進關時間, scheduled_start) 過了 3 分鐘，關主仍未按進關
   （多半是關主手機沒電或沒開頁面）。
   大地只有一隊到時不發，因為關主本來就該等另一隊。

4. PREV_NOT_CHECKED_OUT（漏按出關）
   該隊已在下一關有任何抵達紀錄，但上一關仍沒有有效 station_check_out。
   通知對象：上一關關主頁（醒目橫幅「第2小隊已到下一關，請立即按出關」）、Dashboard。
   trigger_record_id = 下一關最早那筆抵達紀錄。
   系統不自動替關主寫出關紀錄（紀錄一律由人按，時間由總召事後修正）。

5. STATION_SHORTENED（大地可玩時間不足）
   FIXED_END 下關主開始時可玩時間 < min_play_seconds。由 record_check 在寫入 station_check_in 的同一個 transaction 內建立，
   不走 /api/notifications/check。trigger_record_id = 那筆 station_check_in。
   通知對象：Dashboard、admin。通知上有「延長」按鈕（只有 ADMIN 看得到）。

6. SCHEDULE_ADJUSTED（整場延後／提前，第二十四節）
   由延後的 RPC 直接建立（trigger_adjustment_id = 那筆調整），不是推導條件。
   通知對象：全場所有頁面。內容例如「黃金傳奇 第3時段起延後 10 分鐘，第3時段改為 10:04 開始」。
   撤銷調整時建立另一則 SCHEDULE_ADJUSTED（同一個 trigger_adjustment_id，trigger_phase = 'VOID'），內容寫撤銷後的時間。
   關卡取消（第二十四節之二）也用 SCHEDULE_ADJUSTED，trigger_cancellation_id = 那筆取消；撤銷取消時 trigger_phase = 'VOID'。

7. RECORD_MISMATCH 且 subkind = TEAM_OUT_STATION_NOT_OUT（隊輔已出關，關主未出關，第十節 C）：
   只對該關關主頁跳 Toast，其他頁面只列在通知中心。

【B 類：只列在通知中心，不跳 Toast】

- SELF_UNDO：有人自行撤銷（第二十二節）。由撤銷的 RPC 直接建立，trigger_record_id = 被撤銷的紀錄。
- RECORD_MISMATCH 的其他 subkind：第十節 C 的其他次要標籤（隊輔未確認、時間差 > 60 秒、隊輔漏按進關等），
  每個 assignment＋隊伍＋subkind 只建一筆。
- 跑關剩餘 <= 2:00 的黃色：只改顏色，不建通知。

撤銷或修正紀錄後，若某則通知的條件不再成立，把它標記 invalidated_at，通知中心顯示為「已解除」，不刪除。

A 類條件成立時 Dashboard 必須立刻跳 notification。

例如：

⚠️ 關卡超時

九九乘法
第2小隊

已超時：
01:24

尚未出關

通知方式至少：

1. 畫面 Toast
2. Dashboard notification center
3. 該關卡整列 / card 紅色
4. 可選聲音提醒

同時多筆時合併成一則（例如「3 關超時」），不要疊一整排。

如果瀏覽器允許 Notification API，
可以額外支援 Browser Notification（不做 Web Push）。
它是最後一步、可有可無：先顯示 Toast 與播放聲音，再嘗試系統通知。
有註冊 service worker 時用 registration.showNotification()，否則用 new Notification()
（Android Chrome 不支援 new Notification()，會丟錯）。整段包在 try/catch，失敗就靜默略過，不能影響 Toast 與聲音。

但不要把 Browser Notification 當成唯一通知方式，
因為可能沒有 permission。

通知不得每秒一直跳。

同一次超時事件只觸發一次主要通知，
之後持續更新 overtime duration 即可。

實作方式（Supabase 沒有常駐的 server timer，照這樣做）：
- 超時是推導狀態：每台裝置用統一時鐘每秒自己算，紅色與超時秒數不靠 DB。
- 每個頁面（Dashboard、關主頁、隊輔頁）都對自己已載入的 assignment／隊伍偵測推導型的條件
  （STATION_OVERTIME、TRANSITION_OVERDUE、STATION_NOT_STARTED、PREV_NOT_CHECKED_OUT、RECORD_MISMATCH）。
  條件成立、而本機的通知列表裡還沒有對應那一筆時，呼叫 POST /api/notifications/check，
  body 只帶 kind、subkind、assignment_id、team_id，不帶任何時間。
  （STATION_SHORTENED、SCHEDULE_ADJUSTED、SELF_UNDO 由各自的 RPC 在同一 transaction 內直接建立，不走這個 route。）
- server 自己重抓紀錄，用同一組推導 function 與 app_now() 確認條件真的成立，
  才 insert notifications … ON CONFLICT DO NOTHING，回傳 created／exists／not_yet。
  多台同時偵測也只會有一筆。
- not_yet 不是錯誤（裝置和 server 的時間可能差不到一秒）：同一個 key 每台裝置最多每 5 秒再試一次，
  直到收到那一筆通知為止。這個 route 需要任一有效 session（含 VIEWER）。
- 跳不跳 Toast：每個頁面在記憶體保存「已看過的通知 id」。
  第一次載入（含 refresh）時，把當下所有通知標成已看過，不跳，只列在 notification center。
  之後不論是 Realtime INSERT、reconnect、回到前景或 30 秒輪詢的重抓，
  只要出現還沒看過、和本頁相關、而且是 A 類的通知，就跳一次 Toast／聲音並標成已看過；B 類只進通知中心。
- 超時秒數不寫 DB，畫面持續更新。
- trigger_record_id：關卡超時 = 那筆 station_check_in；跑關逾期 = 上一關那筆 station_check_out
  （第1時段為 NULL）；關主未開始 = 最後到的那一隊的 team_check_in（team_id NULL）。
  撤銷進關後重新進關，視為新的一次事件。
- 大地 STATION_OVERTIME 一組 PK 一筆（team_id NULL，內容列出兩隊）；TRANSITION_OVERDUE 每隊一筆。
- 通知對象：所有 Dashboard、該關關主頁、相關隊伍的隊輔頁。

聲音與震動：
- iOS / Android 需要使用者手勢才能播放聲音。
  提供「開啟聲音」按鈕（按下時播放一段無聲音檔解鎖）；關主按進關本身也算手勢。
  未解鎖時只用畫面提示。
- 震動只有 Android 有（navigator.vibrate，呼叫前先檢查函式存在）；iPhone 沒有震動，只有畫面與聲音。

========================================
十六、隊輔操作頁
========================================

路由：/team（登入後自動進入自己隊伍）。
依時間自動顯示目前的遊戲（規則同 /dashboard），可以手動切換。

每個隊輔只需要看到自己隊伍。

目前關卡 = 第十節 B 小隊狀態機指向的 assignment。

例如：

第2小隊

目前：
九九乘法

預定：
09:10–09:25

關主：
已於 09:10:18 確認進關

按鈕：

[ 確認進關 ]

到達關卡時就可以按，不必等關主。
關主還沒按時，按完顯示「已到，等待關主開始」。

完成後按鈕 disabled，
並顯示：

隊輔確認：
09:10:23

關主按出關後，頁面立刻顯示（隊輔不需要先按出關）：

關主已於 09:25:31 確認出關
[ 確認出關 ]

下一關：
3的倍數

須於 09:32:31 前抵達

跑關剩餘：
06:42

隊輔按「確認出關」只增加一筆隊輔紀錄。
隊輔也可以比關主先按出關：顯示「等待關主確認出關」，跑關計時仍從關主出關開始算。

最後一關出關後：
顯示「黃金傳奇完成」，並顯示下午大地第一站與時間（只顯示，不倒數）。

幹部隊在黃金時段打開 /team：
顯示「幹部隊不參加黃金傳奇，下午大地第一站：<關卡> <時間>」。

不要讓隊輔手動選下一關。

下一關必須由排程自動算。

大地時也顯示同組對手與對手是否已到，例如「對手第4小隊 前往中 剩 01:10」。
本隊下一個 assignment 被取消時，顯示「第3時段 XX 已取消（原因）」並直接指向再下一關。

按下任何確認後 60 秒內顯示 [ 撤銷（剩 45 秒）]（見第二十二節）。
頁面在跑關與關卡進行中保持亮屏（規則同第十七節的 Wake Lock）。

========================================
十七、活動組／關主頁
========================================

每一個關卡有自己的頁面。

例如：

/station/gold/A

顯示：

黃金傳奇
A
九九乘法

目前時段：
第1時段

分配：
第2小隊

預定：
09:10–09:25

主卡片顯示哪一個 assignment：
該關「最早一個尚未關主出關的 assignment」，不依時鐘決定。
- 關主沒按出關前，就算已經到下一時段，頁面仍停在這一隊並顯示紅色超時，按出關後才切到下一隊。
- 上一隊出關後，下一隊的進關按鈕立刻可以按（小隊提早到就能按）。
- 下一隊隊輔已確認到關時，顯示「下一隊第1小隊已到（隊輔回報）」。
- 主卡片用大字顯示「本關預期隊伍：第2小隊」，關主按進關前先核對來的是不是這一隊。
- 被取消的 assignment 直接跳過，不停在它上面。
- 醒目橫幅（紅底，蓋在最上方，直到條件解除）：
  - 「第2小隊已到下一關，請立即按出關」（PREV_NOT_CHECKED_OUT）
  - 「第2小隊隊輔已於 09:25:10 回報出關，請確認出關」（第十節 C）

[ 確認進關 ]

比預定開始早超過 7 分鐘按下時，先跳確認「尚未到時段，確定小隊已經到了？」。

按下後：

若還沒到預定開始：顯示「已進關 09:08:40，09:10 開始計時」並倒數到開始。
到了預定開始：正式開始倒數。

顯示超大 Timer：

14:59

時間 <= 2:00：
黃色

<= 0：
紅色

顯示：

超時 +00:31

[ 確認出關 ] 從進關之後就一直在（提早結束也可以按，不是超時才出現）。

每個動作按下後 60 秒內，按鈕下方顯示 [ 撤銷（剩 45 秒）]（第二十二節）。

剩 2:00 與 0:00 時各提醒一次：Android 震動；聲音已解鎖時播放短音；iPhone 只有畫面與聲音。
只在這一台裝置「親眼看到跨過門檻」時觸發（上一個 tick 在門檻之上、這一個 tick 在門檻以下），
載入或 refresh 時已經過了的門檻不補觸發。

計時中用 navigator.wakeLock.request('screen') 保持亮屏：
頁面回到前景（visibilitychange 變 visible）時要重新 request，失敗就靜默略過。
無法取得 wake lock 時，頂端顯示一次提示「此裝置無法保持亮屏，請到設定把自動鎖定改成永不」。

下一時段也顯示：

下一隊：
第1小隊
09:32

本隊未到：
本時段預定結束後仍沒有任何進關紀錄時，出現 [ 本隊未到 ]（需二次確認）。
按下後寫一筆 no_show = true 的 station_check_out，該列顯示「未到」，頁面切到下一隊。

全部 assignment 完成後顯示「本關已完成」。

用 A 關 PIN 打開 B 關頁面：只顯示唯讀內容、不出現按鈕，頂端提示「你登入的是 A 關，前往我的關卡」。

========================================
十八、大地關主頁
========================================

例如：

/station/land/B

顯示：

歐北共

目前（第4時段 14:26–14:46）：
第2小隊 VS 第4小隊

兩隊各自的狀態：
「第2小隊 已到 14:24（隊輔回報）」
「第4小隊 前往中 剩 01:10」

[ 雙方到齊，開始 ]

活動規則：大地 PK 必須兩隊都到齊才能開始，先到的一隊要等對手。

- 只寫一筆 station_check_in（team_id NULL），兩隊共用同一個 started_at。
  不要為兩隊各寫一筆關主側紀錄。
- 按下開始時，一律跳出確認視窗，列出兩隊，關主要逐一勾選「第2小隊已到場」「第4小隊已到場」才能送出
  （隊輔已回報的預設勾好，但關主仍要看一眼）。兩隊沒有都勾，送出按鈕 disabled，顯示「等待第4小隊抵達」。
  沒有「仍要開始」的選項。
- API 送出時帶 confirmed_team_ids；record_check 驗證大地 station_check_in 的 confirmed_team_ids 必須恰為該 assignment 的兩隊，
  否則拒絕（error code BOTH_TEAMS_REQUIRED）。前端擋住之外，server 也要擋。
- 關主按開始視為兩隊都已抵達（兩隊的跑關都停止）。
- 例外：某隊確定無法到場（受傷、走失等），只有 ADMIN 可以「單隊開始」：
  ADMIN 在該關主頁的開始視窗多一個選項，必須填原因，
  record_check 接受 single_team_override = true（server 驗證 ADMIN session），寫 audit log，
  Dashboard 該場顯示「單隊開始（原因）」。
- 先到的隊伍顯示「已到，等待對手」，不算逾期；晚到的隊伍照第九節計算跑關逾期。
- 大地提早到關時，關主可以在 scheduled_start 前按開始（兩隊都到的話），計時照第八節從 scheduled_start 起算。

開始後倒數（started_at 規則同第八節，official_end 用 FIXED_END：最晚到該時段 scheduled_end 就結束）。
關主頁在 Timer 下方顯示「至 14:46 結束（本場縮短 03:08）」。

PK 兩隊共用一次關卡正式計時。

[ 確認出關 ]

- 只寫一筆 station_check_out，兩隊各自算下一關與跑關。
- 不提供只讓其中一隊先出關；特殊情況由 ADMIN 修正。

但是：

第2小隊隊輔
第4小隊隊輔

仍各自有自己的確認進關／確認出關紀錄。

本時段休息時顯示：
「本時段休息，下一組 14:53 第1小隊 vs 第6小隊」（例：C 戲劇之王第4時段）。

其餘（Timer 顏色、震動、本隊未到、唯讀規則）同第十七節。

========================================
十九、全體小隊狀態頁
========================================

Dashboard 另提供：

「小隊視角」

顯示：

第1小隊
目前：
跑關中

上一關：
繩采飛揚

出關：
09:25:31

下一關：
九九乘法

須於 09:32:31 前抵達

距離跑關上限：
03:12

以及所有隊伍。

大地遊戲包含：

幹部隊。

黃金不顯示幹部隊。

========================================
二十、身分與權限
========================================

這是一天活動現場系統，
不要設計得像企業 ERP。

使用方式要非常快速。

PIN 範圍：
- TEAM：每隊一組，13 個小隊 + 幹部隊共 14 組；同一組在黃金、大地都能用。
- STATION：每個「遊戲＋關卡」一組，黃金 13 + 大地 10 共 23 組。
- ADMIN：至少一組，初始值取自環境變數 INITIAL_ADMIN_PIN。
- VIEWER：一組共用的唯讀 PIN。

登入一次後可以存在安全 session：
- 同一組 PIN 可以多台裝置同時登入，不互踢（關主換手機、兩位隊輔都常見）。
- session 至少維持到活動當天結束。
- 登入後自動導向自己的關卡頁／隊伍頁。
- 登入頁 /login：先選身分類型（關主／隊輔／總召／唯讀）
  → 關主選遊戲與關卡、隊輔選隊伍（第1~13小隊與幹部隊，不分遊戲）
  → 輸入 6 位數字 PIN。
  server 只比對所選那一個 identity 的 hash（用 bcryptjs，不要用原生 bcrypt），PIN 不需要全域唯一。
- 錯誤次數存在 DB 的 login_attempts 表（device_id + identity_id + 時間）。
  device_id 是第一次開頁時發的 httpOnly cookie（隨機 uuid）。
  任一 device_id 或 identity 在 1 分鐘內錯 5 次就鎖 1 分鐘；登入失敗寫 audit log。
  不要存在 server 記憶體（Vercel serverless 沒有共用記憶體）。

角色：

ADMIN
STATION
TEAM
VIEWER

ADMIN：
- 看全部
- 修改資料
- 修正誤按紀錄（撤銷、修正時間、補登）
- 強制結束
- 打開任何 /station/... 或 /team 頁面時，都有和該關主或隊輔相同的按鈕，
  照常呼叫 record_check（source = 'ui'，identity_id 是這位 admin，時間用 app_now()），
  頁面頂端標示「以總召身分操作」。需要指定過去時間時，才用 /admin 的修正時間或補登。
- 整場延後／提前排程、撤銷調整（第二十四節）
- 取消關卡（第二十四節之二）、延長時間（end override）
- 大地單隊開始（第十八節）
- 修改撤銷提醒的群組名稱與活動長稱呼
- 查看 audit log

STATION：
- 看全場 Dashboard
- 只能操作自己的關卡

TEAM：
- 看全場 Dashboard
- 只能操作自己的隊伍

VIEWER：
- 只能看

請避免讓普通使用者修改排程。

不實作「暫停／恢復」（會破壞「狀態 = 紀錄 + 時間」的推導）；整體延誤用第二十四節的延後排程處理。

登入與資料存取方式（必須照做，不要改成 Supabase Auth）：
- 不建立 Supabase Auth 使用者。
- PIN 登入走 Next.js Route Handler：server 比對 PIN hash（bcrypt）後，
  簽發 httpOnly、signed 的 cookie session
  （內容：identity_id、role、station_id 或 team_id、pin_version、到期時間；用 jose HS256 簽章）。
  簽章 secret 放環境變數 SESSION_SECRET。
- 每次寫入時，server 用 service role 讀取該 identity：
  is_active = false 或 pin_version 不符 → 回 401 並清掉 cookie。
  所以改 PIN 之後，該身分所有裝置都要重新登入；同一組 PIN 多台裝置同時登入仍然不互踢。
- 所有「寫入」（打卡、現場撤銷、修正、改 PIN、延後排程、取消關卡、延長時間、Demo 設定、Reset）一律經過 server 端
  （Route Handler / Server Action）：先驗 cookie session，再用 SUPABASE_SERVICE_ROLE_KEY 呼叫 Supabase。
- SUPABASE_SERVICE_ROLE_KEY 不可加 NEXT_PUBLIC_ 前綴，只在 server 端與 scripts/ 使用，前端 bundle 永遠拿不到。
- 前端只用 NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY 做讀取與 Realtime 訂閱。
- 所有 table 都 enable RLS：
  排程與打卡類 table（events、games、time_slots、stations、teams、assignments、check_records、notifications、
  schedule_adjustments、assignment_cancellations、assignment_end_overrides）
  對 anon 只開 SELECT policy，不開任何 INSERT / UPDATE / DELETE（前端推導狀態與 Realtime 都需要讀這些表，漏開會靜默收不到）；
  identities（存 PIN hash）、audit_logs、login_attempts 不給 anon 任何 policy。
- 每一個寫入用的 Postgres function（record_check、undo_check、修正、延後、取消、延長、時鐘設定、reset…）在 migration 都要寫：
  REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION <name>(<args>) TO service_role;
  只 revoke anon 和 authenticated 不夠，Postgres 預設把 EXECUTE 給 PUBLIC。
  唯讀的校時 function 明確 GRANT EXECUTE TO anon。
  v_slot_times 這類 view 要讓 anon 讀得到（資料非機密，可直接 GRANT SELECT）。
  README 附一段「用 anon key 呼叫 record_check 應該被拒絕」的驗證方式。
- 權限檢查（STATION 只能操作自己的關卡、TEAM 只能操作自己的隊伍）在 server 端用 session 裡的 id 比對，
  不信任前端送來的 station_id / team_id。
- 因此 Dashboard 資料視為「非機密」：拿到網址的人都讀得到。VIEWER PIN 只是入口，不是安全邊界，這是可以接受的。

========================================
二十一、防呆
========================================

一定要處理：

1. double click
2. 重複進關
3. 未進關直接出關
4. 下一關尚未到就誤按
5. 多支手機同時按同一操作
6. browser refresh
7. 網路短暫 lag
8. Server transaction race condition

資料庫端必須有 constraint / transaction 保護。

按鈕提交後：
立即 disabled。

同一動作不可產生兩筆有效紀錄。

但 audit log 要留下異常 attempt。

具體做法（必須照做）：

- 所有打卡只走一個 Postgres function（RPC，例如 record_check），在單一 transaction 內固定依序：
  (1) 用 client_request_id 查詢，存在就直接回傳那一筆（已撤銷的也回傳並標示），不驗規則；
  (2) SELECT … FOR UPDATE 鎖定該 assignment（隊輔側動作另外鎖該隊的 teams 列）；
  (3) 驗規則；
  (4) INSERT，回傳生效的那一筆。
  Next.js server 驗完 session 後呼叫它。不要在 TypeScript 裡先 SELECT 再 INSERT。
  撤銷之後重新按，前端要產生新的 client_request_id。
- 冪等：前端每次按下產生一個 client_request_id，重試沿用同一個。
  已存在 → 回傳原紀錄，視為成功。
- 重複：同 assignment、同 action、同 team 已有有效紀錄（例如別支手機先按）→
  回傳 ALREADY_RECORDED 與原紀錄；前端顯示「已由另一裝置於 HH:mm:ss 記錄」並進入完成狀態，不當成錯誤。
  寫 audit log。
- 競態：靠第六節的 partial unique index，兩支手機同時按只會有一筆成功。
  ON CONFLICT 要寫出和 index 相同的條件才推得到它：
  ON CONFLICT (assignment_id, action, team_id) WHERE voided_at IS NULL DO NOTHING

RPC 內的規則（違反就回傳明確的 error code，不寫入，但寫 audit log）：
- station_check_out 需同 assignment 已有有效 station_check_in。
  例外：no_show = true 時，必須沒有有效 station_check_in（隊輔的 team_check_in 不算），且 now >= 該時段 scheduled_end。
  大地 no_show 是整組 PK 一筆（本場未進行），Dashboard 顯示哪一隊有隊輔回報到場。
- 大地時段結束仍只到一隊（開始會被 SLOT_ALREADY_ENDED 擋住）時，不可以卡死：
  關主頁顯示「本時段已結束，請聯絡總召」，並可以按「本場未進行」（上面的 no_show）讓下一組接著進行；
  總召也可以改用：延長（end override）後讓兩隊開始、單隊開始（第十八節）、或取消本場（第二十四節之二）。
- team_check_out 需該隊在此 assignment 已有 team_check_in，或關主已進關。
  隊輔漏按進關仍可以出關，管理頁異常清單標示「隊輔漏按進關」。
- 「下一關尚未到就誤按」用順序擋，不用時鐘：
  - 同一關卡的 station_check_in，需該關上一個 assignment 已有有效 station_check_out（大地跳過休息時段）。
  - 隊輔不能對「比自己已有紀錄的 assignment 更早」的 assignment 打卡。
  - 提早到關而按進關不算誤按。
  - 不要在 DB 端用 scheduled_start 當拒絕條件：排程延誤或提早時會擋掉正常操作。太早按只在前端跳確認（第十七節）。
- 關主或隊輔在「該隊上一關尚未關主出關」時按本關進關：允許，上一關那一列標示「未出關（隊伍已到下一關）」，
  並觸發 PREV_NOT_CHECKED_OUT 通知。不可以因為上一關漏按就擋住下一關，否則一個人漏按會卡住整條路線。
- 「該關上一個 assignment」的判斷要跳過大地休息時段與被取消的 assignment。
- 被取消的 assignment 拒絕任何打卡（error code ASSIGNMENT_CANCELLED）。
- 大地 station_check_in：confirmed_team_ids 必須恰為兩隊，除非 ADMIN 帶 single_team_override（第十八節，error code BOTH_TEAMS_REQUIRED）。
- FIXED_END 的 station_check_in：app_now() >= scheduled_end 且沒有未來的 end override 時拒絕（error code SLOT_ALREADY_ENDED，第八節）。
- 每個 error code 都要有對應的中文提示，直接顯示在按鈕下方。

========================================
二十二、誤按修正
========================================

不要 hard delete 歷史紀錄。

check_records 在現場操作與管理員修正中只能 insert 與標記撤銷；不得 UPDATE recorded_at，不得 DELETE。

唯一例外是第二十五節的 Reset Demo Data 與第二十六節的 import --reset：
由同一個 Postgres function（例如 reset_game_records(game_id)）在單一 transaction 內
依序 DELETE 該遊戲的 notifications、check_records、assignment_end_overrides、assignment_cancellations、schedule_adjustments
（不要用 TRUNCATE，它不會送 Realtime 事件），
最後更新一下該遊戲的 games 列，讓所有裝置透過 Realtime 重抓。
「不得 DELETE」用「不給 anon／authenticated DELETE 權限」加程式規範達成，不要用會擋住 reset 的 trigger。

現場撤銷（按錯 1 分鐘內可自己撤銷）：
- 關主／隊輔按下任何確認後 60 秒內，按鈕下方顯示 [ 撤銷（剩 45 秒）] 倒數按鈕。
  refresh 後依 server 時間仍顯示正確的剩餘秒數。
- 只能撤銷「同一個 identity」自己按的紀錄（同一組 PIN 的其他裝置也算同一個 identity）。
- 撤銷 = 該筆標記 voided（void_reason = 'SELF_UNDO'）、寫 audit log、建立 SELF_UNDO 通知（只進通知中心，不跳全場 Toast），
  狀態依剩餘有效紀錄重新推導（例如撤銷進關 → 倒數消失、回到等待）。
- 60 秒後只能由 ADMIN 修正，畫面提示「超過 1 分鐘，請聯絡{lead_title}由總召修正」。
- 60 秒一律用真實時間計算（server 端比較 now() 與 real_created_at，容許到 75 秒以涵蓋網路延遲），
  不受 Demo 倍速影響；server 端要驗證，不能只靠前端隱藏按鈕。

撤銷後的提醒（必做）：
撤銷成功後跳出不能直接關掉的全螢幕視窗，要按「我知道了」才會關：
- 隊輔：「你已撤銷【第2小隊 九九乘法 確認進關】。請立即到【隊輔群】tag【活動長】說明自己按錯。」
- 關主：「你已撤銷【九九乘法 第2小隊 確認進關】。請立即到【活動組群】tag【活動長】說明自己按錯。」
- 群組名稱與稱呼取自 events.team_group_label / station_group_label / lead_title，admin 頁可改。
- 視窗內有 [ 複製訊息 ] 按鈕，內容例如：
  「@活動長 我是九九乘法關主，我在 09:10:18 誤按了【第2小隊 確認進關】，已於 09:10:40 撤銷。」
  複製用 navigator.clipboard.writeText，失敗時改成顯示可長按選取的文字框。
- 系統不串接 LINE 或其他通訊軟體，只負責提醒與提供複製文字。
- ADMIN 自己撤銷時不跳這個視窗。

順序保護（現場撤銷與 ADMIN 撤銷都適用）：
- 要撤銷一筆 station_check_out 時，若該關下一個 assignment 已有有效 station_check_in，一律拒絕
  （現場撤銷提示「下一隊已進關，請找總召修正」；ADMIN 要先撤銷下一隊的進關）。
- 同一 assignment 已有有效 station_check_out 時，不能撤銷它的 station_check_in。
- 現場撤銷一筆 station_check_out 時，若該隊（大地為任一隊）在下一關已有任何抵達紀錄，也拒絕，請找總召修正。
- 撤銷與其他動作同時送出（例如撤銷出關的同時下一關按了進關）：兩個 RPC 都鎖相關的 assignment／teams 列，
  依序執行，只會有一個成功，另一個回傳明確的 error code。
- 「修正時間」（同一 transaction 撤銷＋新增）不受此限，但仍須符合「出關 >= 進關」。

管理員修正：
- 撤銷：標記 voided_at / voided_by / void_reason，原因必填。
- 修正時間：同一個 transaction 內「撤銷原紀錄 + 新增一筆 source = 'admin_correction'
  （recorded_at 由管理員指定，replaces_record_id 指向原紀錄）」。
  修正後同一 assignment 同一側仍須「出關 >= 進關」，否則整筆回滾並顯示錯誤。
- 補登（原本忘了按）：只新增一筆 admin_correction。
- 強制結束：新增一筆 source = 'admin_force' 的 station_check_out，不是特殊狀態。

因為唯一性只計算未撤銷的紀錄，撤銷後重新打卡不會撞到 constraint。

保留：

原始紀錄
修改後紀錄
修改人
修改時間
修改原因

使用 audit log。

========================================
二十三、時間基準
========================================

Timezone：

Asia/Taipei

Database timestamp：
UTC timestamptz

Frontend：
顯示 Asia/Taipei

格式：

HH:mm:ss

- 打卡時間（包含 Dashboard 上的進關／出關時間）一律顯示 HH:mm:ss。
- 預定時段、下一隊時間可以只顯示 HH:mm。

注意：
- Vercel 的 server 跑在 UTC。server 端格式化時間一律明確指定 Asia/Taipei。
- event_date + 'HH:mm' 一律視為 +08:00，不要依賴執行環境的時區。
- 所有 now 都來自第三十一節的統一時鐘。

========================================
二十四、活動日期與延後排程
========================================

不要把目前電腦日期寫死在 scheduling logic。

- EVENT_DATE 存在 events.event_date。.env 的 EVENT_DATE 只當 seed 預設值，admin 頁可以修改。
- 時段 = event_date + local scheduled time（+ 延後量），由第六節的 view 產生。
- 之後換年份仍可重複使用系統。

整場延後／提前（每個遊戲分開設定，存在 schedule_adjustments）：

/admin 提供兩種輸入方式，存進 DB 時都換算成「from_slot_number + offset_seconds」：

1. 延後 N 分鐘：
   「從第 k 時段起延後 N 分鐘」。大按鈕「延後 5 分鐘」「延後 10 分鐘」＋自訂分鐘數；N 為負數代表提前，負數要再確認一次。
2. 指定開始時間：
   「第 k 時段從 HH:mm 開始」。offset = HH:mm − 第 k 時段目前的有效開始時間。
   k 選第 1 時段，就是「整場從 xx:xx 開始」。其後時段維持「關卡時間＋7 分鐘間隔」一起平移。

k 的預設值：符合下面「規則」第一條的第一個時段（有效 scheduled_start > app_now()，且該時段及之後沒有任何有效 station_check_in）。

規則：
- 只能從「尚未開始」的時段起調整：from_slot 的有效 scheduled_start 必須 > app_now()，
  且 from_slot 及其後的時段沒有任何有效 station_check_in。不符合時 RPC 拒絕並說明原因。
  這樣已經開始或結束的時段不會被回頭改動（否則 started_at = max(進關, scheduled_start) 會被改寫，過去的超時紀錄會變）。
- 送出前顯示預覽：受影響的時段、新舊開始時間對照、該遊戲最後一場的新結束時間；
  提前導致與前一時段重疊時，預覽顯示紅字警告並要求再確認。
- 原定時間不覆寫：time_slots 保持原樣，有效時間由 v_slot_times 加總所有未撤銷的調整。
- 可以撤銷最近一次調整（標記 voided，寫 audit log），規則同上（被影響的時段必須都還沒開始）。
- 每次調整或撤銷：寫 audit log、建立 SCHEDULE_ADJUSTED 通知（全場跳 Toast），所有畫面經 Realtime 立即更新。
- 已經打卡的紀錄不變；started_at、official_end、跑關 deadline、目前時段、進關的「太早」確認都自動跟著新的排程時間。
- 所有頁面顯示的「預定時間」都是有效時間；與原定不同時小字顯示「原定 09:54」。
- 有任何未撤銷的調整時，所有頁面頂端顯示「本遊戲第3時段起已延後 10 分鐘」，避免彩排留下的調整被帶到正式活動。

========================================
二十四之二、關卡取消
========================================

例如下雨，水關停辦；或某關道具壞掉。

- ADMIN 在 /admin 或 Dashboard 選「取消」：可以只取消某一個 assignment，或一次取消某一關接下來的所有時段。原因必填。
- 寫進 assignment_cancellations，寫 audit log，建立一則 SCHEDULE_ADJUSTED 類的全場通知（內容寫「XX 關第3時段起取消」）。
- 取消可以撤銷（標記 voided）。
- 被取消的 assignment：顯示「已取消（原因）」灰色；拒絕任何打卡；
  相關隊伍直接前往再下一個 assignment，跑關規則見第九節；關主頁跳過它。
- 已經進行中的 assignment 不能取消，要先由關主出關或 ADMIN 強制結束。

========================================
二十五、管理員頁
========================================

需要：

/admin

可以：

- 選擇活動日期
- 查看遊戲
- 查看時段
- 查看關卡
- 查看隊伍
- 查看原始 schedule
- 修改 PIN
- PIN 總表：DB 只存 bcrypt hash、不存明碼，所以總表列出每個身分（角色、遊戲、關卡／隊伍、label）、
  登入網址的 QR code（不放 PIN），以及「重設此 PIN」「重設全部 PIN」按鈕。
  新 PIN 只顯示在重設後的那一次畫面，這時可以直接列印；離開頁面就看不到了。
  初次匯入的完整 PIN 清單以 import 產生的本機 CSV 為準。
- 查看所有打卡紀錄（含已撤銷的，標示清楚）
- 修正操作：撤銷、修正時間、補登、強制結束（原因必填）
- 整場延後／提前（兩種輸入方式、預覽、撤銷最近一次）
- 取消關卡、延長時間（end override）
- 設定 end_policy 與 min_play_seconds（每個遊戲）
- 設定撤銷提醒的群組名稱與稱呼（隊輔群、活動組群、活動長）
- 查看超時
- 查看異常：未出關、隊伍已到下一關但上一關未出關、隊輔漏按進關、本隊未到、被拒絕的打卡、重複嘗試、
  現場撤銷紀錄、第十節 C 的所有次要標籤、單隊開始、壓縮後時間不足
- 查看 audit log
- 匯出 CSV
- Demo 面板（第三十一節）

另提供：

「Reset Demo Data」

- 清除執行期資料：check_records、notifications、schedule_adjustments、assignment_cancellations、assignment_end_overrides；
  不清排程與 PIN；audit_logs 保留並新增一筆 reset 紀錄。
- server 端只在 APP_ENV 是 development 或 demo 時允許；未設定或其他任何值一律拒絕，不能只靠前端隱藏按鈕。
- 按下前要輸入確認字（例如輸入 RESET）。

Production 不可誤觸。

========================================
二十六、排程 Seed / Import
========================================

請建立：

scripts/import-schedule.ts

讀取兩份 Excel。

轉為 normalized data。

匯入 Supabase。

必須 validation。

Excel 位置：
兩份 Excel 放在專案的 data/ 目錄（檔名含中文與空白，路徑用常數或 CLI 參數指定）。

指令：
- npm run import:check：只讀取＋套用 overrides＋validation，印出正規化後的排程表，不連資料庫。
  沒有 Supabase 也要能跑。
- npm run import：validation 通過才寫入。用 SUPABASE_SERVICE_ROLE_KEY，只在本機執行。

黃金每一時段：

13 stations
13 teams
每隊出現一次
每關一隊
幹部隊不出現
時段時間與第三節一致
關卡代號 A~M

大地每一時段：

14 teams（含幹部隊）
7 PK pairs
每隊出現一次
每一啟用關卡 2 隊
3 個關卡 inactive
時段時間與第三節一致
關卡代號 A~J

如果 validation fail：

不要匯入資料庫。

terminal 明確顯示錯誤位置（工作表名稱＋儲存格座標＋原因）。
一次列出全部錯誤，不要遇到第一個就停。

可重跑：
- 系統只有一筆 is_active = true 的 events。import 找到它就沿用；找不到才用 .env 的 EVENT_DATE 建立。
- 重跑時絕不覆寫 events.event_date、sim_*、群組名稱設定、games.end_policy／min_play_seconds，也不動 schedule_adjustments（這些只由 admin 頁修改）。
  唯一例外：加 --reset 時會把 sim_enabled 設為 false（見下方）。
- 自然鍵（都要有 unique constraint）：games(event_id, code)、stations(game_id, code)、teams(code)、
  time_slots(game_id, slot_number)、assignments(slot_id, station_id)。用它們 upsert。
- 可以更新 time_slots 的 start_local／end_local 與 stations 的名稱；不重建 assignments，不產生重複。
- 若該遊戲已經有打卡紀錄，預設拒絕匯入。
  加 --reset 才用第二十二節的 reset function 清空該遊戲的執行期資料（打卡、通知、延後、取消、延長），
  同時把 sim_enabled 設為 false，再匯入（寫 audit log）。

seed identities：
- 產生 14 組 TEAM、23 組 STATION、1 組 VIEWER 的隨機 PIN；ADMIN 用 INITIAL_ADMIN_PIN。
- PIN 清單印在 terminal，並輸出一份本機 CSV（加進 .gitignore）。
- PIN 已經存在時不覆蓋。

========================================
二十七、Realtime
========================================

Supabase Realtime 必須至少同步：

- station check-in
- station check-out
- team check-in
- team check-out
- current assignment status（狀態是推導的，同步紀錄就等於同步狀態）
- overtime notification
- corrections
- 延後排程與 Demo 時鐘設定

A 手機按下後，
B 手機的 Dashboard 不需 refresh 即更新。

具體要求：
- migration 裡必須有：
  ALTER PUBLICATION supabase_realtime ADD TABLE check_records, notifications, events, games,
    schedule_adjustments, assignment_cancellations, assignment_end_overrides;
  漏掉會靜默收不到任何事件。
- 每台裝置只開一個 channel，不要每張 card 各開一個。
  channel 內：games 用 filter id=eq.<本遊戲 id>、events 用 id=eq.<活動 id>；
  check_records 與 notifications 不加 filter（postgres_changes 的 filter 不能 join，而全天事件只有幾百筆），
  收到事件一律重抓本遊戲的完整狀態，不要用 payload 內容判斷是哪個遊戲。
- 訂閱寫在 Client Component 的 useEffect 裡，cleanup 時 removeChannel。
- Realtime 事件只當「有變動」的提示，不做增量修改：
  收到事件、channel 重新 SUBSCRIBED（含 reconnect）、頁面回到前景（visibilitychange）時，
  都重新抓一次該遊戲的完整狀態（排程時間＋有效紀錄＋通知＋時鐘設定），再用第十節的 function 推導。
- 另外每 30 秒輪詢一次當備援（iOS Safari 切到背景會斷線，而且不補送漏掉的事件）。

========================================
二十八、斷線與網路品質
========================================

活動現場可能網路不穩。

至少做到：

- 顯示 online / offline 狀態（navigator.onLine + Realtime channel 狀態 + 最近一次成功抓取的時間；
  超過 60 秒沒成功抓取就顯示「資料可能過期」）
- API submit loading
- submit failure 明顯提示
- 不可以在失敗時假裝成功
- reconnect 後自動重新抓取 server state

不做 offline queue：
離線排隊的打卡送達時，server 記的是送達時間，正式時間會錯；
改成相信手機時間又違反第八節。

按下按鈕的流程：
- 立即 disabled，產生 client_request_id，送出。
- 8 秒逾時或網路錯誤時，用同一個 client_request_id 自動重試最多 2 次。
- 仍然失敗就顯示「網路中斷，請重新送出」並恢復按鈕；重新送出還是用同一個 client_request_id。
- 規則拒絕（4xx）不重試，直接顯示 server 回傳的訊息。

========================================
二十九、UI 原則
========================================

這是戶外活動現場。

所以：

- 字要大
- Button 要大
- 高對比
- 一眼就知道是否超時
- 手機單手可操作
- 不要大量小字
- 不要複雜 menu
- 不要要求輸入大量文字

主要按鈕至少 56px 高，適合手機單手觸控。
每個頁面只顯示「當下能按」的主要按鈕，避免按錯。
確認類的對話框按鈕也要大，並把危險動作（本隊未到、單隊開始、取消、Reset）放在需要二次確認的位置。

========================================
三十、測試
========================================

請寫 unit / integration tests（Vitest）。

測試分兩層：
- 純函式（不需 DB）：Excel parser 與 validation（直接讀 data/ 兩份真實 Excel）、排程時間、狀態推導、時鐘。
- 資料庫（要打真的 Postgres，不可以用 mock）：
  只讀 SUPABASE_TEST_URL 與 SUPABASE_TEST_SERVICE_ROLE_KEY 這兩個專用變數，
  絕不沿用 NEXT_PUBLIC_SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY（我可能只有一個 project，就是正式那個）；
  兩者相同時直接 fail 並提示。沒有設定就印出原因並 skip，不要 fail，也不要假裝通過。
  建議用 Docker 的 supabase start 本機 DB，或另開一個測試用 project。
  每個測試檔自己建立 is_active = false 的測試 event 與它的 games／slots／assignments，結束時刪掉。

至少測：

黃金：
- 8 slots
- 13 teams
- 13 stations
- 每時段 13 assignments
- 15 min
- 7 min transition（相鄰時段 end → 下一個 start 恰為 420 秒）
- 每隊 8 個不同關卡、每關 8 支不同小隊
- 第2小隊路線 = A C B M K L J H
- 舊工作表「每個小隊跑的路線」不影響匯入

大地：
- 8 slots
- 14 teams
- 10 stations
- 每時段 7 active stations
- 7 PK pairs
- 每隊每時段只出現一次
- 20 min
- 7 min transition
- 在記憶體裡把第4時段 B 關清空後跑 validation，要失敗並指出第4時段缺第2、4小隊
  （不要依賴 Excel 目前 C5 的內容）
- 用真實 Excel 跑完整 import 流程（含 override）後全部合法；C5 是空白或已改成 2/4 都要通過
- 「幹」字串格與日期格都正確解析（不會少一天）
- 沒有重複的 PK 組合
- 舊工作表「各隊跑關情況」不影響匯入（它第 3、4、6 時段與新表不同，匯入結果仍須與「大地新跑關」一致）

Timer／狀態推導（用固定的 now 測）：
- 第2時段 09:30 關主進關 → 09:31 READY、09:32 IN_PROGRESS、09:45 起 ENDING_SOON、09:47 起 OVERTIME
- 09:13 才進關（第1時段）→ 09:26 不是 OVERTIME
- 09:20 提早出關 → 09:30 仍 TRANSITIONING（不得逾期），09:32 起 TRANSITION_OVERDUE
- 09:28 出關 → deadline 09:35；09:36 才抵達 → 09:35–09:36 為逾期
- 隊輔先確認進關 → 立即 ARRIVED，跑關停止
- 上一關關主忘記出關、隊輔已在下一關確認進關 → 小隊狀態在下一關，上一關標示未出關
- 大地：一隊已到、一隊未到 → 只有未到的那隊逾期；出關後兩隊的下一關不同
- 第8時段出關 → COMPLETED
- refresh 不重置（同一組紀錄＋同一個 now，結果一樣）
- 延後排程 10 分鐘後，started_at 下限與 deadline 一起移動
- Demo 倍速下推導正確

FIXED_END／大地等人：
- 大地 confirmed_team_ids 只有一隊 → record_check 拒絕 BOTH_TEAMS_REQUIRED；ADMIN 帶 single_team_override 才成功
- 第4時段 14:29 開始 → official_end = 14:46，可玩 17 分鐘，顯示縮短 03:00
- 可玩時間 < min_play_seconds → 建立 STATION_SHORTENED
- 14:46 之後才按開始 → SLOT_ALREADY_ENDED；有未來的 end override 才成功，official_end = override
- 先到的隊伍不逾期，晚到的隊伍照常逾期
- 黃金 FULL_DURATION：09:13 開始 → 09:28 結束

整場延後／取消：
- 「第3時段起延後 10 分鐘」→ 第1、2時段不變，第3~8時段 +10 分鐘，v_slot_times 同時給出原定時間
- 「第1時段從 09:20 開始」→ offset = +10 分鐘，全部時段平移
- from_slot 已開始或已有進關紀錄 → 拒絕
- 撤銷最近一次調整後回到原本時間
- 取消某隊的第3時段 → 第2時段出關後，跑關目標直接是第4時段，deadline 依第九節
- 被取消的 assignment 拒絕打卡

現場撤銷與次要標籤：
- 59 秒可撤銷、76 秒拒絕（用真實時間，Demo 倍速下也一樣）
- 別的 identity 不能撤銷
- 已出關後撤銷進關 → 拒絕；下一隊已進關後撤銷出關 → 拒絕
- 撤銷進關後狀態回到 WAITING / ARRIVED，對應的超時通知標記 invalidated
- 上一關漏按出關、隊伍在下一關打卡 → 建立 PREV_NOT_CHECKED_OUT，小隊狀態在下一關
- 隊輔已出關、關主未出關 → 次要標籤＋RECORD_MISMATCH
- 雙方出關時間差 > 60 秒 → 「紀錄不一致」

通知：
- 同一事件多次 insert 只留一筆
- 條件不成立時 server 拒絕寫入

Concurrency（真 DB）：
- double click 不建立 duplicate
- 多裝置同時操作只有一次有效 event：Promise.all 同時呼叫 record_check 20 次 → 只有一筆有效，其餘回傳同一筆或 ALREADY_RECORDED
- 同一個 client_request_id 重送回傳同一筆
- 撤銷後可以重新打卡
- 撤銷出關與下一關進關同時送出，只有一個成功

========================================
三十一、Demo 模式
========================================

請建立 Demo / Simulation mode。

因為正式活動前一定要彩排。

Admin 可以選：

Demo Mode

例如：

1 real minute = 10 simulated minutes

或可設定倍速。

讓我不用真的等 15 / 20 分鐘，
也能測：

- 進關
- 黃色提醒
- 超時
- 出關
- 跑關
- 下一時段

Demo 與第八節的 server 計時必須共用同一個時鐘，做法固定如下：

- 時鐘設定存在 events（sim_enabled、sim_speed、sim_anchor_real、sim_anchor_virtual）。
- SQL function app_now()：
  sim_enabled = false → now()
  sim_enabled = true → sim_anchor_virtual + (now() − sim_anchor_real) × sim_speed
- 所有 recorded_at、通知判斷、狀態推導的 now 一律用 app_now()。前端不可以直接用 Date.now() 當現在。
- 前端校時：載入時呼叫 RPC 取 server 的 now() 與時鐘設定，算 offset = server_now − Date.now()；
  之後每秒用 Date.now() + offset 得到 real_now，再用同一個公式算 app_now。
  每 60 秒、reconnect、回到前景時重新校時（同時解決手機時鐘不準）。
- Admin Demo 面板：開關、倍速（1 / 5 / 10 / 20）、把模擬時間跳到指定時刻（例如活動日 09:08、13:03）。
  改任何設定時 server 重設 anchor（anchor_real = now()，anchor_virtual = 改動當下的 app_now() 或要跳到的時刻），
  所以改倍速或開關時，時間不會跳動。
  「跳到指定時刻」若早於本活動任何有效紀錄的 recorded_at，server 拒絕，並提示先執行 Reset Demo Data。
- 例外：跟排程無關的操作時限一律用真實時間，不乘倍速：
  60 秒現場撤銷、登入鎖 1 分鐘、8 秒逾時與重試、5 秒通知重試、30 秒輪詢、60 秒「資料可能過期」。
  跟排程有關的時間長度都用 app_now()：關卡 15/20 分鐘、跑關 7 分鐘、2:00 黃色、關主未開始 3 分鐘、早於預定 7 分鐘的確認。
- 時鐘設定走 Realtime，所有裝置立即跟上。
- Demo 開啟時每個頁面頂端都顯示「DEMO 模式 ×10」橫幅，避免跟正式活動混淆。

正式 production 預設：
simulation disabled。

APP_ENV 不是 development 或 demo 時（包含未設定），server 拒絕「開啟」Demo 與 Reset；「關閉」Demo 一律允許。

========================================
三十二、專案輸出要求
========================================

請直接建立完整專案。

我要看到至少：

package.json
README.md
.env.example
Supabase migration SQL（supabase/migrations/*.sql，Supabase CLI 格式）
data/（放兩份 Excel）
seed / import script（scripts/import-schedule.ts）
TypeScript types
database access layer
狀態推導 module（第十節）
統一時鐘 module（第三十一節）
Realtime hooks
dashboard
station page
team page
admin page
notification system
timer component
tests

.env.example 至少包含：
NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、
SESSION_SECRET、INITIAL_ADMIN_PIN、EVENT_DATE、APP_ENV、
SUPABASE_TEST_URL、SUPABASE_TEST_SERVICE_ROLE_KEY（DB 測試專用，見第三十節）

README.md 請用繁體中文。

README 必須 step-by-step 告訴我：

1. 安裝 Node.js（20 以上）
2. npm install
3. 建立 Supabase project
4. 執行 migration（兩種方式都寫：有 Supabase CLI 用 supabase link + supabase db push；沒有 CLI 就到 SQL Editor 依檔名順序貼上執行）
5. 設定 .env.local（新版 Supabase 後台：NEXT_PUBLIC_SUPABASE_ANON_KEY 填 Publishable key 或 legacy 的 anon key，
   SUPABASE_SERVICE_ROLE_KEY 填 Secret key 或 legacy 的 service_role key，寫清楚在後台哪一頁找）
6. Excel 放哪裡
7. 執行 import schedule（先 import:check 再 import）
8. localhost 啟動
9. 建立管理員（INITIAL_ADMIN_PIN）
10. 測試隊輔頁
11. 測試關主頁
12. 部署到 Vercel（環境變數怎麼設、APP_ENV=production；Supabase project 建在 Northeast Asia (Tokyo)，
    vercel.json 設 "regions": ["hnd1"]，讓 server 和 DB 在同一區）
13. 正式活動前如何 reset / seed，固定順序：彩排完 → 關閉 Demo → 本機 npm run import -- --reset
    → 確認沒有 DEMO 橫幅、沒有任何延後／取消、活動日期正確 → Vercel 設 APP_ENV=production 並 redeploy
14. 如何開 Demo Mode
15. 如何列印 PIN 總表
16. 現場突發狀況 SOP：誤按撤銷（1 分鐘內自己撤、之後找總召）、整場延後（兩種方式）、關卡取消、延長時間、漏按出關、大地缺隊／單隊開始
17. 彩排建議流程（照第三十四節）
18. 提醒：Supabase 免費專案一段時間沒使用會被暫停，活動前一週要登入確認

README 另外要有「設計決策」一節，記錄本 prompt 已經定下的規則
（跑關期限公式、提早進關的計時起點、黃金 FULL_DURATION 與大地 FIXED_END、大地兩隊到齊才開始、
隊輔進關＝回報抵達／關主進關＝正式確認、忽略舊工作表、狀態不落地、延後以「從第 k 時段起」存成 append-only 調整、
不自動替關主寫推定出關、不做暫停、不做 offline queue、1 分鐘現場撤銷、PIN + cookie 的寫入方式、通知去重方式）
以及你自己另外做的決定。

README 另外要有：
- 「state transition 表」：第十節兩台狀態機的所有狀態與轉換條件。
- 「工作人員一頁說明」：給關主與隊輔的簡短操作說明（可以直接列印發下去），至少包含：
  抵達的定義、什麼時候按確認進關／出關、大地要等兩隊到齊、按錯 1 分鐘內自己按撤銷、
  撤銷後要到哪個群組 tag 活動長、超過 1 分鐘找誰、上一關忘了出關會怎樣。

========================================
三十三、實作方式
========================================

不要一次只丟一堆 code snippet 給我。

你現在是在 Coding Agent 環境。

請：

1. 先閱讀 Excel。
2. 檢查資料是否符合上述規則（結果要和第三、五節列的已驗證事實一致）。
3. 建立 project structure。
4. 建 Supabase schema / migration。
5. 建 Excel import + validation，並實際跑 npm run import:check。
6. 建 backend/data layer。
7. 建 Realtime。
8. 建 UI。
9. 建 timer / notification。
10. 建 tests。
11. 實際 npm install。
12. 實際執行 typecheck。
13. 實際執行 lint。
14. 實際執行 tests。
15. 實際執行 npm run build。
16. 修掉錯誤。
17. 最後再告訴我如何啟動。

如果發現需求中有會導致資料錯誤、race condition 或無法正常操作的地方：
可以自行做合理工程決策，
但必須在 README 的「設計決策」記錄原因。

不要為了問一些小問題而停下。

只有遇到以下會阻止實作的情況才問我：

- Excel 排程無法確定
- 兩份正式工作表的資料無法推論
  （舊工作表與正式工作表的差異是已知的，不算矛盾，直接忽略舊表）
- 會改變核心操作流程的重大選擇

沒有 Supabase credentials 時不要停下來：
其餘全部完成（包含 import:check、純函式測試、typecheck、lint、build），
DB 測試 skip 並說明原因，
最後列出我需要提供或執行的步驟。
本機有 Docker 的話，用 supabase start 實際套用全部 migration 並跑 DB 測試；
沒有的話，最後回報要明寫「migration 尚未實際執行過」。

其餘請自行完成。

========================================
三十四、驗收標準
========================================

完成後我要能做到以下實際測試。
彩排可以用 Demo 模式（把時間跳到 09:08、10 倍速），也可以用正常速度。
驗收只操作指定的關卡與隊伍。其他沒有打卡的隊伍在第1時段開始時會顯示「未到第一關」並合併成一則通知，
這是正確行為，不要為了驗收去改推導規則。

### 黃金傳奇

手機 A：
登入「黃金傳奇－九九乘法」關主。

手機 B：
登入「第2小隊」隊輔。

電腦 C：
開啟 Dashboard。

1. 09:08 手機 A 按：確認進關。
   A：顯示「已進關 09:08:xx，09:10 開始計時」。
   B：立即看到：關主已確認進關。
   C：立即看到：九九乘法、第2小隊、關主進關時間 HH:mm:ss、紫色「已到，09:10 開始」。

2. 09:10：
   A：開始 15 分鐘倒數。
   C：狀態「進行中」（綠）。

3. B 按：確認進關。
   C：立即出現隊輔進關時間。

4. 剩 2 分鐘：
   C：黃色。A：黃色；Android 會震動（iPhone 只有畫面，聲音已開啟時有短音）。

5. 時間到：
   C：紅色，並跳「九九乘法－第2小隊已超時」通知。
   A、B、C 各跳一次，不重複；refresh 後不再重跳，只留在通知中心。

6. 手機 A 按出關：
   Timer 停止。
   第2小隊進入跑關狀態。
   B：立即顯示「下一關：3的倍數，須於 HH:mm:ss 前抵達，跑關剩餘 MM:SS」（B 不用先按出關）。
   C：3的倍數那一列顯示「第2小隊 前往中」（藍）。

7. B 按：確認出關 → 只增加一筆隊輔出關紀錄。

8. B 在 3的倍數按：確認進關 →
   C：3的倍數那一列變紫「第2小隊 已到」，跑關倒數停止。

9. 另外測一次：第2小隊出關後沒人按進關，deadline 一到 →
   紅色「逾期 +MM:SS」，並通知一次。
   （可以直接用第2小隊從 3的倍數出關後的下一段測；
   要從頭重測時，先 Reset Demo Data，再把 Demo 時間跳回 09:08。）

整個過程不需要任何人 Refresh。

### 大地遊戲

手機 A：登入「大地－ㄇㄉㄈㄎ」關主。
手機 B1：第6小隊隊輔；手機 B2：第8小隊隊輔。
電腦 C：Dashboard（大地）。
Demo 跳到 13:03。

1. B1 按確認進關（第8小隊還沒到）：
   C：ㄇㄉㄈㄎ 顯示「第6小隊 已到」（紫）、「第8小隊 前往中」。
2. 13:05 第8小隊仍未到：同一組 PK 裡只有第8小隊變紅「未到第一關」並通知，第6小隊維持紫色「已到」。
3. 第8小隊還沒到時，A 按「雙方到齊，開始」→ 視窗中第8小隊沒勾，送出按鈕 disabled，顯示「等待第8小隊抵達」。
   B2 按確認進關（假設 13:08），A 勾選兩隊後開始 →
   兩隊共用倒數，結束時間仍是 13:25（本場縮短 03:00），A 與 C 都顯示縮短。
4. 黃色、超時、出關同黃金。
5. A 按出關後：第6小隊顯示下一關 (水)你坡我擋，第8小隊顯示下一關 戲劇之王，各自倒數。
6. 第1時段進行中（13:25 前），或事後切到「上一時段」看第1時段時，E、G、J 三關顯示「本時段休息」；
   進入第2時段後，改由 A、B、I 顯示「本時段休息」。

整個過程不需要任何人 Refresh。

### 突發狀況

1. 誤按撤銷：
   手機 A（九九乘法關主）對下一隊誤按「確認進關」，30 秒內按「撤銷」→
   所有裝置的倒數與進關時間消失、狀態回到按下前；
   A 跳出全螢幕提醒「請立即到【活動組群】tag【活動長】說明自己按錯」，可以一鍵複製訊息，要按「我知道了」才關；
   admin 異常清單看得到這筆撤銷。
   隊輔誤按時，提醒改成【隊輔群】。
   再按一次並等超過 60 秒 → 撤銷按鈕消失，提示聯絡活動長；ADMIN 在 /admin 仍能撤銷。

2. 漏按出關：
   第2小隊在某關結束後，關主不按出關，隊輔直接在下一關按確認進關 →
   上一關關主頁出現紅色橫幅「第2小隊已到下一關，請立即按出關」，Dashboard 該列標示「未出關（隊伍已到下一關）」；
   下一關可以正常進關，沒有被卡住。

3. 整場延後：
   a. 先 Reset Demo Data，Demo 時間跳到 09:05（第1時段開始前）。
      ADMIN 設定「第1時段從 09:20 開始」→ 送出前看到預覽；送出後全部時段平移 10 分鐘，所有裝置立即更新並收到全場通知，
      頂端出現延後標籤，時段旁小字顯示原定時間。
      撤銷這次調整 → 回到原本時間，並收到撤銷通知。
   b. 讓第1時段開始（進行到第1或第2時段中）後，ADMIN 設定「黃金傳奇 第3時段起延後 10 分鐘」→
      第3~8時段 +10 分鐘，第1、2時段不受影響；頂端出現「第3時段起已延後 10 分鐘」。
      試著設定「第1時段起延後」→ 被拒絕並說明原因（第1時段已開始）。
      撤銷最近一次調整 → 第3時段起回到原本時間。

4. 關卡取消：
   ADMIN 取消某關第3時段 → 該列灰色「已取消」，原本排在那裡的隊伍在隊輔頁直接看到再下一關。

整個過程不需要任何人 Refresh。

請現在開始實作完整專案。
