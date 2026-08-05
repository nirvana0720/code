-- 職責：報名系統自動化測試專用種子資料
-- ⚠️ 只能貼在「測試專案」的 SQL Editor 執行，絕對不要貼到正式環境！
--    正式環境是 puyi-reg.vercel.app 用的那個 Supabase 專案（yiowkvxwvwpzebdriksu，
--    跟補課系統共用），跟這個測試專案是完全分開的兩個。
--
-- 用途：給 test/run.js 自動化測試用。所有 id 用固定的假 UUID（xxxxxxxx-xxxx-xxxx-xxxx-0000000000xx
-- 這種一看就知道是測試資料的格式），token 也用固定的可讀字串，run.js 不用另外查 id。
-- 日期用「今天」往前/往後推算（CURRENT_DATE ± N），不管哪天執行都有效。
--
-- 執行前提：這個測試專案要先貼過 code/sql/full_setup_all_in_one.sql 建好所有表格 + 函式。
--
-- 可重複執行：開頭會先清掉同一批測試資料（靠固定 id 前綴 'TESTSTU'/'TESTMONK' 跟固定 UUID）再重建。

BEGIN;

-- 先清掉舊的測試資料。events 用 CASCADE 會連帶刪光 car_assignments/car_leaders/car_members/
-- car_monks/head_leader/chores/chore_members/registrations，students/temple_monks 要另外刪。
DELETE FROM events WHERE event_id IN (
  '00000000-0000-0000-0000-0000000000a1',  -- 測試活動：進行中
  '00000000-0000-0000-0000-0000000000a2'   -- 測試活動：已結束
);
DELETE FROM students WHERE student_id IN ('TESTSTU001', 'TESTSTU002');
DELETE FROM temple_monks WHERE id = '00000000-0000-0000-0000-0000000000d1';

-- ============================================================
-- 1) 兩名測試學員（一個開車、一個坐車）
-- ============================================================
INSERT INTO students (student_id, qr_code, name, active) VALUES
  ('TESTSTU001', 'TESTQR001', '測試學員甲', true),
  ('TESTSTU002', 'TESTQR002', '測試學員乙', true);

-- ============================================================
-- 2) 兩場測試活動：一場進行中（date_end 還沒到），一場已結束（date_end 已過）
--    用來驗證 get_car_by_token / get_chore_by_token 的「活動結束自動鎖住」邏輯。
-- ============================================================
INSERT INTO events (event_id, name, date_start, date_end, location, event_type, status, is_dharma) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '測試活動-進行中', CURRENT_DATE - 1, CURRENT_DATE + 1, '普宜精舍', 'mountain', 'active', false),
  ('00000000-0000-0000-0000-0000000000a2', '測試活動-已結束', CURRENT_DATE - 10, CURRENT_DATE - 5, '普宜精舍', 'mountain', 'active', false);

-- ============================================================
-- 3) 兩筆報名（甲=駕駛，乙=乘客，都掛在「進行中」活動下）
--    answers 故意塞一個 guest_phone，用來驗證 kiosk_get_registrations_for_student 有遮掉它。
-- ============================================================
INSERT INTO registrations (registration_id, event_id, student_id, is_driver, answers) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'TESTSTU001', true,
    '{"guest_phone": "0912345678", "note": "測試備註"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'TESTSTU002', false, '{}'::jsonb);

-- ============================================================
-- 4) 車輛分組：進行中活動一台車、已結束活動一台車，各自固定 token
--    另外兩台車測 service_date 優先於 date_end 的鎖定邏輯（2026-08-04 多日回山排車）：
--    b3 掛在「進行中」活動（date_end 還沒到，本來不會鎖）但自己的 service_date 已過 → 應鎖住
--    b4 掛在「已結束」活動（date_end 已過，本來會鎖）但自己的 service_date 還沒到 → 應維持開放
-- ============================================================
INSERT INTO car_assignments (car_id, event_id, car_name, seats, car_type, direction, access_token) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '測試車1號', 20, 'large', 'up', 'TEST_CAR_TOKEN_ACTIVE'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', '測試車2號（已結束活動）', 20, 'large', 'up', 'TEST_CAR_TOKEN_EXPIRED');

INSERT INTO car_assignments (car_id, event_id, car_name, seats, car_type, direction, service_date, access_token) VALUES
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', '測試車3號（service_date 已過）', 20, 'large', 'up', CURRENT_DATE - 1, 'TEST_CAR_TOKEN_SVCDATE_PAST'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a2', '測試車4號（service_date 未到）', 20, 'large', 'up', CURRENT_DATE + 1, 'TEST_CAR_TOKEN_SVCDATE_FUTURE');

-- 領隊 = 測試學員甲；車上成員 = 甲(駕駛) + 乙
INSERT INTO car_leaders (car_id, registration_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1');
INSERT INTO car_members (car_id, registration_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2');

-- ============================================================
-- 5) 一位法師 + 車上法師簽到記錄
-- ============================================================
INSERT INTO temple_monks (id, name, active) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '測試法師', true);
INSERT INTO car_monks (id, car_id, monk_id) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1');

-- ============================================================
-- 6) 總領隊 token（同一活動，用來測「head_leader token 也能報到該活動任一台車」）
-- ============================================================
INSERT INTO head_leader (id, event_id, type, access_token) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'all', 'TEST_HEAD_LEADER_TOKEN');

-- ============================================================
-- 7) 一筆坡務（上午），成員 = 測試學員甲的報名
-- ============================================================
INSERT INTO chores (chore_id, event_id, session, unit, work_content, location, access_token) VALUES
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1', '上午', '測試單位', '測試工作內容', '大殿', 'TEST_CHORE_TOKEN');
INSERT INTO chore_members (id, chore_id, registration_id) VALUES
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000c1');

COMMIT;

-- 驗收：三個查詢都應該有資料回來
SELECT car_id, car_name, access_token FROM car_assignments WHERE car_id IN
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
SELECT chore_id, access_token FROM chores WHERE chore_id = '00000000-0000-0000-0000-0000000000a9';
SELECT registration_id, student_id, is_driver FROM registrations WHERE event_id = '00000000-0000-0000-0000-0000000000a1';
