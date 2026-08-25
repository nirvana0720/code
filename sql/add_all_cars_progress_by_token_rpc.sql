-- ============================================================
-- 修復：總領隊看板／小車領隊看板 anon 讀不到資料的安全漏洞
-- 日期：2026-07-15
-- 背景：
--   fix_car_token_security.sql（2026-06-07）把 car_assignments 的 anon SELECT
--   政策移除，改用 get_car_by_token / get_leader_cars 這兩支 token 驗證的
--   SECURITY DEFINER RPC，取代前端直查 car_assignments 表——但當時只處理了
--   「單台車」領隊頁面（mode='car'），沒有一起改掉總領隊看板／小車領隊看板
--   （mode='head' / mode='small_car'）用的 getAllCarsProgress、
--   getEventRegistrations、getAllSmallCarsProgress 這三支，它們至今仍是
--   前端直接 .from('car_assignments')/.from('registrations') 查表。
--   政策移除後，這三支對 anon（真實領隊，未登入）等於永遠查到空結果，
--   總領隊/小車看板打開連結會是空的。
--
--   修法：新增一支 get_all_cars_progress_by_token(p_token)，比照
--   get_car_by_token 的驗證邏輯——用 head_leader.access_token 驗證身份、
--   確認活動未結束，才回傳該活動所有車輛進度（大車＋小車，small_car 類型
--   的領隊只看得到小車）＋（總領隊才需要的）全部報名資料，供前端算「其他
--   交通」名單用。leader_type 從 head_leader 表讀出，不接受前端傳入，
--   避免有人竄改參數看到不該看的範圍。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 2026-08-25 更新：小車領隊連結若限定 service_date（見
--   sql/add_small_car_leader_service_date.sql），只回傳那一天的小車。
-- ============================================================

CREATE OR REPLACE FUNCTION get_all_cars_progress_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id     UUID;
  v_leader_type  TEXT;
  v_service_date DATE;
  v_cars JSON;
  v_regs JSON;
BEGIN
  SELECT hl.event_id, hl.type, hl.service_date INTO v_event_id, v_leader_type, v_service_date
  FROM head_leader hl
  JOIN events e ON e.event_id = hl.event_id
  WHERE hl.access_token = p_token
    AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_cars
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.sort_order, ca.car_type,
      ca.direction, ca.pre_depart, ca.late_return, ca.service_date, ca.is_other_date,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at, reg.student_id,
              reg.pre_depart_override, reg.late_return_override, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
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
    WHERE ca.event_id = v_event_id
      AND (v_leader_type <> 'small_car' OR ca.car_type = 'small')
      AND (v_leader_type <> 'small_car' OR v_service_date IS NULL OR ca.service_date = v_service_date)
    ORDER BY ca.car_type DESC, ca.sort_order ASC
  ) t;

  -- 「其他交通」名單只有總領隊看板需要；小車領隊看板不用（前端本來就丟 []）
  IF v_leader_type = 'small_car' THEN
    v_regs := '[]'::json;
  ELSE
    SELECT COALESCE(json_agg(row_to_json(t2)), '[]'::json) INTO v_regs
    FROM (
      SELECT
        r.registration_id, r.answers, r.checked_in_at, r.checked_in_down_at, r.student_id,
        r.pre_depart_override, r.late_return_override,
        row_to_json(s.*) AS students
      FROM registrations r
      LEFT JOIN LATERAL (
        SELECT st.name,
          (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
        FROM students st WHERE st.student_id = r.student_id
      ) s ON true
      WHERE r.event_id = v_event_id
    ) t2;
  END IF;

  RETURN json_build_object('cars', v_cars, 'regs', v_regs);
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_cars_progress_by_token(TEXT) TO anon, authenticated;
