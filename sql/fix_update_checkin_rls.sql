-- ============================================================
-- 修正 updateRegistration + checkInOtherTransport RLS 錯誤
-- 日期：2026-07-07
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/05 健檢移除 registrations 的 anon UPDATE 政策後，
--   以下兩個前台功能靜默失敗：
--   1. KioskPage 「修改報名」— updateRegistration 直接 .update()
--   2. CarCheckinPage 「其他交通報到」— checkInOtherTransport 直接 .update()
--
-- 修法：各建一個 SECURITY DEFINER RPC，以表格擁有者身份執行 UPDATE。
-- ============================================================


-- ── RPC 1：前台修改報名答案 ──────────────────────────────────

CREATE OR REPLACE FUNCTION kiosk_update_registration(
  p_registration_id UUID,
  p_answers         JSONB,
  p_is_driver       BOOLEAN DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_is_driver IS NOT NULL THEN
    UPDATE registrations
    SET answers   = p_answers,
        is_driver = p_is_driver
    WHERE registration_id = p_registration_id;
  ELSE
    UPDATE registrations
    SET answers = p_answers
    WHERE registration_id = p_registration_id;
  END IF;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'registration not found');
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_update_registration(UUID, JSONB, BOOLEAN) TO anon, authenticated;


-- ── RPC 2：其他交通報到 / 取消報到（CarCheckinPage 用）────────

CREATE OR REPLACE FUNCTION kiosk_checkin_other_transport(
  p_registration_id UUID,
  p_direction       TEXT,     -- 'up' | 'down'
  p_check_in        BOOLEAN   -- true = 報到, false = 取消
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field TEXT;
  v_value TIMESTAMPTZ;
BEGIN
  -- 方向對應欄位
  v_field := CASE p_direction
    WHEN 'down' THEN 'checked_in_down_at'
    ELSE             'checked_in_at'
  END;

  v_value := CASE p_check_in
    WHEN true THEN NOW()
    ELSE           NULL
  END;

  -- 動態欄位名稱用 EXECUTE
  EXECUTE format(
    'UPDATE registrations SET %I = $1 WHERE registration_id = $2',
    v_field
  ) USING v_value, p_registration_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'registration not found');
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_checkin_other_transport(UUID, TEXT, BOOLEAN) TO anon, authenticated;


-- ── 驗證 ──────────────────────────────────────────────────
-- SELECT proname FROM pg_proc
-- WHERE proname IN ('kiosk_update_registration', 'kiosk_checkin_other_transport');
-- 預期：2 筆
