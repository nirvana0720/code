-- ============================================================
-- add_mountain_approval.sql（2026-11-14，山上審核功能）
-- 職責：只新增欄位（不加觸發器、不加新表、不改權限），可重複執行。
--   events.needs_mountain_approval  需山上審核開關（預設 false，對既有活動零影響）
--   events.approval_rejected_text   未核准時學員頁顯示文字（空值＝前端預設「歡迎報名下次禪七」）
--   registrations.approval_status   registered / ctis_registered / approved / rejected（預設 registered）
--   registrations.approval_updated_at／approval_updated_by  最後一次改審核狀態的時間／帳號 email
-- 防呆只做在畫面（見 docs/山上審核_技術規格.md 第二節），資料庫不另設守門員。
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS needs_mountain_approval BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS approval_rejected_text TEXT;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approval_updated_at TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS approval_updated_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'registrations'::regclass
      AND conname = 'registrations_approval_status_check'
  ) THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_approval_status_check
      CHECK (approval_status IN ('registered', 'ctis_registered', 'approved', 'rejected'));
  END IF;
END $$;

COMMENT ON COLUMN events.needs_mountain_approval IS '此活動是否需要山上審核（開啟後非核准者刷卡會被畫面擋下）';
COMMENT ON COLUMN events.approval_rejected_text IS '未核准時學員頁顯示文字；NULL/空字串時前端用預設「歡迎報名下次禪七」';
COMMENT ON COLUMN registrations.approval_status IS '山上審核狀態：registered=已報名、ctis_registered=CTIS已報名、approved=核准、rejected=未核准';
COMMENT ON COLUMN registrations.approval_updated_at IS '最後一次修改審核狀態的時間';
COMMENT ON COLUMN registrations.approval_updated_by IS '最後一次修改審核狀態的後台帳號 email';
