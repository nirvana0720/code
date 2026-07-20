-- 2026-07-20 場次共用子欄位：新增「只在特定場次顯示」
-- 背景：show_if_period 只能鎖時段（上午/下午/晚上），同時段有多場次時
--   無法只鎖單一場次（例：梁皇寶懺十卷裡第一卷跟第九卷都是「上午」，
--   想讓午齋問題只在第九卷出現，原本做不到）。
-- 新增 show_if_session_ids：有值時只在指定場次顯示（忽略 show_if_period）；
--   空陣列（預設）維持原本 show_if_period 邏輯，舊資料/舊活動不受影響。
-- 可重複執行（IF NOT EXISTS）。
ALTER TABLE event_session_fields ADD COLUMN IF NOT EXISTS show_if_session_ids UUID[] DEFAULT '{}'::uuid[];
