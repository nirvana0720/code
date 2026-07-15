-- ============================================================
-- 修復：總領隊看板／小車領隊看板點「報到」會失敗的連帶問題
-- 日期：2026-07-15
-- 背景：
--   接續 add_all_cars_progress_by_token_rpc.sql 修復「看得到資料」的問題後，
--   發現總領隊/小車領隊看板點選報到時會呼叫 checkin_car_member / checkin_all_car /
--   checkin_car_monk，這三支 RPC 的驗證邏輯是「p_token 必須等於該台車自己的
--   car_assignments.access_token」——但總領隊/小車領隊看板頁面用的是「看板自己
--   的 head_leader.access_token」，不是被點的那台車的 token，兩者本來就不會相等。
--   這代表這三支 RPC 從 fix_car_token_security.sql（2026-06-07）改成 token 驗證
--   以來，總領隊/小車領隊看板的報到動作其實一直會失敗（只是先前看板本身也是
--   空的，沒人有機會點到）。
--
--   修法：驗證邏輯放寬為「p_token 是該車自己的 token，或是同一活動底下、且
--   權限範圍涵蓋該車的 head_leader token（小車領隊只認得 car_type='small'）」，
--   兩種 token 都放行，維持向下相容（單台車領隊頁面的行為不變）。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE OR REPLACE FUNCTION checkin_car_member(
  p_token TEXT,
  p_car_id UUID,
  p_registration_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT event_id, car_type INTO v_event_id, v_car_type
  FROM car_assignments WHERE car_id = p_car_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_id %', p_car_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = p_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM events e WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE car_id = p_car_id AND registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_member(TEXT, UUID, UUID, BOOLEAN) TO anon, authenticated;


CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT event_id, car_type INTO v_event_id, v_car_type
  FROM car_assignments WHERE car_id = p_car_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_id %', p_car_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = p_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM events e WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = NOW()
  WHERE car_id = p_car_id AND checked_in_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_all_car(TEXT, UUID) TO anon, authenticated;


CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_car_id   UUID;
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT ck.car_id, ca.event_id, ca.car_type INTO v_car_id, v_event_id, v_car_type
  FROM car_monks ck
  JOIN car_assignments ca ON ca.car_id = ck.car_id
  WHERE ck.id = p_car_monk_id;

  IF v_car_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_monk_id %', p_car_monk_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = v_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM events e WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;
