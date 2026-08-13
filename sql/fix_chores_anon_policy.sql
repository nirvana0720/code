-- ⚠️ 2026-08-12 補記：本檔已作廢，get_chore_locations_by_event 現行主檔是
-- sql/rpc_chore.sql，改函式一律去該檔改，不要回這支改。這支檔案只剩歷史紀錄用途。
--
-- ============================================================
-- 收緊 chores / chore_members 的 anon 全表讀取權限
-- 日期：2026-07-14
-- 背景：
--   chores（坡務主表，含負責法師/小組長姓名電話）、chore_members（坡務成員，
--   含學員登記關係）這兩張表建表時（2026-07-13）直接給了 anon 全開放的
--   SELECT USING (true) 政策——不需要 token、不需要登入，直接打 Supabase
--   REST API 就能整表撈到，跟 car_assignments（2026-06-05 健檢 Critical #3）、
--   car_members/car_monks（Important #4）當初是同一類洞，只是這兩張表沒
--   跟著一起收緊。
--
--   小組長免登入查詢頁（/chore-checkin/:token）已經完全走
--   get_chore_by_token(p_token) 這支 SECURITY DEFINER RPC，沒有直接查表。
--
--   但排查發現 choreAssignment.js 的 getChoreLocationsByEvent(eventId)
--   會被 CarCheckinPage.jsx（/car-checkin/:token 公開領隊報到頁）直接呼叫，
--   用來顯示福慧出坡活動每位學員的「今日出坡地點」徽章，這支函式原本直接
--   查 chores / chore_members 表。所以先新增 get_chore_locations_by_event
--   RPC 取代直接查表，前端改呼叫 RPC 後，anon 的全表讀取政策才能安全移除。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================


-- ── 1. 新增 RPC：取代 choreAssignment.js 的 getChoreLocationsByEvent 直接查表 ──
-- 回傳 { [registration_id]: { "上午": location, "下午": location } }（比照原本 JS 邏輯，
-- 只有實際有排到的時段才會有 key，location 為 null 時填空字串）

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
      json_object_agg(c.session, COALESCE(c.location, '')) AS sessions
    FROM chore_members cm
    JOIN chores c ON c.chore_id = cm.chore_id
    WHERE c.event_id = p_event_id
    GROUP BY cm.registration_id
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_locations_by_event(UUID) TO anon, authenticated;


-- ── 2. 移除 chores / chore_members 的 anon 全表讀取政策 ────────────

DROP POLICY IF EXISTS "anon can read chores" ON chores;
DROP POLICY IF EXISTS "anon can read chore_members" ON chore_members;

REVOKE SELECT ON chores FROM anon;
REVOKE SELECT ON chore_members FROM anon;

-- authenticated 的政策（"auth full access on chores" / "auth full access on chore_members"）
-- 與 GRANT ALL TO authenticated 不動，後台排坡管理功能維持原樣
