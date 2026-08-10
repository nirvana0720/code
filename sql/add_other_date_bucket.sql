-- 職責：多日回山排車「其他日期」分頁（提前掛單回山／延後回家的少數人，不受活動官方
-- 日期範圍限制）＋ 分時段彈性選項（去程/回程時段清單改後台可勾選，取代寫死）＋
-- 跨分頁手動 override（registration_bucket_overrides）。只套用到之後新建/使用此功能的
-- 活動，不回填任何舊資料。可安全重跑：ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS。

-- ── events.up_slot_options / down_slot_options：分時段彈性選項 ──
-- NULL 代表沿用舊的寫死行為（去程['上午','中午']、回程['中午','下午']）
ALTER TABLE events ADD COLUMN IF NOT EXISTS up_slot_options   TEXT[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS down_slot_options TEXT[];
COMMENT ON COLUMN events.up_slot_options   IS '去程分時段選項（後台可勾選），NULL=沿用舊預設 [上午,中午]';
COMMENT ON COLUMN events.down_slot_options IS '回程分時段選項（後台可勾選），NULL=沿用舊預設 [中午,下午]';

-- ── car_assignments.is_other_date：「其他日期」分頁的車輛標記 ──
-- 這批車 service_date 維持 NULL，鎖定判斷沿用既有 rpc_car.sql「service_date IS NULL 時
-- fallback 回 event.date_end」邏輯，這支檔案不用改
ALTER TABLE car_assignments ADD COLUMN IF NOT EXISTS is_other_date BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN car_assignments.is_other_date IS '是否為「其他日期」分頁的車輛（提前/延後回山的少數人，不分時段、不分大小車），service_date 固定 NULL';

-- ── registration_bucket_overrides：跨分頁手動 override（比照 car_small_overrides 的模式，但一人可以去程/回程各一筆） ──
CREATE TABLE IF NOT EXISTS registration_bucket_overrides (
  registration_id   UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK (direction IN ('up','down')),
  target_bucket     TEXT NOT NULL,  -- 'other' 或日期字串 'YYYY-MM-DD'
  source_stay_start DATE,
  source_stay_end   DATE,
  source_transport  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (registration_id, direction)
);
COMMENT ON TABLE registration_bucket_overrides IS '師父手動把某人在某方向指定歸進哪個分頁（其他日期或某個正常日期），覆蓋系統自動判斷結果；source_* 存建立當下的快照，用來偵測答案異動（isStale）';

ALTER TABLE registration_bucket_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth full access on registration_bucket_overrides" ON registration_bucket_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON registration_bucket_overrides TO authenticated;
