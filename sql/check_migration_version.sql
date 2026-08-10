-- ============================================================
-- 版本健診：檢查這個 Supabase 資料庫實際套用到哪一版
-- 建立日期：2026-07-18
-- 用法：貼到 Supabase Dashboard → SQL Editor → Run，看結果表格
--       status 欄位 ✅ = 已套用、❌ = 尚未套用
--       對照 sql/MIGRATION_ORDER.md「第七階段」的順序編號，
--       找到第一個 ❌ 就是接下來該從哪個檔案開始補跑
-- 注意：只檢查「這個東西存不存在」，不驗證邏輯內容是否為最新版本
--       （多次 CREATE OR REPLACE 的函式，只能確認有沒有建立，
--       抓不出是不是套到最後一次修改，這種情況本檢查表會註記）
-- ============================================================

WITH checks(seq, migration_file, note, ok) AS (
  VALUES
  (50, 'fix_rls_clean.sql',
   'event_donors 應完全鎖 anon',
   NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_donors' AND 'anon' = ANY(roles))),

  (51, 'fix_recurring_fields_volunteers.sql',
   '函式 create_recurring_events_in_range 存在',
   to_regproc('create_recurring_events_in_range') IS NOT NULL),

  (52, 'fix_rls_registrations_anon.sql',
   'registrations 應無 anon SELECT 政策，改用 RPC',
   NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'registrations' AND cmd = 'SELECT' AND 'anon' = ANY(roles))
   AND to_regproc('kiosk_get_registrations_for_student') IS NOT NULL),

  (53, 'fix_volunteer_event_access.sql',
   'volunteer_event_access 應只允許 admin 寫入',
   EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'volunteer_event_access' AND policyname LIKE '%admin%')),

  (54, 'kiosk_submit_registration.sql',
   'Kiosk 學員自助報名 RPC 存在',
   to_regproc('kiosk_submit_registration') IS NOT NULL),

  (55, 'grant_student_classes.sql',
   'service_role 可讀 student_classes',
   has_table_privilege('service_role', 'student_classes', 'SELECT')),

  (56, 'fix_friend_registration_rls.sql',
   '代報親友 RPC 存在',
   to_regproc('kiosk_submit_friend_registration') IS NOT NULL),

  (57, 'fix_get_student_by_qr_active.sql',
   'get_student_by_qr 函式存在（無法驗證是否已移除 active 過濾）',
   to_regproc('get_student_by_qr') IS NOT NULL),

  (58, 'fix_cancel_registration_rls.sql',
   '取消報名 RPC 存在',
   to_regproc('kiosk_cancel_registration') IS NOT NULL),

  (59, 'fix_update_checkin_rls.sql',
   '報到相關 RPC 存在',
   to_regproc('kiosk_update_registration') IS NOT NULL
   AND to_regproc('kiosk_checkin_other_transport') IS NOT NULL),

  (60, 'add_dormitory_phone_lineid.sql',
   'registrations.dormitory_room／students.phone／students.line_user_id 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='registrations' AND column_name='dormitory_room')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='phone')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='line_user_id')),

  (61, 'add_show_dormitory_to_public.sql',
   'events.show_dormitory_to_public 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='show_dormitory_to_public')),

  (63, 'add_line_notify_fields.sql',
   'events.default_notice_text 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='default_notice_text')),

  (64, 'grant_students_update_service_role.sql',
   'service_role 可更新 students',
   has_table_privilege('service_role', 'students', 'UPDATE')),

  (65, 'add_chore_arrangement.sql',
   'chores／chore_members 表與 events.is_chore_event 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='chores')
   AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='chore_members')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='is_chore_event')),

  (66, 'add_chore_monk_phone.sql',
   'chores.supervising_monk_phone 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chores' AND column_name='supervising_monk_phone')),

  (67, 'add_chore_checkin_rpc.sql',
   'get_chore_by_token 函式存在',
   to_regproc('get_chore_by_token') IS NOT NULL),

  (68, 'fix_car_token_security.sql',
   'checkin_car_member／checkin_all_car／checkin_car_monk 函式存在（無法驗證是否為 7/15 最終版）',
   to_regproc('checkin_car_member') IS NOT NULL
   AND to_regproc('checkin_all_car') IS NOT NULL
   AND to_regproc('checkin_car_monk') IS NOT NULL),

  (69, 'add_chore_session_times.sql',
   'events.chore_am_work_time 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='chore_am_work_time')),

  (70, 'lock_expired_token_pages.sql',
   'is_token_expired／get_head_leader_by_token 函式存在',
   to_regproc('is_token_expired') IS NOT NULL
   AND to_regproc('get_head_leader_by_token') IS NOT NULL),

  (71, 'fix_chores_anon_policy.sql',
   'chores／chore_members 應無 anon SELECT 政策',
   NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('chores','chore_members') AND 'anon' = ANY(roles))),

  (73, 'add_all_cars_progress_by_token_rpc.sql',
   'get_all_cars_progress_by_token 函式存在',
   to_regproc('get_all_cars_progress_by_token') IS NOT NULL),

  (75, 'add_donor_dynamic_fields.sql',
   'event_donor_fields 表與 event_donors.answers 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='event_donor_fields')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_donors' AND column_name='answers')),

  (76, 'fix_leader_scan_rpc.sql',
   'find_leader_by_student_id_public 函式存在',
   to_regproc('find_leader_by_student_id_public') IS NOT NULL),

  (77, 'add_chore_temple_date.sql',
   'chores.temple／chores.chore_date 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chores' AND column_name='temple')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chores' AND column_name='chore_date')),

  (78, 'add_donor_ticket_copies.sql',
   'events.donor_ticket_default_copies 欄位存在',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='donor_ticket_default_copies')),

  (79, 'fix_students_phone_anon_leak.sql',
   '⚠️ 安全性：anon 應讀不到 students.phone／line_user_id（2026-07-19）',
   NOT has_column_privilege('anon', 'students', 'phone', 'SELECT')
   AND NOT has_column_privilege('anon', 'students', 'line_user_id', 'SELECT')),

  (80, 'add_session_field_target_sessions.sql',
   'event_session_fields.show_if_session_ids 欄位存在（2026-07-20）',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_session_fields' AND column_name='show_if_session_ids')),

  (85, 'add_donor_dayof_fields.sql',
   'events.has_donor_notify／event_donors.lunch_table／is_table_leader 欄位存在（回山活動功德主通知，2026-07-22）',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='has_donor_notify')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_donors' AND column_name='lunch_table')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='event_donors' AND column_name='is_table_leader')),

  (86, 'add_multiday_transport_and_small_overrides.sql',
   'events.multi_day_transport／car_assignments.service_date／car_small_overrides 表存在（多日回山排車＋大車移小車持久化，2026-08-04）',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='multi_day_transport')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='car_assignments' AND column_name='service_date')
   AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='car_small_overrides')),

  (87, 'add_multi_slot_transport.sql',
   'events.multi_slot_transport／car_assignments.time_slot 欄位存在（多日回山活動分時段，2026-08-09）',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='multi_slot_transport')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='car_assignments' AND column_name='time_slot')),

  (88, 'add_other_date_bucket.sql',
   'events.up_slot_options／car_assignments.is_other_date／registration_bucket_overrides 表存在（排車其他日期分頁＋分時段彈性選項，2026-08-10）',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='up_slot_options')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='car_assignments' AND column_name='is_other_date')
   AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='registration_bucket_overrides'))
)
SELECT
  seq AS "順序",
  migration_file AS "檔案",
  CASE WHEN ok THEN '✅' ELSE '❌' END AS "狀態",
  note AS "檢查項目"
FROM checks
ORDER BY seq;

-- ============================================================
-- 補充：62（add_dormitory_room_to_rpcs.sql）、72（enhance_chore_locations_rpc.sql）、
-- 74（fix_head_leader_checkin_token.sql）這三個檔案只重新定義既有函式、
-- 沒有新增可單獨判斷的表／欄位，無法用這種方式檢查出來，
-- 只能確認前後相鄰的檔案都是 ✅，並實際操作對應頁面測試。
-- ============================================================
