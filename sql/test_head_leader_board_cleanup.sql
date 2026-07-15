-- ============================================================
-- 清除 test_head_leader_board.sql 建立的測試資料
-- 用法：貼到 Supabase Dashboard → SQL Editor → Run
-- （大車/報名/坡務等資料由 test_dormitory_chore_tabs_cleanup.sql 一併清除）
-- ============================================================

DELETE FROM head_leader WHERE access_token IN ('test-head-dormchore-900001', 'test-smallcar-dormchore-900001');
DELETE FROM car_assignments WHERE access_token = 'test-smallcar-only-900001';
