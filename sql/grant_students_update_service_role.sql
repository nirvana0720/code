-- 2026-07-13 修復：line-webhook Edge Function 用 service_role 寫入 students.line_user_id 時
-- 出現 42501 permission denied，因為 students 表之前只 GRANT 過 SELECT 給 service_role
-- （山上來信備份系統當初的設定），沒有開放 UPDATE。

GRANT UPDATE ON TABLE students TO service_role;

-- send-car-notification Edge Function 需要讀 car_members 才能查出每台車的學員名單
-- （registrations / students 的 SELECT 之前山上來信系統已經 GRANT 過，car_members 這次才第一次用到）
GRANT SELECT ON TABLE car_members TO service_role;
