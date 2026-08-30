-- ============================================================
-- add_has_dormitory_flag.sql
-- 日期：2026-08-30
-- 背景：
--   「寮號」欄位（後台「報名名單」的「顯示欄位」切換鈕、「編輯報名內容」視窗）
--   原本不管什麼活動一律顯示，即使是不需要住宿安排的活動（如精舍本地法會）
--   也會出現一個永遠用不到的寮號欄位。良師父確認「只在真的需要住宿安排的
--   活動才顯示比較好」，且要新增一個專用開關，不要跟既有「對外公開寮號資訊」
--   （show_dormitory_to_public，控制學員/領隊看不看得到）混用——那個開關是
--   刻意設計成「安單資料匯入未定案前請保持關閉」，如果拿來當「要不要顯示
--   寮號欄位」的判斷依據，會讓後台在資料還沒匯入定案前也看不到、改不到寮號
--   欄位，等於重現當初新增這個後台欄位就是為了解決的問題。
--
--   新增獨立欄位 events.has_dormitory，只控制「寮號欄位要不要出現在後台」，
--   跟 show_dormitory_to_public（要不要讓學員/領隊看到）完全獨立。
--
--   回填規則：任何已經有寮號資料的活動（registrations.dormitory_room 非空），
--   自動打開 has_dormitory，避免既有已在使用寮號功能的活動（例如多日回山法會）
--   升級後突然看不到這個欄位。尚未匯入安單資料、但確定需要住宿安排的活動
--   （例如已建立但還沒匯入的未來回山法會），不會被這條規則抓到，需要良師父
--   自行到「活動設定」勾選。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run，可安全重跑
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS has_dormitory BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN events.has_dormitory IS '此活動是否需要住宿/寮房安排（控制後台「報名名單」顯示欄位、「編輯報名內容」是否出現寮號欄位；跟 show_dormitory_to_public 獨立，後者控制學員/領隊端可見度）';

-- 回填：已經有寮號資料的活動，自動打開這個開關
UPDATE events e
SET has_dormitory = true
WHERE EXISTS (
  SELECT 1 FROM registrations r
  WHERE r.event_id = e.event_id
    AND r.dormitory_room IS NOT NULL
    AND r.dormitory_room <> ''
)
AND has_dormitory = false;
