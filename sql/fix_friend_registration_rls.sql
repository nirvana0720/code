-- ============================================================
-- 修正代報親友報名 RLS 錯誤
-- 日期：2026-06-26
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/07 健檢移除 registrations 的開放 anon SELECT 政策後，
--   學員本人報名已改用 RPC kiosk_submit_registration（6/11 修復）。
--   但「代報親友」(submitFriendRegistration) 仍用 .insert().select()，
--   insert 後 PostgREST 會自動 SELECT 回讀剛寫入的列做確認，
--   anon 沒有 SELECT 權限 → 回讀被擋 → 報成
--   "new row violates row-level security policy for table 'registrations'"
--   （與本人報名 6/11 的根因相同，只是發生在代報親友這條路徑）
--
--   修法：新增 SECURITY DEFINER RPC kiosk_submit_friend_registration，
--   以表格擁有者身份執行 insert，不受 RLS 限制，直接回傳 registration_id。
--   前端 submitFriendRegistration 改呼叫此 RPC。
-- ============================================================

CREATE OR REPLACE FUNCTION kiosk_submit_friend_registration(
  p_event_id        UUID,
  p_host_student_id TEXT,
  p_answers         JSONB,
  p_terminal        TEXT DEFAULT 'tablet-01',
  p_is_driver       BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id UUID;
BEGIN
  INSERT INTO registrations (event_id, student_id, host_student_id, answers, terminal, is_driver)
  VALUES (p_event_id, NULL, p_host_student_id, p_answers, p_terminal, p_is_driver)
  RETURNING registration_id INTO v_reg_id;

  RETURN json_build_object('success', true, 'registration_id', v_reg_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- anon（學員平板）和 authenticated（後台手動代報）都能呼叫
GRANT EXECUTE ON FUNCTION kiosk_submit_friend_registration(UUID, TEXT, JSONB, TEXT, BOOLEAN) TO anon, authenticated;

-- ── 驗證（執行後可跑這行確認）──────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'kiosk_submit_friend_registration';
-- 預期：1 筆
