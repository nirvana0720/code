-- ============================================================
-- 鎖住已結束活動的公開 token 頁面
-- 日期：2026-07-14
-- 背景：
--   領隊報到頁（/car-checkin/:token，大車/小車領隊、總領隊共用）、
--   小組長免登入查詢頁（/chore-checkin/:token）目前只驗證 token 是否存在，
--   沒有檢查活動是否已結束。活動結束後只要連結/QR code 還留著（義工手機、
--   LINE 對話紀錄很常見），頁面依然打得開，會顯示學員姓名、電話等個資。
--
--   修法：活動結束後（date_end 當天過後）完全鎖住，不留緩衝期。
--   活動結束「當天」整天仍算有效，隔天才鎖（良師父已確認這個範圍，
--   若要連結束當天晚上都鎖，需另外討論）。
--
--   時區注意：Supabase Postgres 預設 UTC，判斷式一律用
--   (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
--   換算成台北當地日期再比較，避免提前或延後鎖住。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================


-- ── 1. get_car_by_token：活動已結束回傳 NULL ──────────────────

CREATE OR REPLACE FUNCTION get_car_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;


-- ── 2. get_leader_cars：活動已結束回傳空陣列 ──────────────────

CREATE OR REPLACE FUNCTION get_leader_cars(p_token TEXT, p_car_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  result JSON;
BEGIN
  SELECT event_id INTO v_event_id
  FROM car_assignments WHERE access_token = p_token LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN '[]'::JSON;
  END IF;

  -- 活動已結束就鎖住，回傳空陣列（不 RAISE，前端統一當作查無資料處理）
  IF EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RETURN '[]'::JSON;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return, ca.access_token,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = ANY(p_car_ids)
      AND ca.event_id = v_event_id
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;


-- ── 3. get_chore_by_token：活動已結束回傳 NULL ────────────────

CREATE OR REPLACE FUNCTION get_chore_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      c.chore_id, c.event_id, c.session, c.unit, c.work_content, c.location,
      c.supervising_monk, c.supervising_monk_phone, c.leader_name, c.leader_phone,
      c.quota_male, c.quota_female,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(mem_row)
        FROM (
          SELECT
            cmem.id, cmem.registration_id,
            r.student_id,
            COALESCE(s.name, r.answers->>'guest_name', '訪客') AS name,
            s.phone AS phone,
            (
              SELECT sc.group_name FROM student_classes sc
              WHERE sc.student_id = r.student_id AND (sc.group_name LIKE '%男%' OR sc.group_name LIKE '%女%')
              LIMIT 1
            ) AS group_name,
            (
              SELECT ca.car_name FROM car_members cmm
              JOIN car_assignments ca ON ca.car_id = cmm.car_id
              WHERE cmm.registration_id = r.registration_id
                AND ca.event_id = c.event_id AND ca.direction = 'up'
              LIMIT 1
            ) AS car_name
          FROM chore_members cmem
          JOIN registrations r ON r.registration_id = cmem.registration_id
          LEFT JOIN students s ON s.student_id = r.student_id
          WHERE cmem.chore_id = c.chore_id
        ) mem_row
      ) AS members
    FROM chores c
    LEFT JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_by_token(TEXT) TO anon, authenticated;


-- ── 4. checkin_car_member：活動已結束禁止寫入 ─────────────────

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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id AND ca.access_token = p_token
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


-- ── 5. checkin_all_car：活動已結束禁止寫入 ────────────────────

CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id AND ca.access_token = p_token
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


-- ── 6. checkin_car_monk：活動已結束禁止寫入 ───────────────────

CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_monks ck
    JOIN car_assignments ca ON ca.car_id = ck.car_id
    WHERE ck.id = p_car_monk_id AND ca.access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_monks ck
    JOIN car_assignments ca ON ca.car_id = ck.car_id
    JOIN events e ON e.event_id = ca.event_id
    WHERE ck.id = p_car_monk_id AND ca.access_token = p_token
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


-- ── 7. get_head_leader_by_token：新增 RPC 取代前端直查 head_leader 表 ──
-- 原本 getHeadLeaderByToken 是前端直接 .from('head_leader').select(...)，
-- 沒辦法在資料庫層加日期判斷。比照 get_car_by_token 整包撈，
-- 加上「活動已結束回傳 NULL」判斷。
-- 注意：head_leader 表本身的 anon SELECT policy 不能移除——
-- findLeaderByStudentId（/leader 領隊掃卡入口頁）還是直接查這張表，
-- 詳見對話回報第④點。

CREATE OR REPLACE FUNCTION get_head_leader_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      hl.id, hl.registration_id, hl.event_id, hl.type,
      row_to_json(e.*) AS events,
      (
        SELECT row_to_json(r_row) FROM (
          SELECT
            reg.answers, reg.student_id,
            row_to_json(s.*) AS students
          FROM registrations reg
          LEFT JOIN LATERAL (
            SELECT st.name FROM students st WHERE st.student_id = reg.student_id
          ) s ON true
          WHERE reg.registration_id = hl.registration_id
        ) r_row
      ) AS registrations
    FROM head_leader hl
    LEFT JOIN events e ON e.event_id = hl.event_id
    WHERE hl.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_head_leader_by_token(TEXT) TO anon, authenticated;


-- ── 8. is_token_expired：供前端判斷「查無資料」是無效 token 還是活動已結束 ──
-- 三張公開 token 表（car_assignments / head_leader / chores）共用同一套判斷邏輯，
-- 只回傳布林值，不洩漏任何實際資料，anon 可放心呼叫。
-- 邏輯：token 在任一張表存在且對應活動已結束 → true；
--      token 不存在（單純無效）或活動尚未結束 → false。

CREATE OR REPLACE FUNCTION is_token_expired(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_end DATE;
BEGIN
  SELECT e.date_end INTO v_date_end
  FROM car_assignments ca JOIN events e ON e.event_id = ca.event_id
  WHERE ca.access_token = p_token
  LIMIT 1;

  IF v_date_end IS NULL THEN
    SELECT e.date_end INTO v_date_end
    FROM head_leader hl JOIN events e ON e.event_id = hl.event_id
    WHERE hl.access_token = p_token
    LIMIT 1;
  END IF;

  IF v_date_end IS NULL THEN
    SELECT e.date_end INTO v_date_end
    FROM chores c JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
    LIMIT 1;
  END IF;

  IF v_date_end IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (NOW() AT TIME ZONE 'Asia/Taipei')::date > v_date_end;
END;
$$;

GRANT EXECUTE ON FUNCTION is_token_expired(TEXT) TO anon, authenticated;
