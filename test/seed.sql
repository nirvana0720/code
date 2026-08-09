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
  '00000000-0000-0000-0000-0000000000a2',  -- 測試活動：已結束
  '00000000-0000-0000-0000-0000000000e2'   -- 測試活動：分時段（multi_slot_transport）
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

-- ============================================================
-- 8) 分時段活動（events.multi_slot_transport，2026-08-09）
--    ⚠️ 這批 event_fields／registrations／car_assignments 是「假設 syncTimeSlotFields／
--    saveCarArrangement 已經正確跑過一次」的最終狀態（手動照它們的產出邏輯灌好），
--    不是透過呼叫這兩支函式產生的——這兩支函式要 authenticated（後台登入）角色才能寫入
--    event_fields／car_assignments，anon key 沒辦法呼叫（實測 anon INSERT event_fields
--    會被 RLS 擋下，42501）。
--    run.js「分時段整合測試」區塊（2026-08-09 補上）改用 config.json 的
--    SUPABASE_SERVICE_ROLE_KEY 繞過 RLS 直接測，但它是自己用 REST 重新建一份
--    event/registrations（不依賴這裡的 fixture 是否為最新狀態，見 run.js 該區塊
--    開頭註解），所以這裡這份 fixture 目前主要用途是：① test/unit_slot_logic.mjs
--    測純邏輯函式時可參照的真實案例、② 供人工在 SQL Editor 查看分時段資料形狀長怎樣、
--    ③ 保留給以後如果要測「真的呼叫 syncTimeSlotFields 本尊」時直接比對用。
--    日期用 CURRENT_DATE+5／+6，避免跟活動 e2 的鎖定判斷卡在邊界。
-- ============================================================
INSERT INTO events (event_id, name, date_start, date_end, location, event_type, status, is_dharma, multi_day_transport, multi_slot_transport) VALUES
  ('00000000-0000-0000-0000-0000000000e2', '測試活動-分時段回山', CURRENT_DATE + 5, CURRENT_DATE + 6, '普宜精舍', 'mountain', 'active', false, true, true);

INSERT INTO event_fields (event_id, field_key, field_label, field_type, options, required, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000000e2', 'slot_up_'   || to_char(CURRENT_DATE + 5, 'YYYY-MM-DD'), '去程時段（day1）', 'radio', '["上午","中午"]'::jsonb, false, -100),
  ('00000000-0000-0000-0000-0000000000e2', 'slot_down_' || to_char(CURRENT_DATE + 5, 'YYYY-MM-DD'), '回程時段（day1）', 'radio', '["中午","下午"]'::jsonb, false, -99),
  ('00000000-0000-0000-0000-0000000000e2', 'slot_up_'   || to_char(CURRENT_DATE + 6, 'YYYY-MM-DD'), '去程時段（day2）', 'radio', '["上午","中午"]'::jsonb, false, -98),
  ('00000000-0000-0000-0000-0000000000e2', 'slot_down_' || to_char(CURRENT_DATE + 6, 'YYYY-MM-DD'), '回程時段（day2）', 'radio', '["中午","下午"]'::jsonb, false, -97),
  ('00000000-0000-0000-0000-0000000000e2', 'is_lodging', '是否掛單（中間留宿）', 'boolean', '[]'::jsonb, true, -1);

-- 兩筆報名：g-c1 只填 day1（去程上午+回程下午，當天來回，不該被要求填 is_lodging）；
-- g-c2 填兩天不同時段＋掛單（is_lodging=true）
INSERT INTO registrations (registration_id, event_id, student_id, is_driver, answers) VALUES
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', 'TESTSTU001', false,
    jsonb_build_object(
      'slot_up_'   || to_char(CURRENT_DATE + 5, 'YYYY-MM-DD'), '上午',
      'slot_down_' || to_char(CURRENT_DATE + 5, 'YYYY-MM-DD'), '下午'
    )),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2', 'TESTSTU002', false,
    jsonb_build_object(
      'slot_up_'   || to_char(CURRENT_DATE + 5, 'YYYY-MM-DD'), '上午',
      'slot_down_' || to_char(CURRENT_DATE + 6, 'YYYY-MM-DD'), '下午',
      'is_lodging', true
    ));

-- 一台車示範 time_slot 欄位：day1 去程・上午
INSERT INTO car_assignments (car_id, event_id, car_name, seats, car_type, direction, service_date, time_slot, access_token) VALUES
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e2', '測試車5號（分時段 day1 去程上午）', 20, 'large', 'up', CURRENT_DATE + 5, '上午', 'TEST_CAR_TOKEN_SLOT_D1_UP_AM');
INSERT INTO car_members (car_id, registration_id) VALUES
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e3');

COMMIT;

-- 驗收：三個查詢都應該有資料回來
SELECT car_id, car_name, access_token FROM car_assignments WHERE car_id IN
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
SELECT chore_id, access_token FROM chores WHERE chore_id = '00000000-0000-0000-0000-0000000000a9';
SELECT registration_id, student_id, is_driver FROM registrations WHERE event_id = '00000000-0000-0000-0000-0000000000a1';
SELECT field_key, field_label, options FROM event_fields WHERE event_id = '00000000-0000-0000-0000-0000000000e2' ORDER BY sort_order;
SELECT car_id, car_name, service_date, time_slot FROM car_assignments WHERE car_id = '00000000-0000-0000-0000-0000000000e5';
