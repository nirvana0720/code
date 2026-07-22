-- 回山活動功德主通知：當天資訊管理欄位
-- 1. events.has_donor_notify：獨立開關，控制「功德主通知」功能是否開放（任何 event_type 皆可用）
--    跟既有 is_dharma（精舍法會報到用途）互不影響，刻意分開。
-- 2. event_donors.lunch_table / is_table_leader：活動當天午齋桌次與桌長標記。
--    「合影波次」不新增欄位，沿用既有 event_donor_fields 自訂欄位機制（field_key: photo_wave）。

ALTER TABLE events        ADD COLUMN IF NOT EXISTS has_donor_notify BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE event_donors  ADD COLUMN IF NOT EXISTS lunch_table       TEXT;
ALTER TABLE event_donors  ADD COLUMN IF NOT EXISTS is_table_leader   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.has_donor_notify        IS '是否開放功德主通知功能（回山等外出活動用；與 is_dharma 精舍法會報到用途互不影響）';
COMMENT ON COLUMN event_donors.lunch_table       IS '活動當天午齋桌次（當天資訊管理頁填寫）';
COMMENT ON COLUMN event_donors.is_table_leader   IS '是否為該桌桌長（發送當天通知時，桌長會額外收到一則全桌名單訊息）';
