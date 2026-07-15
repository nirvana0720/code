-- ============================================================
-- 領隊報到頁「坡務」頁籤：get_chore_locations_by_event 回傳格式加強
-- 日期：2026-07-15
-- 背景：
--   原本這支 RPC（見 fix_chores_anon_policy.sql）只回傳地點文字：
--   { [registration_id]: { "上午": location, "下午": location } }
--   領隊報到頁新增「坡務」頁籤要依「時段＋坡務」分組並顯示坡務內容，
--   只有地點文字不夠用，改成回傳整包坡務資訊（含 sort_order 供分組排序）。
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

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
