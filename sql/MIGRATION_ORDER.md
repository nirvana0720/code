# SQL 遷移執行順序

> 若要在新環境重建資料庫，依照以下順序執行。
> 每個檔案都設計為可重複執行（`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`）。

## 第一階段：基礎架構

| 順序 | 檔案 | 說明 |
|------|------|------|
| 1 | `schema.sql` | 主要資料表（students、events、registrations 等） |
| 2 | `admin_setup.sql` | 管理員帳號與 anon 基本 GRANT |
| 3 | `role_setup.sql` | 角色定義（admin / volunteer） |
| 4 | `volunteer_access_setup.sql` | 義工存取權限 |
| 5 | `monk_setup.sql` | 法師資料表 |
| 6 | `relationship_setup.sql` | 學員關係連結 |

## 第二階段：報名功能

| 順序 | 檔案 | 說明 |
|------|------|------|
| 7 | `registration_tracking_setup.sql` | 報名追蹤欄位 |
| 8 | `cancel_registration_setup.sql` | 取消報名功能 |
| 9 | `guest_registration_setup.sql` | 訪客報名 |
| 10 | `batch_e_setup.sql` | 批次 E 設定 |

## 第三階段：車輛系統

| 順序 | 檔案 | 說明 |
|------|------|------|
| 11 | `car_arrangement_setup.sql` | 車輛安排主表 |
| 12 | `small_car_leader_setup.sql` | 小車領隊 |
| 13 | `add_direction_to_car_assignments.sql` | 上下山方向欄位 |
| 14 | `fix_unique_for_direction.sql` | 方向唯一值修正 |
| 15 | `add_car_member_checkin.sql` | 車輛報到功能 |
| 16 | `add_pre_depart.sql` | 提早出發設定 |
| 17 | `add_late_return.sql` | 晚回設定 |

## 第四階段：欄位擴充

| 順序 | 檔案 | 說明 |
|------|------|------|
| 18 | `add_field_types.sql` | 自訂欄位類型 |
| 19 | `add_boolean_field_type.sql` | 布林欄位類型 |
| 20 | `add_date_field_type.sql` | 日期欄位類型 |
| 21 | `add_event_type.sql` | 活動類型欄位 |
| 22 | `add_host_student_id.sql` | 主辦人學員 ID |
| 23 | `add_placeholder_column.sql` | 佔位欄位 |
| 24 | `add_activities_fields.sql` | 活動頁欄位 |
| 25 | `add_related_links.sql` | 相關連結 |
| 26 | `add_cover_image_position.sql` | 封面圖位置 |
| 27 | `add_kiosk_open.sql` | Kiosk 開放設定 |
| 28 | `add_volunteer_open.sql` | 義工報名開放 |
| 29 | `add_walkin_mode.sql` | 現場報名模式 |
| 30 | `add_registration_source.sql` | 報名來源 |

## 第五階段：模板與重複活動

| 順序 | 檔案 | 說明 |
|------|------|------|
| 31 | `add_templates_table.sql` | 活動模板表 |
| 32 | `add_phase2_b.sql` | Phase 2b 欄位補充 |
| 33 | `add_phase3.sql` | Phase 3（功德主表） |
| 34 | `phase5_batch1_sessions.sql` | Phase 5 場次 |
| 35 | `phase5_session_fields.sql` | Phase 5 場次欄位 |
| 36 | `phase5_batch1_fix_policies.sql` | Phase 5 RLS 修正 |
| 37 | `add_is_recurring.sql` | 重複活動標記 |
| 38 | `create_recurring_templates.sql` | 重複活動模板 |
| 39 | `template_session_fields_migration.sql` | 模板場次欄位遷移 |
| 40 | `registration_session_checkins.sql` | 場次報到 |

## 第六階段：資料修正與維護

| 順序 | 檔案 | 說明 |
|------|------|------|
| 41 | `class_normalization.sql` | 班別名稱正規化 |
| 42 | `update_fields_and_transport.sql` | 欄位與交通更新 |
| 43 | `batch_update_transport.sql` | 批次交通資料更新 |
| 44 | `update_default_templates.sql` | 預設模板更新 |
| 45 | `dashboard_role_migration.sql` | Dashboard 角色遷移 |
| 46 | `show_transport_to_public_migration.sql` | 交通資訊公開遷移 |
| 47 | `recurring_batch2.sql` | 重複活動批次 2 |
| 48 | `recurring_batch3.sql` | 重複活動批次 3 |
| 49 | `events_lock.sql` | 活動鎖定機制 |

## 定時任務（Cron）

| 檔案 | 說明 |
|------|------|
| `weekly_gonxiu_cron.sql` | 每週功修自動建立 |
| `clean_guest_phone_cron.sql` | 定期清理訪客電話 |

## 第七階段：2026-06 起累積修正（schema.sql／原 1–49 清單之後，2026-07-18 補列）

> 這批是 6/07 之後陸續發生的，之前一直沒有回填進本文件——`schema.sql` 停在 5/23，
> 這段期間另外跑了將近 30 個 migration 才是資料庫的真實狀態。若要在新環境重建，
> 第一～六階段跑完後，接著依序執行以下檔案。全部檔案皆用 `IF NOT EXISTS` /
> `CREATE OR REPLACE FUNCTION` / `DROP POLICY IF EXISTS` 寫法，可重複執行不會出錯。

| 順序 | 檔案 | 說明 |
|------|------|------|
| 50 | `../fix_rls_clean.sql`（在上層 `puyi-signup/` 目錄，不在 `sql/` 內） | 2026-06-05：registrations 移除 anon UPDATE/DELETE；event_donors 完全封鎖 anon |
| 51 | `fix_recurring_fields_volunteers.sql` | 修復定期活動建立時漏複製動態欄位／義工存取 |
| 52 | `fix_rls_registrations_anon.sql` | registrations anon SELECT 收緊，改用 RPC |
| 53 | `fix_volunteer_event_access.sql` | 修復義工可自行擴權漏洞 |
| 54 | `kiosk_submit_registration.sql` | Kiosk 學員自助報名寫入用 RPC，2026-06-11 建立，2026-07-18 已從正式環境取回定義並補存成檔案 |
| 55 | `grant_student_classes.sql` | GRANT service_role 讀取 student_classes（比對未報名名單用） |
| 56 | `fix_friend_registration_rls.sql` | 修復代報親友報名 RLS（新增 kiosk_submit_friend_registration RPC） |
| 57 | `fix_get_student_by_qr_active.sql` | get_student_by_qr 移除 active 過濾，未在籍學員也能報名 |
| 58 | `fix_cancel_registration_rls.sql` | 前台取消報名改用 RPC |
| 59 | `fix_update_checkin_rls.sql` | updateRegistration／checkInOtherTransport 改用 RPC |
| 60 | `add_dormitory_phone_lineid.sql` | 安單寮號＋LINE 綁定＋學員電話三大功能欄位 |
| 61 | `add_show_dormitory_to_public.sql` | 寮號對外公開開關 |
| 62 | `add_dormitory_room_to_rpcs.sql` | 既有 RPC 補上 dormitory_room 欄位 |
| 63 | `add_line_notify_fields.sql` | LINE 車次通知相關欄位 |
| 64 | `grant_students_update_service_role.sql` | GRANT service_role 更新 students（LINE webhook 寫 line_user_id 用） |
| 65 | `add_chore_arrangement.sql` | 福慧出坡排坡系統主體（chores／chore_members 等表） |
| 66 | `add_chore_monk_phone.sql` | 坡務負責法師電話欄位 |
| 67 | `add_chore_checkin_rpc.sql` | 小組長免登入報到頁 RPC |
| 68 | `fix_car_token_security.sql` | 車次 Token 安全修復（RLS + RPC，2026-06-07 建立、2026-07-13 隨排坡系統再更新，內容以此時間點為準） |
| 69 | `add_chore_session_times.sql` | 排坡出坡／報到時間欄位 |
| 70 | `lock_expired_token_pages.sql` | 過期活動 token 頁面鎖定（含 get_head_leader_by_token／is_token_expired 新 RPC） |
| 71 | `fix_chores_anon_policy.sql` | 收緊 chores／chore_members anon 全表讀取，改 RPC |
| 72 | `enhance_chore_locations_rpc.sql` | get_chore_locations_by_event 回傳格式加強 |
| 73 | `add_all_cars_progress_by_token_rpc.sql` | 修復總領隊／小車看板 anon 讀不到資料 |
| 74 | `fix_head_leader_checkin_token.sql` | 修復總領隊／小車看板報到失敗 |
| 75 | `add_donor_dynamic_fields.sql` | 功德主管理改動態欄位（event_donor_fields 新表＋event_donors.answers＋backfill） |
| 76 | `fix_leader_scan_rpc.sql` | 修復 /leader 掃卡入口頁誤判 bug |
| 77 | `add_chore_temple_date.sql` | chores 表補 temple／chore_date 欄位（坡務總表匯出用） |
| 78 | `add_donor_ticket_copies.sql` | 出單機列印張數欄位 |
| 79 | `fix_students_phone_anon_leak.sql` | 安全修正：students 表 anon 讀取權限改白名單（整表 REVOKE + 只 GRANT 安全欄位），堵住 phone／line_user_id 全表外洩，不影響刷 QR 報名與領隊/坡務報到頁（已實測） |
| 80 | `add_session_field_target_sessions.sql` | 場次共用子欄位新增 show_if_session_ids（可鎖定只在特定場次顯示，忽略 show_if_period），不影響既有資料 |

## 第八階段：RPC 主檔整理（2026-07-22，函式健檢後的搬家）

> 背景：用 `D:\Claude\projects\資料庫函式健檢工具\` 掃描才發現，車輛／坡務／學員報名查詢／
> 週期性活動這幾組函式一直沒有固定主檔，同一支函式最多曾散落在 3 支不同的「這次改這個」
> 檔案裡（例如 `get_car_by_token` 同時活在第 62／68／70 項）。以下 4 支新檔案把各自的
> 「目前正式生效、且已合併補齊分歧欄位／補上未上線安全修正」的最終版本收攏成唯一主檔，
> **必須排在第七階段（第 50～80 項）之後執行**，用 `CREATE OR REPLACE` 蓋掉前面幾個舊檔案
> 留下的中間版本，新環境／舊環境都適用。舊檔案本身保留不刪（歷史紀錄＋部分 RLS policy
> 異動仍有效），但檔案開頭都已加註「已作廢」，往後修這幾支函式只回下面 4 支主檔改。

| 順序 | 檔案 | 說明 |
|------|------|------|
| 81 | `rpc_car.sql` | 車輛／隨車法師／領隊 token 主檔：`get_car_by_token`／`get_leader_cars`／`checkin_car_member`／`checkin_all_car`／`checkin_car_monk`／`get_head_leader_by_token`／`is_token_expired`（7 支）。已合併補齊 dormitory_room＋phone 欄位分歧，並補上第 70 項寫了但從未真正部署到正式環境的「活動結束鎖住」安全修正 |
| 82 | `rpc_chore.sql` | 坡務主檔：`get_chore_locations_by_event`／`get_chore_by_token`（2 支） |
| 83 | `rpc_kiosk_student.sql` | 學員報名查詢主檔：`kiosk_get_registrations_for_student`（1 支，含 dormitory_room 欄位） |
| 84 | `rpc_events.sql` | 週期性活動主檔：`create_recurring_events_in_range`（1 支，含複製動態欄位／義工存取設定的完整版本；`recurring_batch2.sql` 的 pg_cron 排程本身不受影響，仍照原檔執行） |

### 不需要執行的檔案（一次性測試／除錯用，已在正式環境清除）

`debug_identity_values.sql`、`test_dormitory_chore_tabs.sql`、`test_dormitory_chore_tabs_cleanup.sql`、
`test_head_leader_board.sql`、`test_head_leader_board_cleanup.sql`、`temp_grant_for_chore_roster_test.sql`
——這些是驗證假資料或除錯查詢用，不是 schema migration，新環境不用跑。

## ⚠️ 注意事項

- ~~`kiosk_submit_registration` RPC 目前沒有存檔~~ **已於 2026-07-18 補上**：從普宜精舍正式
  Supabase 用 `SELECT pg_get_functiondef('kiosk_submit_registration'::regproc);` 取回函式定義，
  存成 `sql/kiosk_submit_registration.sql`（含明確 GRANT EXECUTE，見第 54 項）。
- 2026-06-05 安全修正：`registrations` 移除 anon UPDATE/DELETE，`event_donors` 完全封鎖 anon。
  已列入第七階段第 50 項（`fix_rls_clean.sql`，位於上層 `puyi-signup/` 目錄，不在 `sql/` 內）。
  `fix_rls_critical.sql`（同目錄）是草稿版，多一段未採用的 car_assignments 方案，不需執行。
- 本文件每次有新 migration 都要記得回填，上次漏掉 6/07～7/17 這一大段，就是這次精舍反映
  匯入失敗、追查發現「他版本比較舊」才挖出來的——`schema.sql` 本身沒有同步更新的問題也一併記在這裡：
  `schema.sql` 只到 5/23，之後的表格／欄位/RPC 異動都只存在於個別 migration 檔，沒有回寫主檔，
  新環境務必照順序把 sql/ 全部檔案跑過一輪，不能只跑 `schema.sql` 就當作建好資料庫。
- **2026-07-22 安全性提醒**：第 70 項 `lock_expired_token_pages.sql` 寫的「活動結束後鎖住
  公開 token 頁面」邏輯，經直接查正式環境 `pg_get_functiondef` 核對，`get_car_by_token`／
  `get_leader_cars` 這兩支從來沒有真的部署上線過（只有 checkin_* 三支和 get_chore_by_token
  有生效）。已在第 81 項 `rpc_car.sql` 補上線。已經 Fork 這份程式碼但還沒重新跑過 SQL 的
  分院，**若已經上線一段時間，建議提醒對方補跑第 81～84 項**，否則這個個資外洩缺口
  仍然存在於他們自己的正式環境。
