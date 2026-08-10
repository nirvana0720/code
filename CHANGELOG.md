# 更新紀錄

本檔案記錄系統的重要更新。使用自己 Fork 版本的分院，可隨時查看本檔案了解目前有哪些新版本可用；標示「⚠️ 需另外處理」的項目，除了同步程式碼（Sync fork）以外，還需要額外操作（例如到 Supabase 補跑 SQL），開發者會主動另行通知。

日期格式：YYYY-MM-DD。

---

## 2026-07-18

- **修復：後台報到頁刷卡偶爾跳離畫面**：掃描機刷卡的按鍵監聽未攔截 Backspace 鍵，部分瀏覽器環境會將其誤判為「上一頁」，導致報到頁面被中斷。已修正 `CheckinPage.jsx`、`KioskPage.jsx`。無需資料庫異動。
- **新增：`sql/full_setup_all_in_one.sql`**：將全新環境建置所需的全部 SQL 檔案（第一至第七階段）合併為單一檔案，簡化新分院首次建置流程。⚠️ 僅影響「尚未建置資料庫」的全新環境，既有分院無需處理。
- **新增環境變數 `VITE_TEMPLE_SUBTITLE`**：可自訂首頁副標題文字。既有分院若未設定，將顯示預設值，建議至 Vercel 專案設定補上。無需資料庫異動。
- **部署方式調整**：分院改為以自己 Fork 的程式碼副本部署，取代直接匯入原始 repo，以支援日後同步更新。僅影響尚未完成部署的新分院；已部署的分院無需變動。

---

## 2026-07-19

- **安全修正：學員電話／LINE 綁定狀態全表外洩** ⚠️ 需另外處理：`students` 表原本給 anon（前台、免登入）整表 SELECT 權限，後來新增的 `phone`、`line_user_id` 欄位也一併被開放，任何人只要有專案的 anon key（會出現在網頁原始碼裡，不是秘密），不需登入、不需 token，即可用 REST API 一次撈出全部學員的電話與 LINE 綁定狀態。已改為白名單方式，只留 `student_id`、`qr_code`、`name`、`active`、`created_at` 給 anon 讀取，`phone`／`line_user_id` 需登入或透過既有的 token 頁面（RPC）才能讀取。已在正式環境實測：前台刷 QR 報名、領隊/坡務報到頁皆正常運作。**已 Sync fork 的分院請務必到 Supabase SQL Editor 執行 `sql/fix_students_phone_anon_leak.sql`**（新建置的環境已包含在 `full_setup_all_in_one.sql` 內，無需另外處理）。
- **修復：前台刷卡頁仍會出現 canary 監控假活動**：7/17 那次「canary 假活動全面隱藏」漏掉了 `getActiveEvents()`（前台刷卡頁真正在用的查詢函式）跟 `getPublicActivities()`（公開活動介紹頁），已補上排除。無需資料庫異動。
- **修復：學員電話欄位在管理介面看不到**：電話匯入功能原本就能用，但學員列表查詢（`getAllStudents`）沒有帶出 `phone` 欄位，匯出名單也沒有電話欄，導致第一次用的人容易誤以為系統不支援電話。已補上：學員列表新增「電話」欄、匯出名單新增電話欄、匯入格式說明補充電話為選填欄位，並在「覆蓋 vs 合併」班級處理方式旁加上提醒（檔案沒填班級卻選「覆蓋」會清空該學員原本的班級，只是要改電話建議選「合併」）。無需資料庫異動。
- **新增：學員管理頁點姓名可直接編輯**：不用再透過 Excel 匯出/改檔/匯入才能改一兩位學員的資料。點學員姓名開啟編輯視窗，姓名、電話、班級／組別（可多筆）都能直接改，存檔只影響這一位學員，不會有「覆蓋/合併」的選擇困擾。無需資料庫異動。

---

## 2026-07-20

- **新增：場次共用子欄位可鎖定「只在特定場次顯示」** ⚠️ 需另外處理：原本子欄位只能用 `show_if_period`（上午/下午/晚上）控制顯示，同時段有多場次時無法只鎖定其中一場（例：梁皇寶懺十卷裡第一卷跟第九卷都是「上午」，無法讓午齋問題只在第九卷出現）。新增 `event_session_fields.show_if_session_ids` 欄位，有指定場次時只在那幾場顯示（忽略 `show_if_period`）；空陣列（預設）維持原本時段規則，不影響既有資料與舊活動。**已 Sync fork 的分院請到 Supabase SQL Editor 執行 `sql/add_session_field_target_sessions.sql`**（新建置的環境已包含在 `full_setup_all_in_one.sql` 內，無需另外處理）。

---

## 2026-07-22

- **修復：`sql/schema.sql` 內容整段重複，導致全新環境建置一定會執行失敗**：`schema.sql` 第 5～15 節（稽核日誌、功德主管理、排車系統、法師管理、關係連結、義工帳號管理、RLS 啟用、RLS Policies、GRANT 權限、預設模板、師父帳號設定）從第 662 行起被完整貼了第二次，`CREATE POLICY` 等非幂等語法在全新資料庫上執行到第二次會直接報錯（`policy "anon can select students" for table "students" already exists`），代表這份「全新環境一次建置」腳本本身從未被完整跑通過（正式環境是逐步累積建出來的，沒人真的用它建過全新資料庫）。已在建自動化測試環境時第一次實際執行整份腳本才發現。已刪除重複區塊，`sql/full_setup_all_in_one.sql` 同步修正（少了對應的 371 行）。⚠️ 僅影響「尚未建置資料庫的全新環境」，既有已上線分院無需處理（不涉及既有資料庫的欄位/函式異動）。
- **修復：`sql/full_setup_all_in_one.sql` 裡多支歷史 migration 各自重建同一張表的 RLS Policy，全新環境會跑到 42710 已存在的錯**：同一次全新環境測試陸續發現的一系列同性質問題——`monk_setup.sql`（[5/81]）跟 `schema.sql`（[1/81]）都各自建了一次 `temple_monks`／`car_monks` 的 Policy；`registration_changes`（anon can insert changes／authenticated full access on changes）、`registrations`（anon can delete registrations）、`car_assignments`／`car_members`／`car_leaders`（anon can read 三支）也都各自被兩支不同 migration 檔重複建立過。已比照檔案裡其他地方（`event_sessions`／`registration_session_checkins`）既有的做法，在每處重建前補上 `DROP POLICY IF EXISTS`，並用逐一核對每個 Policy／Trigger／Constraint 名稱的方式確認整份檔案沒有其他遺漏。⚠️ 同樣僅影響全新建置流程，既有分院無需處理。
- **修復：`sql/full_setup_all_in_one.sql` 第一次用到 `cron.schedule` 時 pg_cron extension 還沒啟用**：檔案裡 `CREATE EXTENSION IF NOT EXISTS pg_cron;` 原本擺在 [51/81]（訪客電話自動清除），但更早的 [47/81]（定期範本自動建立）就已經在用 `cron.schedule(...)`，正式環境當初是先在 Supabase Dashboard 手動勾選啟用過 pg_cron 才沒發現這個順序問題，全新環境從頭跑會在 [47/81] 這裡報 `schema "cron" does not exist`。已把 `CREATE EXTENSION IF NOT EXISTS pg_cron;` 提前插入到 [47/81] 區塊最前面（該語法本身幂等，原本 [51/81] 那行不用動）。⚠️ 僅影響全新建置流程，既有分院無需處理。
- **RPC 函式主檔整理＋安全修正** ⚠️ 需另外處理：用資料庫函式健檢工具（`D:\Claude\projects\資料庫函式健檢工具\`）比對全部 SQL 檔案，發現車輛／隨車法師／領隊 token／坡務／學員報名查詢／週期性活動這幾組共 11 支函式，一直沒有固定主檔，同一支函式最多曾散落在 3 支不同的「這次改這個」檔案裡（例如 `get_car_by_token` 同時活在 3 支檔案）。已整理成 4 支新主檔：`sql/rpc_car.sql`（7 支：`get_car_by_token`／`get_leader_cars`／`checkin_car_member`／`checkin_all_car`／`checkin_car_monk`／`get_head_leader_by_token`／`is_token_expired`）、`sql/rpc_chore.sql`（2 支：`get_chore_locations_by_event`／`get_chore_by_token`）、`sql/rpc_kiosk_student.sql`（1 支：`kiosk_get_registrations_for_student`）、`sql/rpc_events.sql`（1 支：`create_recurring_events_in_range`）。原本 9 支舊檔案（`fix_car_token_security.sql`、`fix_head_leader_checkin_token.sql`、`add_dormitory_room_to_rpcs.sql`、`fix_rls_registrations_anon.sql`、`add_chore_checkin_rpc.sql`、`lock_expired_token_pages.sql`、`enhance_chore_locations_rpc.sql`、`fix_recurring_fields_volunteers.sql`、`recurring_batch2.sql`）都已加註「已作廢」，往後只在新主檔修改。
  - **⚠️ 順帶補回一個真實安全缺口**：整理過程中直接查正式環境 `pg_get_functiondef` 核對才發現，2026-07-14 `lock_expired_token_pages.sql` 寫的「活動結束後鎖住公開 token 頁面」邏輯，`get_car_by_token`／`get_leader_cars` 這兩支從來沒有真的部署上線過——活動結束後，舊連結（義工手機／LINE 對話紀錄常見）依然打得開，會顯示學員姓名、電話等個資。已在 `rpc_car.sql` 補上線（`checkin_*` 三支和 `get_chore_by_token` 原本就有生效，不受影響）。
  - **已 Sync fork 的分院請務必到 Supabase SQL Editor 依序執行 `sql/rpc_car.sql`、`sql/rpc_chore.sql`、`sql/rpc_kiosk_student.sql`、`sql/rpc_events.sql` 這 4 支檔案**（新建置的環境已包含在 `full_setup_all_in_one.sql` 第八階段內，無需另外處理）。若已上線一段時間，建議優先確認並補跑，堵住上述個資外洩缺口。
- **新增：回山活動功德主通知（含當天資訊管理頁）** ⚠️ 需另外處理（資料庫欄位異動）：活動設定新增獨立開關「此活動含功德主通知」（`events.has_donor_notify`，任何 `event_type` 皆可用，跟精舍法會報到用的 `is_dharma` 互不影響），勾選後可在活動詳情頁使用新的「📅 當天資訊管理」頁（`/admin/events/:id/donor-dayof`）：撈功德主名單、標示是否已綁定 LINE 與已排到的車次、逐位填寫午齋桌次並可指定桌長，確認畫面依桌次分組預覽後才真正發送；也可在「功德主管理」頁用新按鈕「📨 發送功德主通知」在法會前先發一次（不含桌次資訊）。新增 `event_donors.lunch_table`／`is_table_leader` 兩個欄位、新的 Edge Function `send-donor-notification`（部署方式同 `send-car-notification`，需另外 `supabase functions deploy send-donor-notification`）、`src/lib/donorNotify.js`。**已 Sync fork 的分院請到 Supabase SQL Editor 執行 `sql/add_donor_dayof_fields.sql`**（新建置的環境已包含在 `full_setup_all_in_one.sql` 內，無需另外處理）。
- **核對確認：`event_donors` anon 權限**：查證 `schema.sql`（停在 5/23）雖然仍寫著開放 anon 存取 `event_donors`，但正式環境早於 2026-06-05 已透過 `fix_rls_clean.sql`（已收錄於 `full_setup_all_in_one.sql` 第 52 項）修復，目前正式環境安全無虞。這次額外整理出 `sql/fix_event_donors_anon_leak.sql`，供尚未完整跑過 migration（只建了 `schema.sql`）的既有環境單獨執行用，不影響已依完整流程建置的環境。
- **修復：活動管理「匯出模板」清單混入精舍活動、已結束的法會無法選**：`openExportModal()` 原本只排除 `status='closed'`，完全沒有依中台／精舍篩選，精舍自己的活動會混進候選清單；同時已結束的法會（最常見的「拿去年辦過的法會當範本」情境）反而被排除選不到。已改為只列出 `location_tag='zhongtai'` 的活動，且不再排除已結束的，清單裡用（已結束）標示。無需資料庫異動。

---

## 2026-07-22（續二）

- **新增：報到頁「功德主明細」顯示開關**：`CheckinPage.jsx` 刷卡成功畫面的功德主卡片，原本固定列出該場活動設定的全部動態欄位（地址、電話等）。新增頂部工具列勾選開關（預設不勾），不勾時只顯示精簡徽章「🪷 法會功德主・已報到」，勾選才顯示完整明細（跟出單機印單同樣內容）。純畫面顯示邏輯，不影響出單機列印內容，無需資料庫異動。已部署，良師父已在「現場報到」頁確認開關正常運作。

## 2026-07-22（續）

- **修復：`sql/check_migration_version.sql` 版本健診表沒有涵蓋最新兩筆資料庫異動**：這份檢查表最後更新於 7/18，沒有把 7/19（學員電話外洩修復）、7/20（場次子欄位指定場次）這兩筆之後新增的異動列進去，導致既有分院（含已 Fork 的 6 個帳號）就算貼這份檢查表跑，也看不出這兩項還沒套用。已補上對應檢查項目（順序 79、80）。無資料庫異動，純檢查工具本身的修正。

## 2026-07-22（續三）

- **當天資訊管理頁：實測後修正一批細節**（承續上方「回山活動功德主通知」功能，同一批 SQL 異動，無新增資料庫欄位）：
  - **修復：未綁定 LINE 的功德主原本會被排除在分桌名單外**——即使填了午齋桌次，也不會出現在桌長收到的全桌名單裡。已將「有沒有排進某一桌」跟「能不能收到自己的個人 LINE 通知」拆開，前者不再要求綁定 LINE。
  - 外出活動（`event_type='mountain'`）活動詳情頁不再顯示「📋 現場報到」按鈕，避免跟領隊/車輛報到系統搞混（原本此按鈕不分活動類型一律顯示，屬既有行為修正）。
  - 「確認發送內容」畫面改版：每位收件人先各自預覽車次／合影波次／午齋桌次，桌次名單合併成一行顯示（含未綁定 LINE 者姓名），桌長另列，注意事項移到卡片最下面去重顯示一次。
  - 新增「統一備註」欄位（發送前現場輸入，例：「帶海青到東明台領證」），跟功德主個人備註疊加顯示，不寫入資料庫。
  - 桌長專屬的全桌名單通知開頭加註「您是 X 桌桌長」，避免收到的人不知道自己被指定。
  - 發送結果畫面「未綁定跳過」「失敗」都補上姓名清單（原本只有失敗才列名單）。
  - `supabase/functions/send-donor-notification` 需另外用 `supabase functions deploy send-donor-notification` 部署（跟 `send-car-notification` 同樣的部署方式，git push 不會自動生效）。

---

## 2026-08-04

- **新增：多日回山排車** ⚠️ 需另外處理：回山活動辦 2 天以上、每天分開發車時，`car_assignments` 原本只有去程/回程方向，多日的車全部混在同一份「去程」清單，無法分開看或個別設定時間。活動設定新增「多日交通安排」開關（只在活動起訖日不同時顯示），開啟後報名表單自動加上「參加日期」「是否掛單（中間留宿）」兩個動態欄位，排車頁依日期＋方向分開篩選名單、分開排車。只套用到之後新建的活動，既有活動不受影響。**已 Sync fork 的分院請到 Supabase SQL Editor 執行 `sql/add_multiday_transport_and_small_overrides.sql`**（新建置的環境已包含在 `full_setup_all_in_one.sql` 內，無需另外處理）。
- **新增：大量排車操作優化**：70+ 台車、500+ 人的活動排車頁新增搜尋框（車輛名稱／乘客姓名即時篩選定位）與統計列（總車數／已排滿／未排人數）；大車名單改為多選＋「移到小車」，可搜尋選擇目標小車一次性移動多人（原本只有訪客能單筆移動，且重新整理就消失）。
- **修復：「移到小車」補上持久化** ⚠️ 需另外處理：把大車的人移到小車，原本只存在前端 `guestSmallOverrides` state，重新整理就消失，且只限訪客。新增 `car_small_overrides` 資料表明確記錄這個對應關係，儲存後可正確保留，且學員也能被移動。
- **修復：車輛看板 token 鎖定邏輯支援多日排車** ⚠️ 需另外處理：`get_car_by_token`／`get_leader_cars`（`sql/rpc_car.sql`）原本只用活動 `date_end` 判斷是否鎖住，多日活動時同一活動底下不同日期的車會一起鎖住/開放，不夠精細。改成：車輛有 `service_date` 就用該日期判斷是否已過，沒有（單日活動或既有資料）才 fallback 回原本的 `date_end` 判斷。**補件**：同一支檔案裡的 `checkin_car_member`／`checkin_all_car`／`checkin_car_monk`／`is_token_expired` 原本沒有跟著改，只看整個活動的 `date_end`，多日活動某天的車 `service_date` 已過、看板已經查不到了，這幾支卻還允許寫入報到資料，已一併補上同一套判斷；`get_head_leader_by_token`（總領隊/小車領隊看板）維持看整個活動 `date_end`，因為它回傳的是「這個人」的權限範圍，不是單一台車。

---

## 2026-08-09

- **新增：多日回山活動「分時段」** ⚠️ 需另外處理：部分精舍因路途近，同一天有多個發車／回程梯次（例如上午、中午分開發車），不一定跟掛單留宿有關，原本的「參加日期」單一欄位無法表達這種情況。活動設定「多日交通安排」底下新增巢狀的「分時段」子選項（`events.multi_slot_transport`，預設關閉，僅新建活動可用），開啟後報名表單改成依每一天生成「去程時段」「回程時段」兩題（去程可選上午／中午，回程可選中午／下午），取代「參加日期」欄位；「是否掛單」問題保留、且只在填答涵蓋 2 天以上時才顯示（單日來回者不會被問）。排車頁新增時段分組（`car_assignments.time_slot`），同一天同方向的不同時段車輛分開排。**已 Sync fork 的分院請到 Supabase SQL Editor 執行 `sql/add_multi_slot_transport.sql`**（新建置的環境已包含在 `full_setup_all_in_one.sql` 內，無需另外處理）。
- 與此同時修正 `CarrangementDetailPage.jsx` 排車頁一支重複 5 次的「日期×方向×時段」三層迴圈骨架，抽成共用的 `allDateDirectionSlots`（`src/lib/carSlotHelpers.js`），純屬內部程式碼整理，無行為變動。

---

## 2026-08-10（續二）

- **新增：多日回山排車「其他日期」分頁＋自動判斷＋跨分頁手動指定** ⚠️ 需另外處理：部分精舍多日回山活動有少數信眾提前一天掛單回山、或延後一天回家，不在正常的日期/時段班表內，原本系統完全沒有地方安置這些人。新增：① 分時段題目（8/09 那次新增的「去程時段」「回程時段」）從固定寫死「去程上午/中午、回程中午/下午」改成後台可彈性勾選（`events.up_slot_options`／`down_slot_options`），某方向勾選數 ≤1 個時不出該方向的時段題，向下相容既有活動；② 排車頁新增常駐「其他日期」分頁（分方向、不分時段、不分大小車，`car_assignments.is_other_date`），後台可手動新增車輛、搜尋姓名加人，不受活動官方日期範圍限制，領隊 token 連結沿用既有機制自動涵蓋，無需另外設定；③ 系統自動比對報名者掛單起訖日期（既有 `stay_start`/`stay_end` 欄位）跟活動官方日期，超出範圍且交通方式非「其他交通」者自動歸類到「其他日期」；④ 新增跨分頁手動指定機制（`registration_bucket_overrides`），可把任何人手動移到別的分頁，若本人事後又修改了會影響自動判斷的答案，既有指定不會被清除但會標示「可能異動」提醒後台確認；「其他日期」分頁另有「待處理」清單，列出系統判斷該歸這裡但還沒被排進車的人，避免被遺漏。**已 Sync fork 的分院請到 Supabase SQL Editor 執行 `sql/add_other_date_bucket.sql`**（新建置的環境已包含在 `full_setup_all_in_one.sql` 內，無需另外處理）。

---

## 使用說明

- 一般性的文字調整、說明文件更新、不影響資料庫的小幅修正，僅記錄於本檔案，不會另行通知。
- 涉及資料庫欄位、資料表、函式（RPC）異動的更新，除記錄於本檔案外，開發者會主動以 LINE 或 email 通知，並提供對應的 SQL 執行說明。
- 若不確定自己的資料庫是否已套用最新異動，可使用 `sql/check_migration_version.sql` 檢查。
