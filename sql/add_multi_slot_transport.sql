-- 職責：多日回山活動「分時段」（events.multi_slot_transport，巢狀在
-- multi_day_transport 底下，預設 false）。開啟後報名表單改成依每一天生成
-- 「去程時段」「回程時段」兩題 radio（上午/中午/下午），排車頁多一層時段分組
-- （car_assignments.time_slot）。與 attend_dates 模式互斥，只套用到之後
-- 新建的活動，不回填任何舊資料。
-- 可安全重跑：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS。

ALTER TABLE events ADD COLUMN IF NOT EXISTS multi_slot_transport BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN events.multi_slot_transport IS '多日交通安排底下的分時段子選項：開啟後報名表單改用每日去程/回程時段題（slot_up_YYYY-MM-DD／slot_down_YYYY-MM-DD），取代 attend_dates；排車頁多一層時段分組';

ALTER TABLE car_assignments ADD COLUMN IF NOT EXISTS time_slot TEXT
  CHECK (time_slot IS NULL OR time_slot IN ('上午','中午','下午'));
COMMENT ON COLUMN car_assignments.time_slot IS '這台車服務的時段（僅分時段活動使用），NULL=非分時段活動（沿用舊行為）';

CREATE INDEX IF NOT EXISTS idx_car_assignments_event_date_dir_slot
  ON car_assignments(event_id, service_date, direction, time_slot);
