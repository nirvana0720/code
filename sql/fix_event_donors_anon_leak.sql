-- 【定位：獨立小工具，不排入 MIGRATION_ORDER.md／full_setup_all_in_one.sql】
-- event_donors 表 anon 全表外洩修復
--
-- ⚠️ 這件事早就修過了：正式環境已於 2026-06-05 用專案根目錄的 `fix_rls_clean.sql`
-- 執行過「event_donors 完全封鎖 anon」（REVOKE + DROP 四條 anon policy，只留 authenticated 政策），
-- 該檔案內容已收錄於 `sql/full_setup_all_in_one.sql` 第 [52/81] 項，凡是照
-- `full_setup_all_in_one.sql` 或依 `MIGRATION_ORDER.md` 完整順序跑過 migration 的環境
-- （包含正式環境本身），這件事都已經生效，跑這支檔案是重複、不需要。
--
-- 這支檔案只給一種情況用：只執行過 `schema.sql` 建表、但沒有依序跑完後續 migration 的舊環境
-- （`schema.sql` 本身沒有同步更新，仍寫著開放 anon 全表 SELECT/INSERT/UPDATE/DELETE，
-- 只跑 schema.sql 的環境會是真的有洞）。若你的環境是照 `full_setup_all_in_one.sql` 或
-- `MIGRATION_ORDER.md` 完整順序建的，不需要執行這支檔案。
--
-- 執行前建議先用 SELECT has_table_privilege('anon', 'event_donors', 'SELECT') 確認目前狀態，
-- 若已經是 false 就代表不需要跑（或跑了也是安全的空操作，DROP POLICY IF EXISTS / REVOKE ALL
-- 本身可重複執行不會出錯）。

DROP POLICY IF EXISTS "anon can select event_donors" ON event_donors;
DROP POLICY IF EXISTS "anon can insert event_donors" ON event_donors;
DROP POLICY IF EXISTS "anon can update event_donors" ON event_donors;
DROP POLICY IF EXISTS "anon can delete event_donors" ON event_donors;
REVOKE ALL ON event_donors FROM anon;

-- 還原指令（萬一發現有遺漏，先跑這幾行恢復原狀，再回報問題）：
-- GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors TO anon;
-- CREATE POLICY "anon can select event_donors" ON event_donors FOR SELECT TO anon USING (true);
-- CREATE POLICY "anon can insert event_donors" ON event_donors FOR INSERT TO anon WITH CHECK (true);
-- CREATE POLICY "anon can update event_donors" ON event_donors FOR UPDATE TO anon USING (true);
-- CREATE POLICY "anon can delete event_donors" ON event_donors FOR DELETE TO anon USING (true);

-- 驗證（正式環境用以下方式實測，這裡留給日後參考）：
-- SET ROLE anon;
-- SELECT * FROM event_donors LIMIT 1;   -- 應該報錯 permission denied
-- RESET ROLE;
