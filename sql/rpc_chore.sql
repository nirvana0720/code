-- 職責：坡務（義工工作）相關 RPC 主檔（本檔為這批函式唯一主檔）。
-- 2026-07-22 建立：get_chore_locations_by_event／get_chore_by_token 這兩支函式原本沒有
-- 固定主檔，用資料庫函式健檢工具比對才發現。這裡把目前正式生效的版本原封不動搬過來，
-- 往後這兩支函式只在這支檔案改。
-- 可安全重跑：CREATE OR REPLACE。

-- ── get_chore_locations_by_event：領隊報到頁「坡務」頁籤用 ──────────────────
CREATE OR REPLACE FUNCTION get_chore_locations_by_event(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT COALESCE(json_object_agg(t.registration_id, t.sessions), '{}'::json) INTO result
  FROM (
    SELECT
      cm.registration_id,
      json_object_agg(c.session, json_build_object(
        'chore_id', c.chore_id,
        'unit', c.unit,
        'work_content', c.work_content,
        'location', c.location,
        'sort_order', c.sort_order
      )) AS sessions
    FROM chore_members cm
    JOIN chores c ON c.chore_id = cm.chore_id
    WHERE c.event_id = p_event_id
    GROUP BY cm.registration_id
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_locations_by_event(UUID) TO anon, authenticated;

-- ── get_chore_by_token：小組長免登入查詢頁用，活動結束後鎖住（2026-07-14 已補上鎖定） ──
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
