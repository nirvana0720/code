-- ============================================================
-- chores 表新增 temple（精舍）／chore_date（日期）欄位
-- 日期：2026-07-16
-- 背景：
--   匯入坡務表時，Excel 裡的「精舍」（善高、普宜等分院名稱）與「日期」
--   欄位原本只在匯入預覽畫面顯示（parseChoreExcel 有解析出來），
--   但 importChores 寫入時沒有存進 chores 表，做「匯出總表」功能
--   需要用到這兩欄，所以補上。
--
--   已匯入過坡務表的活動（例如星燈營），這兩欄會是 NULL。
--   ⚠️ 注意：importChores 是直接 INSERT、不是 upsert，對已排過坡的
--   活動「重新匯入」同一份 Excel 會產生整批重複的 chores 列
--   （原本的排坡結果不會不見，但畫面會多一份沒人的空坡務、
--   總表也會統計重複），所以**不建議用重新匯入來補這兩欄**。
--   已排過坡的舊活動如果需要補「精舍／日期」，用 UPDATE 依
--   （event_id, session, sort_order 或 unit+work_content+location）
--   比對後更新，不要用重新匯入；需要的話請提供原始 Excel 再另外處理。
--   新活動之後走「匯入坡務表」就會自動帶入這兩欄，不受影響。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

ALTER TABLE chores ADD COLUMN IF NOT EXISTS temple TEXT;
ALTER TABLE chores ADD COLUMN IF NOT EXISTS chore_date TEXT;
