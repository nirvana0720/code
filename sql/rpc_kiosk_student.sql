-- 職責：kiosk_get_registrations_for_student 主檔（本檔為這支函式唯一主檔）。
-- 2026-07-22 建立：這支函式原本定義在 fix_rls_registrations_anon.sql（首次建立，2026-06 初，
-- 沒有 dormitory_room 欄位），後來 add_dormitory_room_to_rpcs.sql 用 DROP FUNCTION + CREATE
-- 加回 dormitory_room 欄位（因為改了回傳欄位組成，CREATE OR REPLACE 做不到，必須先 DROP），
-- 但兩支檔案都沒有標記彼此的關係，一直沒有固定主檔。這裡把加了 dormitory_room 的最終版本
-- 原封不動搬過來，往後這支函式只在這支檔案改。
-- 可安全重跑：DROP FUNCTION IF EXISTS + CREATE（回傳欄位組成不能用 CREATE OR REPLACE 變更）。

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
