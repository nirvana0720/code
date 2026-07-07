-- ============================================================
-- 修正前台取消報名 RLS 錯誤
-- 日期：2026-07-07
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/05 健檢移除 registrations 的 anon DELETE 政策後，
--   前台學員「取消報名」走直接 .delete() → anon 沒有 DELETE 權限 →
--   靜默失敗（無錯誤提示）→ DB 未刪除 → 重整後仍顯示「已報名」
--
-- 修法：
--   建立 SECURITY DEFINER RPC kiosk_cancel_registration，
--   以表格擁有者身份執行 DELETE，不受 RLS 限制。
--   前端改呼叫此 RPC 取代直接 .delete()。
-- ============================================================

CREATE OR REPLACE FUNCTION kiosk_cancel_registration(
  p_registration_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM registrations
  WHERE registration_id = p_registration_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'registration not found');
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- anon（前台學員平板）和 authenticated（後台師父）都可呼叫
GRANT EXECUTE ON FUNCTION kiosk_cancel_registration(UUID) TO anon, authenticated;

-- ── 驗證 ──────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'kiosk_cancel_registration';
-- 預期：1 筆
