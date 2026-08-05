-- 職責：多日回山排車（events.multi_day_transport／car_assignments.service_date）
-- ＋ 大車手動移到小車的持久化（car_small_overrides，取代原本只存在前端 state 的
-- guestSmallOverrides）。只套用到「之後新建的活動」，不回填任何舊資料。
-- 可安全重跑：ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS。

-- ── events.multi_day_transport：多日交通安排開關 ──
ALTER TABLE events ADD COLUMN IF NOT EXISTS multi_day_transport BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN events.multi_day_transport IS '多日交通安排：開啟後報名表單出現參加日期/是否掛單欄位，排車頁出現日期籤';

-- ── car_assignments.service_date：這台車服務的日期 ──
ALTER TABLE car_assignments ADD COLUMN IF NOT EXISTS service_date DATE;
COMMENT ON COLUMN car_assignments.service_date IS '這台車服務的日期，NULL=單日活動（沿用舊行為）';
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_date_dir ON car_assignments(event_id, service_date, direction);

-- ── car_small_overrides：師父手動把大車的人移到某台小車（取代前端 guestSmallOverrides） ──
CREATE TABLE IF NOT EXISTS car_small_overrides (
  registration_id      UUID PRIMARY KEY REFERENCES registrations(registration_id) ON DELETE CASCADE,
  direction             TEXT NOT NULL CHECK (direction IN ('up','down')),
  service_date          DATE,
  target_driver_reg_id  UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE car_small_overrides IS '師父手動把大車的人移到某台小車（用司機的 registration_id 識別那台小車），取代原本只存在前端 state 的 guestSmallOverrides';
CREATE INDEX IF NOT EXISTS idx_car_small_overrides_target ON car_small_overrides(target_driver_reg_id);

ALTER TABLE car_small_overrides ENABLE ROW LEVEL SECURITY;

-- 比照 car_members／car_assignments 現有政策設計同一組角色，但這支表只有後台排車頁會讀寫
-- （公開 token 看板一律走 SECURITY DEFINER 的 RPC，不直接讀這張表），所以不開放 anon。
CREATE POLICY "auth full access on car_small_overrides" ON car_small_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON car_small_overrides TO authenticated;
