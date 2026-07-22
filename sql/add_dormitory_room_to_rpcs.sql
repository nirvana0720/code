-- ============================================================
-- 安單寮號顯示：既有 RPC 補上 dormitory_room 欄位
-- 前提：registrations.dormitory_room 已存在（add_dormitory_phone_lineid.sql）
-- 在 Supabase SQL Editor 執行
-- ============================================================
--
-- ⚠️ 2026-07-22 已作廢：get_car_by_token／get_leader_cars 已搬到 rpc_car.sql，
-- kiosk_get_registrations_for_student 已搬到 rpc_kiosk_student.sql（皆為唯一主檔）。
-- 這支檔案原本漏帶 lock_expired_token_pages.sql 補的 st.phone 欄位，搬家時已一併
-- 合併補回，不是單純複製這裡的版本。這支檔案只留存歷史紀錄，不要再從這裡重跑。

-- 1. get_car_by_token：car_members.registrations 補 dormitory_room
--    events 用 row_to_json(e.*)，show_dormitory_to_public 已隨欄位存在自動帶出，不需改
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
              reg.student_id, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id,
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
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;

-- 2. get_leader_cars：同上補 dormitory_room
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
              reg.student_id, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id,
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

-- 3. kiosk_get_registrations_for_student：RETURNS TABLE 改變欄位，需先 DROP 才能重建
--    （CREATE OR REPLACE 無法變更既有函式的回傳欄位組成，這點先前重建 get_student_by_qr 時也踩過）
DROP FUNCTION IF EXISTS kiosk_get_registrations_for_student(TEXT, UUID[]);

CREATE FUNCTION kiosk_get_registrations_for_student(
  p_student_id TEXT,
  p_event_ids  UUID[]
)
RETURNS TABLE (
  registration_id UUID,
  event_id        UUID,
  student_id      TEXT,
  host_student_id TEXT,
  answers         JSONB,
  is_driver       BOOLEAN,
  registered_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  dormitory_room  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.registration_id,
    r.event_id,
    r.student_id,
    r.host_student_id,
    (r.answers - 'guest_phone') AS answers,   -- 遮掉親友電話
    r.is_driver,
    r.registered_at,
    r.updated_at,
    r.dormitory_room
  FROM registrations r
  WHERE r.event_id = ANY(p_event_ids)
    AND (
      r.student_id      = p_student_id
      OR r.host_student_id = p_student_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_get_registrations_for_student(TEXT, UUID[]) TO anon, authenticated;
