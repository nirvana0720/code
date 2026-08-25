-- ============================================================
-- 新增：小車領隊連結可限定「單一天」（多日回山用）
-- 日期：2026-08-25
-- 背景：
--   head_leader 表原本沒有日期欄位，小車領隊（type='small_car'）的連結
--   一律整場活動、不分日期都能查看/操作所有小車 —— 多日回山活動裡，
--   不同天理論上該由不同人負責，但系統一直沒有「這支連結只給某一天用」
--   的機制。
--   修法：head_leader 新增可為空的 service_date 欄位（NULL＝不限定，
--   維持原本行為，向下相容單日活動與舊資料）。
--
--   對應的 RPC 修改（get_all_cars_progress_by_token 篩選、
--   get_head_leader_by_token 吐出 service_date）直接改在各自的主檔：
--   sql/add_all_cars_progress_by_token_rpc.sql、sql/rpc_car.sql
--   ——這支檔案只放 schema 變更，不重複定義函式（避免同一函式散落
--   多支檔案，見 CLAUDE.md「修 RPC 函式的鐵律」）。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- 這支檔案跑完後，還要接著跑 add_all_cars_progress_by_token_rpc.sql
-- 與 rpc_car.sql 裡更新過的兩支函式（或直接重跑整支檔案，兩支都是
-- CREATE OR REPLACE，重跑安全）。
-- ============================================================

ALTER TABLE head_leader ADD COLUMN IF NOT EXISTS service_date DATE;

COMMENT ON COLUMN head_leader.service_date IS
  '小車領隊限定的服務日期（僅 type=small_car 時有意義）；NULL = 不限定，整場活動每天都能用（原本行為，向下相容）';
