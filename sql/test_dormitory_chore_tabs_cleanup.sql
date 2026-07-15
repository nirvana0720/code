-- ============================================================
-- 清除 test_dormitory_chore_tabs.sql 建立的測試資料
-- 用法：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

DELETE FROM events WHERE name = '測試_寮區坡務頁籤活動';
-- events 刪除會 CASCADE 帶走 registrations / car_assignments / car_members /
-- car_leaders / chores / chore_members

DELETE FROM student_classes WHERE student_id IN ('900001','900002','900003','900004','900005','900006');
DELETE FROM students WHERE student_id IN ('900001','900002','900003','900004','900005','900006');
