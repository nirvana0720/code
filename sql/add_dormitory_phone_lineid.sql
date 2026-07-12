-- 2026-07-12 四大新功能 DB migration
-- 功能1 安單寮號 + 功能3 LINE 綁定 + 功能4 學員電話
-- 在 Supabase SQL Editor 直接執行

-- 1. registrations 加寮號欄位（功能1：安單寮號匯入）
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS dormitory_room TEXT;

-- 2. students 加電話與 LINE ID 欄位（功能4：學員電話 / 功能3：LINE 綁定）
ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- 註：stay_overnight 欄位已存在，不需新增
