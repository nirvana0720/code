-- ============================================================
-- Kiosk 學員自助報名寫入 RPC
-- 建立日期：2026-06-11（原本只在 Supabase SQL Editor 建立，沒有存成檔案）
-- 補存日期：2026-07-18，用 SELECT pg_get_functiondef('kiosk_submit_registration'::regproc)
--           從普宜精舍正式 Supabase 取回，內容與正式環境一致
-- 用途：Kiosk 學員刷卡報名時呼叫，取代原本 anon 直接 .upsert() registrations
--       （anon 沒有 SELECT 權限，upsert 後 PostgREST 自動回讀會被擋，誤報 RLS 錯誤）
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE OR REPLACE FUNCTION public.kiosk_submit_registration(
  p_event_id uuid,
  p_student_id text,
  p_answers jsonb,
  p_terminal text DEFAULT 'tablet-01'::text,
  p_is_driver boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg_id UUID;
BEGIN
  INSERT INTO registrations (event_id, student_id, answers, terminal, is_driver)
  VALUES (p_event_id, p_student_id, p_answers, p_terminal, p_is_driver)
  ON CONFLICT (event_id, student_id) DO UPDATE SET
    answers     = EXCLUDED.answers,
    terminal    = EXCLUDED.terminal,
    is_driver   = EXCLUDED.is_driver,
    updated_at  = now()
  RETURNING registration_id INTO v_reg_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 確認 anon／authenticated 可執行（正式環境目前是靠 PUBLIC 預設 EXECUTE 權限涵蓋，
-- 這裡明確寫出來，避免新環境的預設權限跟正式環境不一樣導致漏掉）
GRANT EXECUTE ON FUNCTION public.kiosk_submit_registration(uuid, text, jsonb, text, boolean) TO anon, authenticated;

-- ============================================================
-- 驗證查詢（執行後可跑這行確認 grant 沒問題）
-- ============================================================
/*
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'kiosk_submit_registration';
-- 預期至少看到 anon / authenticated 兩筆 EXECUTE
*/
