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

---

## 2026-07-22（續）

- **修復：`sql/check_migration_version.sql` 版本健診表沒有涵蓋最新兩筆資料庫異動**：這份檢查表最後更新於 7/18，沒有把 7/19（學員電話外洩修復）、7/20（場次子欄位指定場次）這兩筆之後新增的異動列進去，導致既有分院（含已 Fork 的 6 個帳號）就算貼這份檢查表跑，也看不出這兩項還沒套用。已補上對應檢查項目（順序 79、80）。無資料庫異動，純檢查工具本身的修正。

---

## 使用說明

- 一般性的文字調整、說明文件更新、不影響資料庫的小幅修正，僅記錄於本檔案，不會另行通知。
- 涉及資料庫欄位、資料表、函式（RPC）異動的更新，除記錄於本檔案外，開發者會主動以 LINE 或 email 通知，並提供對應的 SQL 執行說明。
- 若不確定自己的資料庫是否已套用最新異動，可使用 `sql/check_migration_version.sql` 檢查。
