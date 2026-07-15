-- 2026-07-13 排坡系統：負責法師電話拆出獨立欄位（原本跟姓名混在同一段文字裡，沒辦法做撥打連結）
ALTER TABLE chores ADD COLUMN IF NOT EXISTS supervising_monk_phone TEXT;
