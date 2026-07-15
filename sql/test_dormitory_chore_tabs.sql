-- ============================================================
-- 測試資料：領隊報到頁「寮區」「坡務」頁籤驗證用（900000 開頭學員 ID）
-- 用途：建立一台大車＋7 位成員，涵蓋不同寮房分組、不同坡務時段分組、
--       未分配寮房、未排入坡務等邊界情況，供驗證分組/排序/人數統計。
-- 用法：貼到 Supabase Dashboard → SQL Editor → Run
-- 測完請改執行 sql/test_dormitory_chore_tabs_cleanup.sql 清除
-- access_token 固定為 'test-car-dormchore-900001'，測試網址：
--   /car-checkin/test-car-dormchore-900001
-- ============================================================

DO $$
DECLARE
  v_event_id UUID;
  v_car_id   UUID;
  v_reg1 UUID; v_reg2 UUID; v_reg3 UUID; v_reg4 UUID; v_reg5 UUID; v_reg6 UUID; v_reg_guest UUID;
  v_chore_am_a UUID; v_chore_am_b UUID; v_chore_pm_c UUID;
BEGIN
  -- 學員 + 班級（決定男女）
  INSERT INTO students (student_id, qr_code, name, active) VALUES
    ('900001', '900001', '王小明', true),
    ('900002', '900002', '陳小華', true),
    ('900003', '900003', '林小強', true),
    ('900004', '900004', '張小美', true),
    ('900005', '900005', '李小龍', true),
    ('900006', '900006', '吳小芬', true)
  ON CONFLICT (student_id) DO NOTHING;

  INSERT INTO student_classes (student_id, class_name, group_name) VALUES
    ('900001', '初級日間', '男眾第一組'),
    ('900002', '初級日間', '女眾第一組'),
    ('900003', '初級日間', '男眾第二組'),
    ('900004', '初級日間', '女眾第二組'),
    ('900005', '中級日間', '男眾第一組'),
    ('900006', '中級日間', '女眾第一組');

  -- 活動：開安單 + 開福慧出坡
  INSERT INTO events (name, date_start, date_end, event_type, status, is_chore_event, show_dormitory_to_public)
  VALUES ('測試_寮區坡務頁籤活動', CURRENT_DATE, CURRENT_DATE, 'mountain', 'active', true, true)
  RETURNING event_id INTO v_event_id;

  -- 報名（7 筆：6 位學員 + 1 訪客）
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, '900001', '{}'::jsonb, '普賢寮 B1 04-1') RETURNING registration_id INTO v_reg1;
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, '900002', '{}'::jsonb, '普賢寮 B1 04-1') RETURNING registration_id INTO v_reg2;
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, '900003', '{}'::jsonb, '普賢寮 B1 04-1') RETURNING registration_id INTO v_reg3;
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, '900004', '{}'::jsonb, '普賢寮 B2 05-2') RETURNING registration_id INTO v_reg4;
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, '900005', '{}'::jsonb, '普賢寮 B2 05-2') RETURNING registration_id INTO v_reg5;
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, '900006', '{}'::jsonb, NULL) RETURNING registration_id INTO v_reg6;
  INSERT INTO registrations (event_id, student_id, answers, dormitory_room) VALUES
    (v_event_id, NULL, '{"guest_name":"測試訪客陳先生"}'::jsonb, NULL) RETURNING registration_id INTO v_reg_guest;

  -- 大車（上山），固定 access_token 方便直接開連結測試
  INSERT INTO car_assignments (event_id, car_name, car_type, direction, access_token)
  VALUES (v_event_id, '測試1號車', 'large', 'up', 'test-car-dormchore-900001')
  RETURNING car_id INTO v_car_id;

  INSERT INTO car_members (car_id, registration_id) VALUES
    (v_car_id, v_reg1), (v_car_id, v_reg2), (v_car_id, v_reg3),
    (v_car_id, v_reg4), (v_car_id, v_reg5), (v_car_id, v_reg6), (v_car_id, v_reg_guest);

  INSERT INTO car_leaders (car_id, registration_id) VALUES (v_car_id, v_reg1);

  -- 坡務：上午 A、上午 B、下午 C
  INSERT INTO chores (event_id, session, unit, work_content, location, sort_order) VALUES
    (v_event_id, '上午', '客寮管理', '掃寮', '大寮', 1) RETURNING chore_id INTO v_chore_am_a;
  INSERT INTO chores (event_id, session, unit, work_content, location, sort_order) VALUES
    (v_event_id, '上午', '女環', '打掃架房', '女環架房', 2) RETURNING chore_id INTO v_chore_am_b;
  INSERT INTO chores (event_id, session, unit, work_content, location, sort_order) VALUES
    (v_event_id, '下午', '男環', '搬運物資', '男環倉庫', 1) RETURNING chore_id INTO v_chore_pm_c;

  -- 坡務成員：reg1/reg2 上午A；reg3 上午B；reg4 下午C；reg5 上午A+下午C（跨兩時段）；reg6/guest 未排入坡務
  INSERT INTO chore_members (chore_id, registration_id) VALUES
    (v_chore_am_a, v_reg1), (v_chore_am_a, v_reg2), (v_chore_am_a, v_reg5),
    (v_chore_am_b, v_reg3),
    (v_chore_pm_c, v_reg4), (v_chore_pm_c, v_reg5);

  RAISE NOTICE '測試資料建立完成，event_id=%, car access_token=test-car-dormchore-900001', v_event_id;
END $$;
