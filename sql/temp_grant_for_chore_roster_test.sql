-- ============================================================
-- 暫時開放 service_role 寫入權限，供「匯出總表」功能假資料測試用
-- 日期：2026-07-16
-- 測試完成後，請執行本檔最下方的 REVOKE 區塊收回權限。
-- ============================================================

GRANT INSERT, DELETE ON TABLE events, students, registrations, car_assignments, car_members, chores, chore_members TO service_role;

-- ============================================================
-- 測試完成後，把上面這行的 GRANT 換成執行下面這行 REVOKE：
-- REVOKE INSERT, DELETE ON TABLE events, students, registrations, car_assignments, car_members, chores, chore_members FROM service_role;
-- ============================================================
