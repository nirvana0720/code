-- 職責：車輛／隨車法師／領隊 token 相關 RPC 主檔（本檔為這批函式唯一主檔）。
-- 2026-07-22 建立：用資料庫函式健檢工具（D:\Claude\projects\資料庫函式健檢工具\）比對
-- 全部 SQL 檔案才發現，get_leader_cars／get_car_by_token／checkin_car_monk／
-- checkin_car_member／checkin_all_car 這 5 支函式，一直沒有固定主檔，各自散落在
-- add_dormitory_room_to_rpcs.sql／fix_car_token_security.sql／fix_head_leader_checkin_token.sql／
-- lock_expired_token_pages.sql 等好幾支「這次改這個」的檔案裡，同一支函式最多曾被
-- 3 支不同檔案定義過。另外 get_head_leader_by_token／is_token_expired 這兩支雖然只活在
-- lock_expired_token_pages.sql 一支檔案（不算真正分歧），但性質上跟這批 token 查詢函式
-- 是同一家族，一併收進來，一起指定這支主檔。
--
-- ⚠️ 重要：搬家過程中發現 get_car_by_token／get_leader_cars 這兩支，有兩處各自漏掉對方
-- 修改的真實問題，這裡已經合併修好，不是單純搬檔案：
-- 1. 【安全缺口，已補回】lock_expired_token_pages.sql（2026-07-14）原本要加「活動結束後鎖住
--    公開連結頁面」，但直接查正式環境 pg_get_functiondef 核對，這段鎖定邏輯從來沒有真的
--    貼上正式環境執行過——活動結束後，舊連結（義工手機／LINE 對話紀錄常見）依然打得開，
--    會洩漏學員姓名、電話等個資。這裡把鎖定邏輯（結束隔天起查無資料）補回去，2026-07-22
--    良師父已確認要一併修正上線。
-- 2. 【欄位分歧，已合併】add_dormitory_room_to_rpcs.sql（後改）加了 dormitory_room 但拿掉了
--    st.phone；lock_expired_token_pages.sql（先改）保留 phone 但沒有 dormitory_room。兩邊
--    都沒基於對方版本改，這裡兩個欄位都保留。
-- 往後這 5 支函式只在這支檔案改。
-- 可安全重跑：CREATE OR REPLACE。
--
-- ⚠️ 2026-08-04 更新（多日回山排車）：get_car_by_token／get_leader_cars 的鎖定判斷改用
-- car_assignments.service_date（這台車服務的日期）優先判斷；service_date 為 NULL（單日活動、
-- 或既有舊資料）才 fallback 回原本的 e.date_end 判斷，避免多日活動同一活動底下不同日期的車
-- 被一起鎖住/開放。兩支函式回傳資料都加上 service_date 欄位供前端顯示。
-- ⚠️ 2026-08-04 補件：同一批鎖定邏輯套用到 checkin_car_member／checkin_all_car／checkin_car_monk／
-- is_token_expired，避免同一支檔案裡鎖定判斷不一致（這幾支原本只看 e.date_end，多日活動某天的車
-- service_date 已過、get_car_by_token 查不到了，這幾支卻還放行寫入）。get_head_leader_by_token
-- 維持看整個活動的 date_end 不變——它回傳的是「總領隊/小車領隊」這個人的權限範圍，不是單一台車，
-- 沒有對應的 service_date 可用。

-- ── get_car_by_token：車輛看板用 token 查詢單台車完整資料（含成員/法師/領隊） ──
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
      ca.direction, ca.service_date, ca.pre_depart, ca.late_return,
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
              reg.student_id, reg.dormitory_room,
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
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date <= ca.service_date)
        OR (ca.service_date IS NULL AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end))
      )
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;

-- ── get_leader_cars：領隊看板用 token 一次查詢自己權限範圍內的多台車 ──
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

  -- 鎖定判斷改在下方主查詢的 WHERE 逐車判斷（每台車自己的 service_date 優先，NULL 才 fallback
  -- 回 e.date_end），不再用「整個活動 date_end 已過」一次鎖住全部——多日活動不同日期的車，
  -- 已過的那幾天鎖住、還沒到的維持開放，不會互相影響。

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.service_date, ca.pre_depart, ca.late_return, ca.access_token,
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
              reg.student_id, reg.dormitory_room,
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
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date <= ca.service_date)
        OR (ca.service_date IS NULL AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end))
      )
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;

-- ── checkin_car_member／checkin_all_car／checkin_car_monk：報到三支 ──────────
-- 2026-07-15 修復：p_token 除了該車自己的 access_token，也放行同活動、權限涵蓋該車的
-- head_leader token（小車領隊只認得 car_type='small'），讓總領隊/小車領隊看板點報到
-- 不會失敗（fix_head_leader_checkin_token.sql 那次修復，內容原封不動搬過來）。
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
    SELECT 1 FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > ca.service_date)
        OR (ca.service_date IS NULL AND e.date_end IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end)
      )
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
    SELECT 1 FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > ca.service_date)
        OR (ca.service_date IS NULL AND e.date_end IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end)
      )
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
    SELECT 1 FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = v_car_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > ca.service_date)
        OR (ca.service_date IS NULL AND e.date_end IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end)
      )
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;

-- ── get_head_leader_by_token：總領隊／小車領隊看板用 token 查詢自己的權限範圍 ──
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
      hl.id, hl.registration_id, hl.event_id, hl.type, hl.service_date,
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

-- ── is_token_expired：供前端判斷「查無資料」是無效 token 還是活動已結束 ──
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
  v_service_date DATE;
BEGIN
  SELECT e.date_end, ca.service_date INTO v_date_end, v_service_date
  FROM car_assignments ca JOIN events e ON e.event_id = ca.event_id
  WHERE ca.access_token = p_token
  LIMIT 1;

  -- 車輛 token：service_date 優先於 date_end；兩者皆 NULL 才視為「查無資料」繼續往下查
  -- head_leader／chores（這兩張表沒有 service_date 欄位，維持原邏輯）
  IF v_service_date IS NOT NULL THEN
    RETURN (NOW() AT TIME ZONE 'Asia/Taipei')::date > v_service_date;
  END IF;

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
