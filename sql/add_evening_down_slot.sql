-- 職責：分時段回程加「晚上」選項（events.up_slot_options／down_slot_options 後台勾選新增
-- 可選值，前端限定只有回程 down_slot_options 會出現「晚上」，去程 up_slot_options 不會）。
-- 放寬 car_assignments.time_slot 的 CHECK 限制，讓「晚上」可以存入。可安全重跑。

ALTER TABLE car_assignments DROP CONSTRAINT IF EXISTS car_assignments_time_slot_check;
ALTER TABLE car_assignments
  ADD CONSTRAINT car_assignments_time_slot_check
  CHECK (time_slot IS NULL OR time_slot IN ('上午','中午','下午','晚上'));
