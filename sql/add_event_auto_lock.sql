-- ============================================================
-- add_event_auto_lock.sql（2026-11-15，自動停止異動）
-- 職責：events 加 auto_lock_at，並排 pg_cron 工作每 5 分鐘呼叫 auto_lock_events()。
-- ⚠️ 執行順序：先跑 rpc_events.sql（建立 auto_lock_events 函式），再跑本檔。
-- 可重複執行：ADD COLUMN IF NOT EXISTS；排程先 unschedule 同名工作再 schedule。
-- pg_cron：正式環境已啟用；全新環境在 full_setup_all_in_one.sql [47/81] 已
--   CREATE EXTENSION IF NOT EXISTS pg_cron，本檔不重複。
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS auto_lock_at TIMESTAMPTZ;
COMMENT ON COLUMN events.auto_lock_at IS '自動停止異動時間（NULL=不自動鎖定）；到時間由 pg_cron 工作 auto_lock_events 設 locked=true 並清空本欄';

DO $$
BEGIN
  PERFORM cron.unschedule('auto_lock_events');
EXCEPTION WHEN OTHERS THEN
  -- 第一次跑、還沒有這個工作會跳例外，直接略過
  NULL;
END $$;

SELECT cron.schedule(
  'auto_lock_events',
  '*/5 * * * *',  -- 每 5 分鐘（與時區無關）
  $$SELECT auto_lock_events();$$
);
