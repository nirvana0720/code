-- ============================================================
-- 測試資料：總領隊看板／小車領隊看板 RPC 驗證用
-- 前提：sql/test_dormitory_chore_tabs.sql 已執行（沿用同一個測試活動與大車）
-- 用途：加一台小車＋兩個 head_leader token（總領隊 / 小車領隊），
--       驗證 get_all_cars_progress_by_token 對 anon 能正常回傳資料，
--       以及報到動作（checkin_car_member 等）改用看板 token 也能成功。
-- 用法：貼到 Supabase Dashboard → SQL Editor → Run
-- 測完請執行 sql/test_head_leader_board_cleanup.sql 清除
-- 總領隊測試網址：  /car-checkin/test-head-dormchore-900001
-- 小車領隊測試網址：/car-checkin/test-smallcar-dormchore-900001
-- ============================================================

DO $$
DECLARE
  v_event_id UUID;
  v_small_car_id UUID;
  v_reg6 UUID;
BEGIN
  SELECT event_id INTO v_event_id
  FROM events WHERE name = '測試_寮區坡務頁籤活動' LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION '找不到測試活動，請先執行 sql/test_dormitory_chore_tabs.sql';
  END IF;

  SELECT registration_id INTO v_reg6
  FROM registrations WHERE event_id = v_event_id AND student_id = '900006' LIMIT 1;

  -- 加一台小車（上山），供總領隊/小車領隊看板顯示「大車＋小車」兩區塊
  INSERT INTO car_assignments (event_id, car_name, car_type, direction, access_token)
  VALUES (v_event_id, '測試小車A', 'small', 'up', 'test-smallcar-only-900001')
  RETURNING car_id INTO v_small_car_id;

  INSERT INTO car_members (car_id, registration_id) VALUES (v_small_car_id, v_reg6);

  -- 總領隊 token
  INSERT INTO head_leader (event_id, type, access_token)
  VALUES (v_event_id, 'all', 'test-head-dormchore-900001');

  -- 小車領隊 token
  INSERT INTO head_leader (event_id, type, access_token)
  VALUES (v_event_id, 'small_car', 'test-smallcar-dormchore-900001');

  RAISE NOTICE '測試資料建立完成，event_id=%', v_event_id;
END $$;
