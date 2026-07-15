-- 2026-07-13 排坡系統追加：出坡時間／報到時間（上午/下午各一組），存在活動層級
-- 這兩個資訊在山上坡務表 Excel 最上面的說明區塊（例如「出坡時間 上午 08:45~11:30」「報到時間 上午 08:30」），
-- 之前匯入解析時被當成不重要的標題文字略過了，現在要抓出來存、並顯示給領隊/小組長看。
-- 純文字存原始顯示格式即可，不需要轉成真正的時間型別。

ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_am_work_time    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_am_checkin_time TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_pm_work_time    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_pm_checkin_time TEXT;

COMMENT ON COLUMN events.chore_am_work_time    IS '福慧出坡：上午出坡時間，原始文字，例如 08:45~11:30';
COMMENT ON COLUMN events.chore_am_checkin_time IS '福慧出坡：上午報到時間，原始文字，例如 08:30';
COMMENT ON COLUMN events.chore_pm_work_time    IS '福慧出坡：下午出坡時間';
COMMENT ON COLUMN events.chore_pm_checkin_time IS '福慧出坡：下午報到時間';
