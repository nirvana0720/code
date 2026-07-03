-- ============================================================
-- 修正 get_student_by_qr 移除 active 過濾
-- 日期：2026-07-03
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/05 健檢建立 get_student_by_qr RPC 時加了 WHERE active = true，
--   導致「換學期退場」後被標為未在籍的學員，掃 QR 會回 NOT_FOUND，
--   無法報名精舍活動。
--   「未在籍」應只影響課務管理，不應擋精舍活動報名。
--
-- 改動：
--   移除 AND active = true 過濾，讓未在籍學員也能被找到。
--   active 欄位仍回傳，前台顯示灰色「目前非在籍」小標（不擋流程）。
-- ============================================================

-- 先 DROP 才能改 return type（PostgreSQL 限制）
DROP FUNCTION IF EXISTS get_student_by_qr(TEXT);

CREATE OR REPLACE FUNCTION get_student_by_qr(code TEXT)
RETURNS TABLE (
  student_id      TEXT,
  qr_code         TEXT,
  name            TEXT,
  class_name      TEXT,
  group_name      TEXT,
  active          BOOLEAN,
  created_at      TIMESTAMPTZ,
  student_classes JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.student_id,
    s.qr_code,
    s.name,
    s.class_name,
    s.group_name,
    s.active,
    s.created_at,
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object('class_name', sc.class_name, 'group_name', sc.group_name)
         ORDER BY sc.id
       )
       FROM student_classes sc
       WHERE sc.student_id = s.student_id),
      '[]'::jsonb
    ) AS student_classes
  FROM students s
  WHERE s.qr_code = code;
  -- 不加 AND s.active = true，未在籍學員仍可被找到並報名活動
END;
$$;

-- anon（前台平板）和 authenticated（後台）都可呼叫
GRANT EXECUTE ON FUNCTION get_student_by_qr(TEXT) TO anon, authenticated;

-- ── 驗證（可選）──────────────────────────────────────────────
-- SELECT * FROM get_student_by_qr('115005662');
-- 預期：即使該學員 active=false 也能回傳一筆
