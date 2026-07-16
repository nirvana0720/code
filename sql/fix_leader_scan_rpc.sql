-- ============================================================
-- 修復 /leader 掃卡入口頁「找不到領隊資料」誤判 bug
-- 日期：2026-07-16
-- 背景：
--   findLeaderByStudentId（供 /leader 掃卡入口頁使用，公開不需登入）
--   直接查 registrations / car_leaders / car_assignments / head_leader
--   四張表。但 registrations 的 anon SELECT 已在 6 月健檢移除、
--   car_assignments 的 anon SELECT 也已在 6/7 健檢移除，導致 anon
--   身份完全查不到任何資料 → 任何領隊刷卡一律顯示「找不到領隊資料，
--   你不是本次活動的領隊」，即使他真的是領隊。
--
--   用 anon key 實測 REST API 確認：
--   GET /rest/v1/registrations?select=registration_id&limit=1 → []
--   GET /rest/v1/car_assignments?select=car_id&limit=1 → []
--   （HTTP 200 + 空陣列，是 RLS 靜默擋掉，不是報錯，很難被發現）
--
--   修法：比照 get_car_by_token / get_head_leader_by_token 的模式，
--   新增 SECURITY DEFINER RPC 由資料庫層代查，繞過 RLS，同時比照
--   lock_expired_token_pages.sql 一起加上「活動已結束不回傳」的過期
--   鎖定判斷（時區用 Asia/Taipei，避免 UTC 誤差提前或延後鎖住）。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE OR REPLACE FUNCTION find_leader_by_student_id_public(p_student_id TEXT)
RETURNS TABLE (
  role_type   TEXT,
  token       TEXT,
  event_id    UUID,
  event_name  TEXT,
  car_name    TEXT,
  direction   TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- 大車領隊
  SELECT
    'car'::TEXT,
    ca.access_token,
    e.event_id,
    e.name,
    ca.car_name,
    COALESCE(ca.direction, 'down')
  FROM registrations r
  JOIN car_leaders cl ON cl.registration_id = r.registration_id
  JOIN car_assignments ca ON ca.car_id = cl.car_id
  JOIN events e ON e.event_id = ca.event_id
  WHERE r.student_id = p_student_id
    AND e.status = 'active'
    AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)

  UNION ALL

  -- 總領隊 / 小車領隊
  SELECT
    hl.type,
    hl.access_token,
    e.event_id,
    e.name,
    NULL::TEXT,
    NULL::TEXT
  FROM registrations r
  JOIN head_leader hl ON hl.registration_id = r.registration_id
  JOIN events e ON e.event_id = hl.event_id
  WHERE r.student_id = p_student_id
    AND e.status = 'active'
    AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end);
END;
$$;

GRANT EXECUTE ON FUNCTION find_leader_by_student_id_public(TEXT) TO anon, authenticated;


-- ============================================================
-- 驗證用（跑完主要 migration 後，用假資料驗證，測完記得清除）
-- ============================================================
-- SELECT * FROM find_leader_by_student_id_public('你的測試學員編號');
