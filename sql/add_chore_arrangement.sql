-- 2026-07-13 新功能：福慧出坡排坡系統
-- 學員上山當天，依「上山」方向的車輛分組，被分配到各個坡務（出坡工作項目），
-- 坡務有負責法師、精舍小組長、男女人數上限；出坡結束後學員仍要回到原本的上山車。

-- 活動層級開關：只有勾選的活動（福慧出坡）才需要排坡，排坡系統列表只顯示這些活動
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_chore_event BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN events.is_chore_event IS '是否為福慧出坡活動（需要排坡）；一般回山活動預設 false';

-- 坡務主表：山上坡務表 Excel 匯入後，一列變成一筆坡務
CREATE TABLE IF NOT EXISTS chores (
  chore_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  session           TEXT        NOT NULL CHECK (session IN ('上午', '下午')),
  unit              TEXT,       -- 單位，例如「客寮管理」「女環」
  work_content      TEXT,       -- 坡務內容，例如「掃寮」「打掃架房」
  location           TEXT,      -- 集合地點
  supervising_monk  TEXT,       -- 負責法師（含電話，原始文字整段存）
  leader_name       TEXT,       -- 精舍小組長姓名/法名
  leader_phone      TEXT,       -- 小組長電話
  quota_male        INT,        -- 人數上限（男），NULL = 不限
  quota_female       INT,       -- 人數上限（女），NULL = 不限
  sort_order        INT         NOT NULL DEFAULT 0,
  access_token      TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN chores.access_token IS '小組長免登入查詢連結用，比照 car_assignments.access_token';

CREATE INDEX IF NOT EXISTS idx_chores_event         ON chores(event_id);
CREATE INDEX IF NOT EXISTS idx_chores_event_session ON chores(event_id, session);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chores_token    ON chores(access_token);

-- 坡務成員：學員被分配到哪個坡務（同一學員在同一 session 只能有一筆，由應用層檢查，不用 DB constraint）
CREATE TABLE IF NOT EXISTS chore_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id        UUID        NOT NULL REFERENCES chores(chore_id) ON DELETE CASCADE,
  registration_id UUID        NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chore_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_chore_members_chore ON chore_members(chore_id);
CREATE INDEX IF NOT EXISTS idx_chore_members_reg   ON chore_members(registration_id);

ALTER TABLE chores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE chore_members ENABLE ROW LEVEL SECURITY;

-- chores / chore_members：anon 可讀（小組長免登入連結頁 /chore-checkin/:token），後台 authenticated 全權限
CREATE POLICY "anon can read chores"            ON chores        FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on chores"      ON chores        FOR ALL    TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon can read chore_members"     ON chore_members FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on chore_members" ON chore_members FOR ALL  TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT     ON chores        TO anon;
GRANT ALL        ON chores        TO authenticated;
GRANT SELECT     ON chore_members TO anon;
GRANT ALL        ON chore_members TO authenticated;
