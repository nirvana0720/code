-- 2026-07-13 福慧出坡排坡系統：小組長免登入報到頁用 RPC
-- chores / chore_members 本身開放 anon SELECT（見 add_chore_arrangement.sql），
-- 但 registrations / students 對 anon 已鎖死（見 fix_rls_registrations_anon.sql），
-- 小組長頁需要姓名/性別/電話/上山車次，故比照 get_car_by_token 寫一支 SECURITY DEFINER RPC 一次撈齊。
--
-- 2026-07-14 更新：加上 supervising_monk_phone（負責法師電話）與各成員 phone（學員電話），
-- 供小組長頁做成 tel: 可撥打連結。

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
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_by_token(TEXT) TO anon, authenticated;
