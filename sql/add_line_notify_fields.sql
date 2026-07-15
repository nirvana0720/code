-- 2026-07-13 功能3：LINE 綁定與推播（車次通知）
-- students.line_user_id 已在 add_dormitory_phone_lineid.sql 建過，不再重複

-- 活動層級的「預設配合事項」範本（純文字，發車次通知時預帶入每台車）
ALTER TABLE events ADD COLUMN IF NOT EXISTS default_notice_text TEXT;

-- 每台車可個別覆寫配合事項文字；NULL 表示沿用 events.default_notice_text
ALTER TABLE car_assignments ADD COLUMN IF NOT EXISTS notice_text TEXT;
