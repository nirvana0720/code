-- ══════════════════════════════════════════════
-- 取消報名功能 — 補 DELETE 權限
-- 在 Supabase Dashboard → SQL Editor 執行一次即可
-- ══════════════════════════════════════════════

-- 允許登入的師父（authenticated）刪除報名紀錄
GRANT DELETE ON registrations TO authenticated;
