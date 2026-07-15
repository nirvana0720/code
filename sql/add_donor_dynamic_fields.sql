-- 功德主管理改動態欄位
-- 1. 新表 event_donor_fields：每個活動自訂功德主欄位（顯示名稱 + 順序）
-- 2. event_donors 新增 answers jsonb（不刪除舊的 5 個具名欄位，當安全網）
-- 3. Backfill：既有活動補建 5 個預設欄位，並把舊欄位值搬進 answers
--
-- RLS/GRANT：只開放 authenticated（比照 2026-06-05 event_donors 安全修正後的實際狀態——
-- donor 相關頁面全部在 ProtectedRoute 後面，沒有 anon 頁面需要存取功德主資料）

-- ════════════════════════════════════════════════════════════
-- 1. event_donor_fields
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_donor_fields (
  field_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key    TEXT        NOT NULL,
  field_label  TEXT        NOT NULL,
  field_order  INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_event_donor_fields_event ON event_donor_fields(event_id);

CREATE OR REPLACE FUNCTION touch_event_donor_fields_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_donor_fields_touch ON event_donor_fields;
CREATE TRIGGER trg_event_donor_fields_touch
  BEFORE UPDATE ON event_donor_fields
  FOR EACH ROW EXECUTE FUNCTION touch_event_donor_fields_updated_at();

ALTER TABLE event_donor_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access on event_donor_fields" ON event_donor_fields;
CREATE POLICY "authenticated full access on event_donor_fields"
  ON event_donor_fields FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON event_donor_fields TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. event_donors 新增 answers
-- ════════════════════════════════════════════════════════════

ALTER TABLE event_donors ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ════════════════════════════════════════════════════════════
-- 3. Backfill（一次性）
-- ════════════════════════════════════════════════════════════

-- 3.1 對現有功德主資料涉及的活動，若還沒有 event_donor_fields，補建 5 個預設欄位
INSERT INTO event_donor_fields (event_id, field_key, field_label, field_order)
SELECT ev.event_id, f.field_key, f.field_label, f.field_order
FROM (SELECT DISTINCT event_id FROM event_donors) ev
CROSS JOIN (VALUES
  ('donor_item', '功德項目', 0),
  ('seat',       '座位',     1),
  ('corsage',    '胸花',     2),
  ('offering',   '供具',     3),
  ('donor_note', '備註',     4)
) AS f(field_key, field_label, field_order)
WHERE NOT EXISTS (
  SELECT 1 FROM event_donor_fields existing WHERE existing.event_id = ev.event_id
);

-- 3.2 把每筆舊欄位值搬進 answers
UPDATE event_donors
SET answers = jsonb_strip_nulls(jsonb_build_object(
  'donor_item', donor_item,
  'seat',       seat,
  'corsage',    corsage,
  'offering',   offering,
  'donor_note', donor_note
));
