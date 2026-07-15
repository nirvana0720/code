-- 讓後端 service_role 能讀取學員班級關聯表（比對未報名名單需要）
-- 在 Supabase Dashboard → SQL Editor 貼上執行
-- 只授予唯讀 SELECT，不改任何資料
GRANT SELECT ON TABLE student_classes TO service_role;
