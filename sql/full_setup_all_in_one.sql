-- ============================================================
-- 普宜精舍報名系統 — 完整資料庫建置（合併版）
-- 產生日期：2026-07-19（2026-07-22 補上第八階段 4 支 RPC 主檔，見檔案最後）
-- 說明：把 sql/MIGRATION_ORDER.md 第一階段～第七階段共 82 個檔案，
--       依正確順序合併成這一份檔案，新環境只需要貼這一份到 Supabase SQL Editor
--       執行一次即可，不用一個一個檔案手動貼。
-- 用法：Supabase Dashboard → SQL Editor → New query → 貼上全部內容 → Run
-- 注意：檔案較大，執行可能需要 10~30 秒，請耐心等待，不要中途關閉分頁。
--
-- ⚠️ 2026-07-22 補充：檔案最後追加了第八階段（rpc_car.sql／rpc_chore.sql／
-- rpc_kiosk_student.sql／rpc_events.sql）4 支 RPC 主檔，用 CREATE OR REPLACE
-- 蓋掉前面第七階段幾個舊檔案（第 62／67／68／70／72／74 項等）留下的中間版本，
-- 補上合併後的正確欄位與從未真正上線的活動結束鎖定安全修正。新環境依序執行
-- 這一整份檔案即可拿到最終正確版本，不用另外處理。
-- ============================================================

-- ------------------------------------------------------------
-- [1/81] schema.sql
-- ------------------------------------------------------------
-- ============================================================
-- 普宜精舍報名系統 — 完整資料庫建置 SQL（v2，2026-05-23）
--
-- 適用情境：全新 Supabase 專案，一次執行即可建好所有資料表。
-- 執行方式：Supabase Dashboard → SQL Editor → 貼入 → Run
--
-- 涵蓋資料表（共 22 張）：
--   students, student_classes,
--   events, event_fields, event_templates,
--   event_sessions, event_session_fields,
--   registrations, registration_changes, registration_session_checkins,
--   audit_log, event_donors,
--   car_assignments, car_members, car_leaders, head_leader,
--   car_monks, temple_monks,
--   relationship_groups, relationship_members,
--   volunteer_profiles, volunteer_event_access
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. 學員資料
-- ════════════════════════════════════════════════════════════

-- 學員主表
CREATE TABLE IF NOT EXISTS students (
  student_id  TEXT        PRIMARY KEY,
  qr_code     TEXT        UNIQUE,
  name        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 學員班別（一位學員可同時上多個班）
CREATE TABLE IF NOT EXISTS student_classes (
  id          BIGSERIAL   PRIMARY KEY,
  student_id  TEXT        NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  class_name  TEXT        NOT NULL,
  group_name  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_classes_student ON student_classes(student_id);


-- ════════════════════════════════════════════════════════════
-- 2. 活動與欄位
-- ════════════════════════════════════════════════════════════

-- 活動主表
CREATE TABLE IF NOT EXISTS events (
  event_id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT        NOT NULL,
  date_start               DATE,
  date_end                 DATE,
  location                 TEXT,
  event_type               TEXT        NOT NULL DEFAULT 'mountain'
                             CHECK (event_type IN ('temple', 'mountain')),
  is_dharma                BOOLEAN     NOT NULL DEFAULT false,
  status                   TEXT        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'active', 'closed')),
  locked                   BOOLEAN     NOT NULL DEFAULT false,
  multi_session            BOOLEAN     NOT NULL DEFAULT false,
  show_transport_to_public BOOLEAN     NOT NULL DEFAULT false,
  last_exported_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN events.locked                   IS '是否鎖定報名（true = 前台只能查看，不能新增/修改/取消）';
COMMENT ON COLUMN events.event_type               IS '活動類型：temple=精舍活動、mountain=回山活動';
COMMENT ON COLUMN events.is_dharma                IS '是否為法會（控制功德主管理顯示）';
COMMENT ON COLUMN events.multi_session            IS '是否為多場次活動（梁皇寶懺等）';
COMMENT ON COLUMN events.show_transport_to_public IS '對外公開排車資訊：true 時學員在 KioskPage 刷卡可看到自己的車次';

-- 活動動態欄位
CREATE TABLE IF NOT EXISTS event_fields (
  field_id       UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID     NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key      TEXT     NOT NULL,
  field_label    TEXT     NOT NULL,
  field_type     TEXT     NOT NULL
                   CHECK (field_type IN ('radio','checkbox','boolean','text','date','time','plate','datetime')),
  options        JSONB,
  show_if        JSONB,
  sort_order     INT      NOT NULL DEFAULT 0,
  required       BOOLEAN  NOT NULL DEFAULT false,
  placeholder    TEXT,
  dashboard_role TEXT
                   CHECK (dashboard_role IS NULL OR dashboard_role IN ('identity','lunch_total','parking_kind')),
  option_meta    JSONB
);

COMMENT ON COLUMN event_fields.dashboard_role IS '看板角色：identity / lunch_total / parking_kind';
COMMENT ON COLUMN event_fields.option_meta    IS '選項層級 metadata，parking_kind 時格式：{"<選項>":"motorcycle|car|none"}';
COMMENT ON COLUMN event_fields.placeholder    IS 'text 欄位的灰底提示文字';

CREATE INDEX IF NOT EXISTS idx_event_fields_event_id ON event_fields(event_id);

-- 活動模板
CREATE TABLE IF NOT EXISTS event_templates (
  template_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  fields         JSONB       NOT NULL DEFAULT '[]',
  session_fields JSONB       NOT NULL DEFAULT '[]',
  sort_order     INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN event_templates.session_fields IS '場次共用子欄位（多場次活動用）；套用模板時同步覆蓋 event_session_fields';


-- ════════════════════════════════════════════════════════════
-- 3. 多場次活動
-- ════════════════════════════════════════════════════════════

-- 場次設定（multi_session=true 活動用）
CREATE TABLE IF NOT EXISTS event_sessions (
  session_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  time_period TEXT        NOT NULL CHECK (time_period IN ('morning','afternoon','evening')),
  dharma_name TEXT        NOT NULL DEFAULT '',
  time_start  TIME,
  time_end    TIME,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);

-- 場次共用子欄位（動態化，取代寫死的午齋/停車）
CREATE TABLE IF NOT EXISTS event_session_fields (
  field_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key      TEXT        NOT NULL,
  field_label    TEXT        NOT NULL,
  field_type     TEXT        NOT NULL DEFAULT 'radio'
                               CHECK (field_type IN ('radio','boolean','text')),
  options        JSONB       NOT NULL DEFAULT '[]',
  show_if_period JSONB       NOT NULL DEFAULT '[]',
  sort_order     INT         NOT NULL DEFAULT 0,
  required       BOOLEAN     NOT NULL DEFAULT true,
  dashboard_role TEXT
                   CHECK (dashboard_role IS NULL OR dashboard_role IN ('identity','lunch_total','parking_kind')),
  option_meta    JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, field_key)
);

COMMENT ON COLUMN event_session_fields.show_if_period IS '[] = 所有時段；["morning"] = 只上午場顯示';
COMMENT ON COLUMN event_session_fields.dashboard_role IS '看板角色：identity / lunch_total / parking_kind';

CREATE INDEX IF NOT EXISTS idx_event_session_fields_event_id ON event_session_fields(event_id);


-- ════════════════════════════════════════════════════════════
-- 4. 報名紀錄
-- ════════════════════════════════════════════════════════════

-- 報名主表
CREATE TABLE IF NOT EXISTS registrations (
  registration_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id           TEXT        REFERENCES students(student_id) ON DELETE SET NULL,  -- NULL = 訪客
  host_student_id      TEXT,       -- 訪客被誰代報（刻意不加 FK，避免 PostgREST PGRST201 歧義）
  answers              JSONB       NOT NULL DEFAULT '{}',
  is_driver            BOOLEAN     NOT NULL DEFAULT false,
  registered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at        TIMESTAMPTZ,
  checked_in_down_at   TIMESTAMPTZ,
  terminal             TEXT,
  source               TEXT        NOT NULL DEFAULT 'kiosk',
  pre_depart_override  BOOLEAN     NOT NULL DEFAULT false,
  late_return_override BOOLEAN     NOT NULL DEFAULT false,
  UNIQUE (event_id, student_id)
);

COMMENT ON COLUMN registrations.student_id           IS 'NULL = 訪客報名';
COMMENT ON COLUMN registrations.host_student_id      IS '代報者學員 ID（排車自動同車；刻意不加 FK）';
COMMENT ON COLUMN registrations.is_driver            IS '是否為司機（自開小車場景）';
COMMENT ON COLUMN registrations.updated_at           IS '最後異動時間（INSERT/UPDATE 都會更新）';
COMMENT ON COLUMN registrations.checked_in_at        IS '現場刷卡報到；上山方向其他交通也用此欄';
COMMENT ON COLUMN registrations.checked_in_down_at   IS '其他交通下山報到時間（上山用 checked_in_at）';
COMMENT ON COLUMN registrations.source               IS 'kiosk=前台刷卡 / walkin=報到頁現場補報 / manual=後台手動';
COMMENT ON COLUMN registrations.pre_depart_override  IS '師父手動標記提前出發（其他交通專用）';
COMMENT ON COLUMN registrations.late_return_override IS '師父手動標記延後回程';

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION touch_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registrations_touch ON registrations;
CREATE TRIGGER trg_registrations_touch
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION touch_registrations_updated_at();

CREATE INDEX IF NOT EXISTS idx_registrations_event_id   ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_student_id ON registrations(student_id);
CREATE INDEX IF NOT EXISTS idx_registrations_host       ON registrations(host_student_id, event_id) WHERE host_student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registrations_updated_at ON registrations(event_id, updated_at DESC);

-- 報名異動紀錄（LINE 推送用）
CREATE TABLE IF NOT EXISTS registration_changes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID,
  event_id        UUID        NOT NULL,
  event_name      TEXT        NOT NULL DEFAULT '',
  student_name    TEXT        NOT NULL DEFAULT '',
  change_type     TEXT        NOT NULL
                    CHECK (change_type IN ('created','modified','cancelled')),
  old_answers     JSONB,
  new_answers     JSONB,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reg_changes_event      ON registration_changes(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_changes_unnotified ON registration_changes(notified_at) WHERE notified_at IS NULL;

-- 多場次活動逐場報到紀錄
CREATE TABLE IF NOT EXISTS registration_session_checkins (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_id        UUID        NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id    UUID        NOT NULL REFERENCES event_sessions(session_id)     ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reg_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_rsc_reg_id     ON registration_session_checkins(reg_id);
CREATE INDEX IF NOT EXISTS idx_rsc_session_id ON registration_session_checkins(session_id);

COMMENT ON TABLE registration_session_checkins IS '多場次活動每場一筆報到紀錄（複合 UNIQUE = 同人同場不重複）';


-- ════════════════════════════════════════════════════════════
-- 5. 稽核日誌
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log (
  log_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action  TEXT,
  target  TEXT,
  ip      TEXT,
  at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 6. 法會功德主管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_donors (
  donor_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id  TEXT,
  name        TEXT        NOT NULL,
  donor_item  TEXT,
  seat        TEXT,
  corsage     TEXT,
  offering    TEXT,
  donor_note  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN event_donors.student_id IS 'NULL = 訪客型功德主；刻意不加 FK 避免 PostgREST 歧義';

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_student ON event_donors(event_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_guest   ON event_donors(event_id, name)       WHERE student_id IS NULL;
CREATE INDEX        IF NOT EXISTS idx_event_donors_event   ON event_donors(event_id);
CREATE INDEX        IF NOT EXISTS idx_event_donors_student ON event_donors(student_id) WHERE student_id IS NOT NULL;

CREATE OR REPLACE FUNCTION touch_event_donors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_donors_touch ON event_donors;
CREATE TRIGGER trg_event_donors_touch
  BEFORE UPDATE ON event_donors
  FOR EACH ROW EXECUTE FUNCTION touch_event_donors_updated_at();


-- ════════════════════════════════════════════════════════════
-- 7. 排車系統
-- ════════════════════════════════════════════════════════════

-- 車輛主表
CREATE TABLE IF NOT EXISTS car_assignments (
  car_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  car_name     TEXT        NOT NULL,
  seats        INT         NOT NULL DEFAULT 20,
  car_type     TEXT        NOT NULL DEFAULT 'large' CHECK (car_type IN ('large', 'small')),
  direction    TEXT        NOT NULL DEFAULT 'down'  CHECK (direction IN ('up', 'down')),
  note         TEXT,
  access_token TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sort_order   INT         NOT NULL DEFAULT 0,
  pre_depart   BOOLEAN     NOT NULL DEFAULT false,
  late_return  BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN car_assignments.direction   IS 'up=上山、down=下山';
COMMENT ON COLUMN car_assignments.pre_depart  IS '整車提前出發（上山）：從應到人數排除';
COMMENT ON COLUMN car_assignments.late_return IS '整車延後回程（下山）：從應到人數排除';

CREATE INDEX IF NOT EXISTS idx_car_assignments_event           ON car_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_direction ON car_assignments(event_id, direction);

-- 車輛成員（同人可同時出現在上山車與下山車）
CREATE TABLE IF NOT EXISTS car_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          UUID        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id UUID        NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ,
  UNIQUE (car_id, registration_id)
);

COMMENT ON COLUMN car_members.checked_in_at IS '領隊報到頁方向級別報到時間（上山/下山各自獨立）';

CREATE INDEX IF NOT EXISTS idx_car_members_car ON car_members(car_id);

-- 車輛領隊（每台車可多位）
CREATE TABLE IF NOT EXISTS car_leaders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          UUID NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (car_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_car_leaders_car ON car_leaders(car_id);

-- 總領隊 / 小車領隊
CREATE TABLE IF NOT EXISTS head_leader (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  registration_id UUID        REFERENCES registrations(registration_id) ON DELETE SET NULL,
  type            TEXT        NOT NULL DEFAULT 'all',
  access_token    TEXT        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  UNIQUE (event_id, type, registration_id)
);

COMMENT ON COLUMN head_leader.type IS 'all=總領隊、small_car=小車領隊（可多人）';


-- ════════════════════════════════════════════════════════════
-- 8. 法師管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS temple_monks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  notes      TEXT,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_monks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id        UUID        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  monk_id       UUID        NOT NULL REFERENCES temple_monks(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ,
  UNIQUE(car_id, monk_id)
);

CREATE INDEX IF NOT EXISTS idx_car_monks_car_id  ON car_monks(car_id);
CREATE INDEX IF NOT EXISTS idx_car_monks_monk_id ON car_monks(monk_id);


-- ════════════════════════════════════════════════════════════
-- 9. 關係連結（同車同行）
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS relationship_groups (
  group_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relationship_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES relationship_groups(group_id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_members_group   ON relationship_members(group_id);
CREATE INDEX IF NOT EXISTS idx_rel_members_student ON relationship_members(student_id);


-- ════════════════════════════════════════════════════════════
-- 10. 義工帳號管理
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS volunteer_profiles (
  id           UUID        PRIMARY KEY,
  email        TEXT        NOT NULL DEFAULT '',
  display_name TEXT        NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS volunteer_event_access (
  volunteer_id UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_id, event_id)
);


-- ════════════════════════════════════════════════════════════
-- 11. Row Level Security（RLS）啟用
-- ════════════════════════════════════════════════════════════

ALTER TABLE students                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_classes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_fields                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_templates               ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sessions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_session_fields          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_changes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_donors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_assignments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_members                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_leaders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE head_leader                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE temple_monks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_monks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_event_access        ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- 12. RLS Policies
-- ════════════════════════════════════════════════════════════

-- students
CREATE POLICY "anon can select students"            ON students        FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on students"        ON students        FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- student_classes
CREATE POLICY "anon can select student_classes"     ON student_classes FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on student_classes" ON student_classes FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- events（前台只看 active 活動）
CREATE POLICY "anon can select active events"       ON events          FOR SELECT TO anon          USING (status = 'active');
CREATE POLICY "auth full access on events"          ON events          FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_fields
CREATE POLICY "anon can select event_fields"        ON event_fields    FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on event_fields"    ON event_fields    FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_templates（僅後台）
CREATE POLICY "auth full access on event_templates" ON event_templates FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_sessions
CREATE POLICY "anon can select event_sessions"      ON event_sessions  FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on event_sessions"  ON event_sessions  FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_session_fields
CREATE POLICY "anon can select esf"                 ON event_session_fields FOR SELECT TO anon          USING (true);
CREATE POLICY "auth full access on esf"             ON event_session_fields FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- registrations
CREATE POLICY "anon can select registrations"       ON registrations   FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert registrations"       ON registrations   FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update registrations"       ON registrations   FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete registrations"       ON registrations   FOR DELETE TO anon USING (true);
CREATE POLICY "auth full access on registrations"   ON registrations   FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- registration_changes（anon 只能 insert）
CREATE POLICY "anon can insert changes"             ON registration_changes FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth full access on changes"         ON registration_changes FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- registration_session_checkins
CREATE POLICY "auth full access on rsc"             ON registration_session_checkins FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- audit_log
CREATE POLICY "auth full access on audit_log"       ON audit_log       FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- event_donors
CREATE POLICY "anon can select event_donors"        ON event_donors    FOR SELECT TO anon USING (true);
CREATE POLICY "anon can insert event_donors"        ON event_donors    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon can update event_donors"        ON event_donors    FOR UPDATE TO anon USING (true);
CREATE POLICY "anon can delete event_donors"        ON event_donors    FOR DELETE TO anon USING (true);
CREATE POLICY "auth full access on event_donors"    ON event_donors    FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_assignments（anon 可讀：領隊報到頁）
CREATE POLICY "anon can read car_assignments"       ON car_assignments FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on car_assignments" ON car_assignments FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_members（anon 可讀 + 更新 checked_in_at）
CREATE POLICY "anon can read car_members"           ON car_members     FOR SELECT TO anon USING (true);
CREATE POLICY "anon can update car_members"         ON car_members     FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on car_members"     ON car_members     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_leaders（anon 可讀）
CREATE POLICY "anon can read car_leaders"           ON car_leaders     FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on car_leaders"     ON car_leaders     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- head_leader（anon 可讀：/leader 掃卡頁）
CREATE POLICY "anon can select head_leader"         ON head_leader     FOR SELECT TO anon USING (true);
CREATE POLICY "auth full access on head_leader"     ON head_leader     FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- temple_monks（anon 唯讀）
CREATE POLICY "temple_monks_anon_read"              ON temple_monks    FOR SELECT TO anon          USING (true);
CREATE POLICY "temple_monks_auth_all"               ON temple_monks    FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- car_monks（anon 可讀 + 更新，領隊頁打卡用）
CREATE POLICY "car_monks_anon_select"               ON car_monks       FOR SELECT TO anon USING (true);
CREATE POLICY "car_monks_anon_update"               ON car_monks       FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "car_monks_auth_all"                  ON car_monks       FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- relationship
CREATE POLICY "auth full access on rel_groups"      ON relationship_groups  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on rel_members"     ON relationship_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- volunteer
CREATE POLICY "auth full access on vol_profiles"    ON volunteer_profiles     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth full access on vol_access"      ON volunteer_event_access FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ════════════════════════════════════════════════════════════
-- 13. GRANT 權限
-- ════════════════════════════════════════════════════════════

-- anon（前台、領隊報到頁）
GRANT SELECT                         ON students                      TO anon;
GRANT SELECT                         ON student_classes               TO anon;
GRANT SELECT                         ON events                        TO anon;
GRANT SELECT                         ON event_fields                  TO anon;
GRANT SELECT                         ON event_sessions                TO anon;
GRANT SELECT                         ON event_session_fields          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON registrations                 TO anon;
GRANT INSERT                         ON registration_changes          TO anon;
GRANT SELECT                         ON car_assignments               TO anon;
GRANT SELECT, UPDATE                 ON car_members                   TO anon;
GRANT SELECT                         ON car_leaders                   TO anon;
GRANT SELECT                         ON head_leader                   TO anon;
GRANT SELECT                         ON temple_monks                  TO anon;
GRANT SELECT, UPDATE                 ON car_monks                     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors                  TO anon;

-- authenticated（師父 / 義工後台）
GRANT ALL ON students                      TO authenticated;
GRANT ALL ON student_classes               TO authenticated;
GRANT ALL ON events                        TO authenticated;
GRANT ALL ON event_fields                  TO authenticated;
GRANT ALL ON event_templates               TO authenticated;
GRANT ALL ON event_sessions                TO authenticated;
GRANT ALL ON event_session_fields          TO authenticated;
GRANT ALL ON registrations                 TO authenticated;
GRANT ALL ON registration_changes          TO authenticated;
GRANT ALL ON registration_session_checkins TO authenticated;
GRANT ALL ON audit_log                     TO authenticated;
GRANT ALL ON event_donors                  TO authenticated;
GRANT ALL ON car_assignments               TO authenticated;
GRANT ALL ON car_members                   TO authenticated;
GRANT ALL ON car_leaders                   TO authenticated;
GRANT ALL ON head_leader                   TO authenticated;
GRANT ALL ON temple_monks                  TO authenticated;
GRANT ALL ON car_monks                     TO authenticated;
GRANT ALL ON relationship_groups           TO authenticated;
GRANT ALL ON relationship_members          TO authenticated;
GRANT ALL ON volunteer_profiles            TO authenticated;
GRANT ALL ON volunteer_event_access        TO authenticated;

-- service_role（備份腳本用）
GRANT ALL ON event_sessions                TO service_role;
GRANT ALL ON registration_session_checkins TO service_role;
GRANT ALL ON event_session_fields          TO service_role;

-- sequence 權限
GRANT USAGE, SELECT ON SEQUENCE student_classes_id_seq TO authenticated;


-- ════════════════════════════════════════════════════════════
-- 14. 預設模板（回山 + 精舍）
-- ════════════════════════════════════════════════════════════

INSERT INTO event_templates (name, sort_order, session_fields, fields) VALUES

('回山模板', 1, '[]'::jsonb, '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求","dashboard_role":null,"option_meta":null}
]'::jsonb),

('精舍模板', 2, '[]'::jsonb, '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"lunch_total","option_meta":null},
  {"field_key":"parking_type","field_label":"停車方式","field_type":"radio","options":["不需要","機車","轎車"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"parking_kind","option_meta":{"不需要":"none","機車":"motorcycle","轎車":"car"}},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null}
]'::jsonb)

ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- 15. 師父帳號角色設定（執行完 schema 後再做）
-- ════════════════════════════════════════════════════════════
--
-- ① 先到 Supabase → Authentication → Users → 「Add user」
--    建立師父的 email + 密碼帳號（勾 Auto Confirm）
--
-- ② 執行以下 SQL，把下方 email 改成師父帳號：
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_set(
--   COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"admin"'
-- )
-- WHERE email = 'your-email@example.com';
--
-- ③ 若需要義工共用帳號，同樣先 Add user，再執行：
--
-- UPDATE auth.users
-- SET raw_user_meta_data = jsonb_set(
--   COALESCE(raw_user_meta_data, '{}'::jsonb), '{role}', '"volunteer"'
-- )
-- WHERE email = 'volunteer@your.branch';


-- ════════════════════════════════════════════════════════════
-- 完成！執行後用以下查詢確認所有資料表已建立（應看到 22 張）：
--
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- ════════════════════════════════════════════════════════════

COMMENT ON TABLE registration_session_checkins IS '多場次活動每場一筆報到紀錄（複合 UNIQUE = 同人同場不重複）';


-- ------------------------------------------------------------
-- [2/81] admin_setup.sql
-- ------------------------------------------------------------
-- ══════════════════════════════════════════════
-- 後台管理頁面 — 一次性設定 SQL
-- 在 Supabase Dashboard → SQL Editor 執行
-- ══════════════════════════════════════════════

-- 1. 替 registrations 加入「報到時間」欄位
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- 2. 確認 anon 角色對 students 有 SELECT 權限
GRANT SELECT ON students TO anon;
GRANT SELECT ON student_classes TO anon;

-- 3. authenticated 角色（師父登入後）對 registrations 可 UPDATE
--    （通常已包含在 RLS policy，這裡補一道 GRANT 確保無誤）
GRANT UPDATE ON registrations TO authenticated;

-- ── 完成後可用以下查詢確認欄位存在 ──
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'registrations'
-- ORDER BY ordinal_position;

-- ------------------------------------------------------------
-- [3/81] role_setup.sql
-- ------------------------------------------------------------
-- ============================================================
-- 後台角色設定 — 普宜精舍報名系統
-- 執行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 步驟 1：設定師父帳號為 admin ──────────────────────────────
-- （請確認 puyi23282@gmail.com 已可正常登入後台）

UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE email = 'puyi23282@gmail.com';

-- 執行後應顯示 "1 row affected"
-- 若 0 row affected，表示帳號 email 不符，請到 Authentication → Users 確認正確 email


-- ── 步驟 2：建立義工共用帳號 ──────────────────────────────────
-- 請先到 Supabase Dashboard → Authentication → Users → 右上角「Add user」
-- 填入以下資料（建議）：
--   Email   : volunteer@puyi.reg  （虛擬信箱，不會真的寄信）
--   Password : 自訂，現場告知義工知識長
--   勾選 "Auto Confirm User"（不需驗證信）
-- 建立完成後，執行下方 SQL 設定義工角色：

UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{role}',
  '"volunteer"'
)
WHERE email = 'volunteer@puyi.reg';
-- 若用不同 email，請把上面的 email 改成實際填入的


-- ── 驗證：確認兩個帳號角色都設定正確 ──────────────────────────
SELECT email,
       raw_app_meta_data->>'role' AS role
FROM auth.users
WHERE email IN ('puyi23282@gmail.com', 'volunteer@puyi.reg')
ORDER BY email;
-- 應該看到：
--   nirvana1050408@gmail.com (如果有) | admin
--   puyi23282@gmail.com               | admin
--   volunteer@puyi.reg                | volunteer

-- ------------------------------------------------------------
-- [4/81] volunteer_access_setup.sql
-- ------------------------------------------------------------
-- ============================================================
-- 義工存取設定 — 建立所需資料表
-- 請在 Supabase SQL Editor 執行此檔案
-- ============================================================

-- 1. 義工帳號資料表
--    義工登入後台時自動同步 email / display_name，
--    讓師父可在後台介面看到義工清單。
CREATE TABLE IF NOT EXISTS volunteer_profiles (
  id           UUID PRIMARY KEY,
  email        TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE volunteer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "volunteer_profiles: authenticated 可讀寫"
  ON volunteer_profiles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON volunteer_profiles TO authenticated;

-- 2. 義工活動存取表
--    記錄哪位義工可以看到哪場活動。
CREATE TABLE IF NOT EXISTS volunteer_event_access (
  volunteer_id UUID NOT NULL,
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  PRIMARY KEY (volunteer_id, event_id)
);

ALTER TABLE volunteer_event_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "volunteer_event_access: authenticated 完整存取"
  ON volunteer_event_access FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON volunteer_event_access TO authenticated;

-- ------------------------------------------------------------
-- [5/81] monk_setup.sql
-- ------------------------------------------------------------
-- ═══════════════════════════════════════════════════════
--  法師管理系統 — monk_setup.sql
--  執行前提：car_assignment_setup.sql 已執行（car_assignments 表存在）
-- ═══════════════════════════════════════════════════════

-- ─── 1. temple_monks — 法師名單 ────────────────────────
CREATE TABLE IF NOT EXISTS temple_monks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  notes       text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. car_monks — 每台車的法師指派 + 報到狀態 ────────
CREATE TABLE IF NOT EXISTS car_monks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id         uuid        NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  monk_id        uuid        NOT NULL REFERENCES temple_monks(id) ON DELETE CASCADE,
  checked_in_at  timestamptz,
  UNIQUE(car_id, monk_id)
);

CREATE INDEX IF NOT EXISTS idx_car_monks_car_id  ON car_monks(car_id);
CREATE INDEX IF NOT EXISTS idx_car_monks_monk_id ON car_monks(monk_id);

-- ─── 3. RLS ────────────────────────────────────────────
ALTER TABLE temple_monks ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_monks    ENABLE ROW LEVEL SECURITY;

-- 先刪舊 Policy，再重建（schema.sql 的「8. 法師管理」已經建過一次，避免 42710 衝突）
DROP POLICY IF EXISTS "temple_monks_auth_all"  ON temple_monks;
DROP POLICY IF EXISTS "temple_monks_anon_read" ON temple_monks;
DROP POLICY IF EXISTS "car_monks_auth_all"     ON car_monks;
DROP POLICY IF EXISTS "car_monks_anon_select"  ON car_monks;
DROP POLICY IF EXISTS "car_monks_anon_update"  ON car_monks;

-- temple_monks：登入者完整存取，anon 唯讀
CREATE POLICY "temple_monks_auth_all"  ON temple_monks FOR ALL       TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "temple_monks_anon_read" ON temple_monks FOR SELECT    TO anon           USING (true);

-- car_monks：登入者完整存取，anon 可讀 + 可更新（供領隊頁打卡）
CREATE POLICY "car_monks_auth_all"     ON car_monks FOR ALL          TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "car_monks_anon_select"  ON car_monks FOR SELECT       TO anon           USING (true);
CREATE POLICY "car_monks_anon_update"  ON car_monks FOR UPDATE       TO anon           USING (true) WITH CHECK (true);

-- ─── 4. GRANT ──────────────────────────────────────────
GRANT SELECT               ON temple_monks TO anon;
GRANT SELECT, UPDATE       ON car_monks    TO anon;
GRANT ALL                  ON temple_monks TO authenticated;
GRANT ALL                  ON car_monks    TO authenticated;

-- ------------------------------------------------------------
-- [6/81] relationship_setup.sql
-- ------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════
-- 批次 C：關係連結系統
-- 執行前提：students 資料表已存在
-- ═══════════════════════════════════════════════════════════

-- 1. 群組表
CREATE TABLE IF NOT EXISTS relationship_groups (
  group_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  note       text,
  created_at timestamptz DEFAULT now()
);

-- 2. 群組成員表
CREATE TABLE IF NOT EXISTS relationship_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES relationship_groups(group_id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (group_id, student_id)
);

-- 索引：依群組查成員
CREATE INDEX IF NOT EXISTS idx_rel_members_group
  ON relationship_members (group_id);

-- 索引：依學員查所屬群組
CREATE INDEX IF NOT EXISTS idx_rel_members_student
  ON relationship_members (student_id);

-- 3. 啟用 RLS
ALTER TABLE relationship_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_members ENABLE ROW LEVEL SECURITY;

-- 4. RLS 政策
--   anon（前台）：不需存取
--   authenticated（師父/義工）：完整存取

CREATE POLICY "authenticated can manage relationship_groups"
  ON relationship_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage relationship_members"
  ON relationship_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON relationship_groups  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON relationship_members TO authenticated;

-- ------------------------------------------------------------
-- [7/81] registration_tracking_setup.sql
-- ------------------------------------------------------------
-- registration_tracking_setup.sql
-- 報名異動追蹤功能
-- 請在 Supabase SQL Editor 執行此檔

-- ── ① 異動紀錄表 registration_changes ────────────────────────
CREATE TABLE IF NOT EXISTS registration_changes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid,                            -- 異動的報名 ID（取消後仍保留供參考）
  event_id         uuid        NOT NULL,
  event_name       text        NOT NULL DEFAULT '',  -- 活動名稱快照（不需 JOIN）
  student_name     text        NOT NULL DEFAULT '',  -- 學員/訪客姓名快照
  change_type      text        NOT NULL              -- 'created' | 'modified' | 'cancelled'
                   CHECK (change_type IN ('created','modified','cancelled')),
  old_answers      jsonb,                            -- 修改/取消前的答案
  new_answers      jsonb,                            -- 新增/修改後的答案
  changed_at       timestamptz NOT NULL DEFAULT now(),
  notified_at      timestamptz                       -- LINE 推送後標記，NULL = 尚未通知
);

CREATE INDEX IF NOT EXISTS idx_reg_changes_event
  ON registration_changes(event_id);

CREATE INDEX IF NOT EXISTS idx_reg_changes_unnotified
  ON registration_changes(notified_at) WHERE notified_at IS NULL;

-- RLS
ALTER TABLE registration_changes ENABLE ROW LEVEL SECURITY;

-- 先刪舊 Policy，再重建（schema.sql 已經建過一次，避免 42710 衝突）
DROP POLICY IF EXISTS "anon can insert changes" ON registration_changes;
DROP POLICY IF EXISTS "authenticated full access on changes" ON registration_changes;

-- anon（前台學員刷卡）：只能新增
CREATE POLICY "anon can insert changes"
  ON registration_changes FOR INSERT TO anon WITH CHECK (true);

-- authenticated（師父後台）：完整存取
CREATE POLICY "authenticated full access on changes"
  ON registration_changes FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT INSERT ON registration_changes TO anon;
GRANT ALL ON registration_changes TO authenticated;

-- ── ② events 加 last_exported_at（最後一次匯出時間）────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS last_exported_at timestamptz;

-- ── ③ registrations 加 updated_at + 自動更新 trigger ──────────
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION update_registrations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrations_updated_at ON registrations;
CREATE TRIGGER trg_registrations_updated_at
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION update_registrations_updated_at();

-- ------------------------------------------------------------
-- [8/81] cancel_registration_setup.sql
-- ------------------------------------------------------------
-- ══════════════════════════════════════════════
-- 取消報名功能 — 補 DELETE 權限
-- 在 Supabase Dashboard → SQL Editor 執行一次即可
-- ══════════════════════════════════════════════

-- 允許登入的師父（authenticated）刪除報名紀錄
GRANT DELETE ON registrations TO authenticated;

-- 允許前台匿名使用者（anon）刪除報名紀錄（學員自助取消）
GRANT DELETE ON registrations TO anon;

-- anon DELETE 的 RLS 政策（允許刪除任何報名紀錄，schema.sql 已經建過一次，先刪再建避免 42710）
DROP POLICY IF EXISTS "anon can delete registrations" ON registrations;
CREATE POLICY "anon can delete registrations"
  ON registrations FOR DELETE TO anon
  USING (true);

-- ------------------------------------------------------------
-- [9/81] guest_registration_setup.sql
-- ------------------------------------------------------------
-- ══════════════════════════════════════════════
-- 訪客報名功能 — 資料庫調整
-- 在 Supabase Dashboard → SQL Editor 執行一次即可
-- ══════════════════════════════════════════════

-- 1. 允許 student_id 為 NULL（訪客沒有學員帳號）
ALTER TABLE registrations ALTER COLUMN student_id DROP NOT NULL;

-- ------------------------------------------------------------
-- [10/81] batch_e_setup.sql
-- ------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════
-- 批次 E：領隊報到頁
-- 讓 anon（公開領隊頁）能夠讀取排車資料
-- 執行前提：car_arrangement_setup.sql 已執行
-- ═══════════════════════════════════════════════════════════

-- 先刪舊 Policy，再重建（schema.sql 已經建過一次，避免 42710 衝突）
DROP POLICY IF EXISTS "anon can read car_assignments" ON car_assignments;
DROP POLICY IF EXISTS "anon can read car_members"     ON car_members;
DROP POLICY IF EXISTS "anon can read car_leaders"     ON car_leaders;

-- 1. car_assignments：anon 可讀（token 驗證在應用層）
CREATE POLICY "anon can read car_assignments"
  ON car_assignments FOR SELECT TO anon USING (true);

-- 2. car_members：anon 可讀
CREATE POLICY "anon can read car_members"
  ON car_members FOR SELECT TO anon USING (true);

-- 3. car_leaders：anon 可讀
CREATE POLICY "anon can read car_leaders"
  ON car_leaders FOR SELECT TO anon USING (true);

-- 4. head_leader：anon 可讀（下面 create policy 已用 IF NOT EXISTS 條件式保護，這裡不用）
CREATE POLICY "anon can read head_leader"
  ON head_leader FOR SELECT TO anon USING (true);

-- 5. GRANT SELECT
GRANT SELECT ON car_assignments TO anon;
GRANT SELECT ON car_members     TO anon;
GRANT SELECT ON car_leaders     TO anon;
GRANT SELECT ON head_leader     TO anon;

-- 6. 確保 anon 可以更新 registrations.checked_in_at（若已存在則忽略錯誤）
--    領隊報到頁需要直接更新報到狀態
GRANT SELECT, INSERT, UPDATE ON registrations TO anon;

-- ------------------------------------------------------------
-- [11/81] car_arrangement_setup.sql
-- ------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════
-- 批次 D：排車系統
-- 執行前提：events、registrations、students 資料表已存在
-- ═══════════════════════════════════════════════════════════

-- 1. 車輛表（每台車的基本資料）
CREATE TABLE IF NOT EXISTS car_assignments (
  car_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  car_name     text        NOT NULL,
  seats        int         NOT NULL DEFAULT 20,
  car_type     text        NOT NULL DEFAULT 'large' CHECK (car_type IN ('large', 'small')),
  note         text,
  access_token text        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

-- 2. 車輛成員表（每人只能在一台車）
CREATE TABLE IF NOT EXISTS car_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          uuid NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (registration_id)   -- 一人只能在一台車
);

-- 3. 領隊表（每台車可有多位領隊）
CREATE TABLE IF NOT EXISTS car_leaders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id          uuid NOT NULL REFERENCES car_assignments(car_id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  UNIQUE (car_id, registration_id)
);

-- 4. 總領隊表（每場活動一位）
CREATE TABLE IF NOT EXISTS head_leader (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  registration_id uuid        REFERENCES registrations(registration_id) ON DELETE SET NULL,
  access_token    text        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  UNIQUE (event_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_car_assignments_event ON car_assignments (event_id);
CREATE INDEX IF NOT EXISTS idx_car_members_car       ON car_members (car_id);
CREATE INDEX IF NOT EXISTS idx_car_leaders_car       ON car_leaders (car_id);

-- 5. 啟用 RLS
ALTER TABLE car_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_leaders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE head_leader     ENABLE ROW LEVEL SECURITY;

-- 6. RLS 政策（authenticated = 師父/義工；anon = 前台，不需存取）
CREATE POLICY "authenticated can manage car_assignments"
  ON car_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage car_members"
  ON car_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage car_leaders"
  ON car_leaders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can manage head_leader"
  ON head_leader FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON car_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON car_members     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON car_leaders     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON head_leader     TO authenticated;

-- ------------------------------------------------------------
-- [12/81] small_car_leader_setup.sql
-- ------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════
-- 小車領隊設定 — head_leader 表結構更新
-- 執行時機：批次 F 部署前
-- ═══════════════════════════════════════════════════════════

-- Step 1：加入 type 欄位（預設 'all'，向下相容既有資料）
ALTER TABLE head_leader
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'all';

-- Step 2：確保現有資料都有正確的 type 值
UPDATE head_leader SET type = 'all' WHERE type IS NULL OR type = '';

-- Step 3：移除原本只針對 event_id 的 unique constraint
--         （允許同一活動同時有 'all' 和 'small_car' 兩筆）
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'head_leader'::regclass
    AND contype = 'u'
    AND conkey = ARRAY(
      SELECT attnum
      FROM pg_attribute
      WHERE attrelid = 'head_leader'::regclass
        AND attname = 'event_id'
        AND NOT attisdropped
    );

  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE head_leader DROP CONSTRAINT ' || quote_ident(c_name);
    RAISE NOTICE '已移除舊約束 %', c_name;
  ELSE
    RAISE NOTICE '未找到僅 event_id 的 unique 約束（可能已更新）';
  END IF;
END $$;

-- Step 4：加入新的複合 unique constraint
ALTER TABLE head_leader
  DROP CONSTRAINT IF EXISTS head_leader_event_id_type_key;

ALTER TABLE head_leader
  ADD CONSTRAINT head_leader_event_id_type_key UNIQUE (event_id, type);

-- Step 5：確保 anon 可讀取（/leader 掃卡頁面需要）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'head_leader'
      AND policyname = 'anon can select head_leader'
  ) THEN
    CREATE POLICY "anon can select head_leader"
      ON head_leader FOR SELECT TO anon USING (true);
    RAISE NOTICE '已建立 anon SELECT policy';
  ELSE
    RAISE NOTICE 'anon SELECT policy 已存在，略過';
  END IF;
END $$;

-- Step 6：確保 anon 可讀 car_leaders（findLeaderByStudentId 需要）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'car_leaders'
      AND policyname = 'anon can select car_leaders'
  ) THEN
    CREATE POLICY "anon can select car_leaders"
      ON car_leaders FOR SELECT TO anon USING (true);
    RAISE NOTICE '已建立 car_leaders anon SELECT policy';
  ELSE
    RAISE NOTICE 'car_leaders anon SELECT policy 已存在，略過';
  END IF;
END $$;

GRANT SELECT ON head_leader TO anon;
GRANT SELECT ON car_leaders TO anon;
GRANT SELECT ON car_assignments TO anon;
GRANT SELECT ON car_members TO anon;

-- ------------------------------------------------------------
-- [13/81] add_direction_to_car_assignments.sql
-- ------------------------------------------------------------
-- 批次 4：上下山分開排車
-- 為 car_assignments 新增 direction 欄位（'up' = 上山、'down' = 下山）
-- 現有資料一律視為「下山」(回山法會結束後分車回家)

-- Step 1：加欄位（先允許 NULL 才能無痛加到既有資料）
ALTER TABLE car_assignments
  ADD COLUMN IF NOT EXISTS direction text;

-- Step 2：把現有 NULL 全部設為 'down'
UPDATE car_assignments
   SET direction = 'down'
 WHERE direction IS NULL;

-- Step 3：補上 NOT NULL + CHECK + DEFAULT
ALTER TABLE car_assignments
  ALTER COLUMN direction SET NOT NULL,
  ALTER COLUMN direction SET DEFAULT 'down';

-- 移除舊的 CHECK（若存在）並重建
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'car_assignments_direction_check'
  ) THEN
    ALTER TABLE car_assignments DROP CONSTRAINT car_assignments_direction_check;
  END IF;
END $$;

ALTER TABLE car_assignments
  ADD CONSTRAINT car_assignments_direction_check
  CHECK (direction IN ('up', 'down'));

-- Step 4：補上索引（依 event_id + direction 查詢頻繁）
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_direction
  ON car_assignments (event_id, direction);

-- 確認
SELECT direction, COUNT(*) FROM car_assignments GROUP BY direction;

-- ------------------------------------------------------------
-- [14/81] fix_unique_for_direction.sql
-- ------------------------------------------------------------
-- 批次 4 修正：上下山分開排車後，同一個 registration_id 會同時存在上山與下山兩台車
-- 原本 car_members.registration_id 是全域唯一，要改成「同車內唯一」
-- 同步處理 car_leaders、car_monks（避免同一人/法師同時做兩個方向領隊或搭兩台車時也出錯）

-- ─── 1. car_members ────────────────────────────────────────
ALTER TABLE car_members DROP CONSTRAINT IF EXISTS car_members_registration_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_members_car_registration_unique'
  ) THEN
    ALTER TABLE car_members
      ADD CONSTRAINT car_members_car_registration_unique
      UNIQUE (car_id, registration_id);
  END IF;
END $$;

-- ─── 2. car_leaders ────────────────────────────────────────
ALTER TABLE car_leaders DROP CONSTRAINT IF EXISTS car_leaders_registration_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_leaders_car_registration_unique'
  ) THEN
    ALTER TABLE car_leaders
      ADD CONSTRAINT car_leaders_car_registration_unique
      UNIQUE (car_id, registration_id);
  END IF;
END $$;

-- ─── 3. car_monks ──────────────────────────────────────────
ALTER TABLE car_monks DROP CONSTRAINT IF EXISTS car_monks_monk_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_monks_car_monk_unique'
  ) THEN
    ALTER TABLE car_monks
      ADD CONSTRAINT car_monks_car_monk_unique
      UNIQUE (car_id, monk_id);
  END IF;
END $$;

-- 確認
SELECT conname, conrelid::regclass AS table_name
  FROM pg_constraint
 WHERE conrelid IN ('car_members'::regclass, 'car_leaders'::regclass, 'car_monks'::regclass)
   AND contype = 'u';

-- ------------------------------------------------------------
-- [15/81] add_car_member_checkin.sql
-- ------------------------------------------------------------
-- 上下山各自獨立報到狀態
-- 2026-05-23
--
-- 背景：原本 checked_in_at 存在 registrations 表（每人每活動一筆），
--       上山報到後下山也會顯示「已到」。
--       改為在 car_members 加方向級別的 checked_in_at，
--       CarCheckinPage 改讀此欄，reportCounts 也從 car_members 計算。
--
-- registrations.checked_in_at 保留（KioskPage / CheckinPage 現場報到仍用）。

ALTER TABLE car_members
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

COMMENT ON COLUMN car_members.checked_in_at
  IS '領隊報到頁方向級別報到時間（上山/下山各自獨立）；
      registrations.checked_in_at 由 KioskPage 現場刷卡報到使用，兩者獨立。';

-- 其他交通（不歸大小車）的下山報到獨立欄位
-- 上山繼續用原 checked_in_at，下山用此欄
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS checked_in_down_at TIMESTAMPTZ;

COMMENT ON COLUMN registrations.checked_in_down_at
  IS '「其他交通」成員下山報到時間（上山用 checked_in_at，下山用此欄）';

-- ------------------------------------------------------------
-- [16/81] add_pre_depart.sql
-- ------------------------------------------------------------
-- 新增小車（及大車）提前出發旗標
-- 2026-05-21 二度

ALTER TABLE car_assignments
  ADD COLUMN IF NOT EXISTS pre_depart BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN car_assignments.pre_depart IS '提前出發旗標：勾選後總領隊看板顯示「提前出發」badge，並從當天應到人數中排除';

-- ------------------------------------------------------------
-- [17/81] add_late_return.sql
-- ------------------------------------------------------------
-- 新增小車「延後回程」旗標 + 個人提前/延後覆寫欄位
-- 2026-05-22
--
-- 設計：
--   car_assignments.late_return       — 小車整車延後回程（對稱 pre_depart）
--   registrations.pre_depart_override — 個人手動標記提前（其他交通的人用，因為不歸任何車）
--   registrations.late_return_override— 個人手動標記延後
--
-- 自動判別仍走 answers 掃描（getPreArriveInfo / getLateReturnInfo），
-- override 欄位專門讓師父在後台排車頁手動補標（尤其其他交通的人）。

ALTER TABLE car_assignments
  ADD COLUMN IF NOT EXISTS late_return BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN car_assignments.late_return IS '延後回程旗標：勾選後總領隊看板顯示「延後回程」badge，並從當天應到人數中排除（下山方向用）';

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS pre_depart_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_return_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN registrations.pre_depart_override IS '師父手動標記此人為提前出發（其他交通的人專用，因為不歸任何車）';
COMMENT ON COLUMN registrations.late_return_override IS '師父手動標記此人為延後回程';

-- ------------------------------------------------------------
-- [18/81] add_field_types.sql
-- ------------------------------------------------------------
-- ============================================================
-- 新增欄位類型：plate（車牌）、datetime（日期時間）
-- 請在 Supabase SQL Editor 執行此檔案
-- ============================================================

-- 方案一：若 field_type 是 PostgreSQL 原生 enum 類型
-- （大多數情況請先試這個）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'field_type'
  ) THEN
    ALTER TYPE field_type ADD VALUE IF NOT EXISTS 'plate';
    ALTER TYPE field_type ADD VALUE IF NOT EXISTS 'datetime';
    RAISE NOTICE '✅ 已新增 plate、datetime 到 field_type enum';
  ELSE
    RAISE NOTICE '⚠️  找不到 field_type enum，請改用方案二';
  END IF;
END
$$;

-- ============================================================
-- 方案二：若 field_type 是 TEXT + CHECK constraint
-- 若方案一執行後沒效果，請把下方三行取消註解再執行
-- ============================================================
-- ALTER TABLE event_fields DROP CONSTRAINT IF EXISTS event_fields_field_type_check;
-- ALTER TABLE event_fields
--   ADD CONSTRAINT event_fields_field_type_check
--   CHECK (field_type IN ('radio', 'checkbox', 'text', 'date', 'time', 'plate', 'datetime'));

-- ------------------------------------------------------------
-- [19/81] add_boolean_field_type.sql
-- ------------------------------------------------------------
-- 更新 event_fields.field_type CHECK 約束，加入 boolean 類型
-- 在 Supabase Dashboard → SQL Editor 執行此檔

ALTER TABLE event_fields
DROP CONSTRAINT IF EXISTS event_fields_field_type_check;

ALTER TABLE event_fields
ADD CONSTRAINT event_fields_field_type_check
CHECK (field_type IN ('radio', 'checkbox', 'boolean', 'text', 'date', 'time', 'plate', 'datetime'));

-- ------------------------------------------------------------
-- [20/81] add_date_field_type.sql
-- ------------------------------------------------------------
-- 更新 event_fields.field_type 的 CHECK 約束，加入 date 與 time 型別
-- 在 Supabase SQL Editor 執行一次即可

-- 先刪除舊的 CHECK 約束（名稱可能因建立方式不同而異，兩條都試一下）
ALTER TABLE event_fields DROP CONSTRAINT IF EXISTS event_fields_field_type_check;
ALTER TABLE event_fields DROP CONSTRAINT IF EXISTS field_type_check;

-- 重建 CHECK 約束（含所有現有型別 + date + time）
ALTER TABLE event_fields
  ADD CONSTRAINT event_fields_field_type_check
  CHECK (field_type IN (
    'radio', 'checkbox', 'text', 'date', 'time', 'datetime',
    'boolean', 'plate'
  ));

-- ------------------------------------------------------------
-- [21/81] add_event_type.sql
-- ------------------------------------------------------------
-- ══════════════════════════════════════════════════════════
-- Phase 1：events 加活動類型 / 法會旗標
-- 並升級精舍模板，把停車方式改為 radio（不需要 / 機車 / 轎車）
-- 在 Supabase SQL Editor 執行一次
-- ══════════════════════════════════════════════════════════

-- ── 1. events 加兩個欄位 ────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'mountain'
    CHECK (event_type IN ('temple', 'mountain'));

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_dharma BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.event_type IS '活動類型：temple=精舍活動、mountain=回山活動';
COMMENT ON COLUMN events.is_dharma  IS '是否為法會（控制功德主管理顯示）';

-- ── 2. 升級精舍模板：parking_type 改為 radio ────────────────

UPDATE event_templates
SET fields = '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"parking_type","field_label":"停車方式","field_type":"radio","options":["不需要","機車","轎車"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null}
]'::jsonb
WHERE name = '精舍模板';

-- ── 3. 確認執行結果（執行後可貼上跑一下看欄位是否都到齊） ────
-- SELECT event_type, is_dharma FROM events LIMIT 1;
-- SELECT name, fields FROM event_templates WHERE name = '精舍模板';

-- ------------------------------------------------------------
-- [22/81] add_host_student_id.sql
-- ------------------------------------------------------------
-- ══════════════════════════════════════════════════════════
-- Phase 2：registrations 加 host_student_id
-- 用於「學員代親友報名」的關聯：
--   親友 reg：student_id = NULL（仍是訪客模式）
--             host_student_id = 代報者學員編號
-- 排車邏輯依 host_student_id 自動把親友與代報者塞同車。
-- 在 Supabase SQL Editor 執行一次。
--
-- 注意：刻意「不加 FK 約束」(REFERENCES students)
--   原因：registrations 已有 student_id FK 指向 students，
--         若 host_student_id 也加 FK 指向 students，PostgREST
--         會看到兩個 FK 都指向 students，所有 nested
--         `students(...)` 查詢會撞 PGRST201（歧義 FK）整個炸掉。
--   結果：欄位仍可 INSERT/UPDATE 任意 student_id；前端寫入時
--         保證帶有效 ID，DB 層僅做 index 與儲存。
-- ══════════════════════════════════════════════════════════

-- 新增欄位（不含 FK 約束，避免 PostgREST 歧義 FK 問題）
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS host_student_id TEXT NULL;

COMMENT ON COLUMN registrations.host_student_id IS
  '若為訪客且由某學員代報，記錄代報者 student_id（用於排車自動同車）。刻意不加 FK 避免 PostgREST PGRST201 歧義 FK 錯誤';

-- 加索引（排車要依 event_id + host_student_id 撈出親友群）
CREATE INDEX IF NOT EXISTS idx_registrations_host
  ON registrations(host_student_id, event_id)
  WHERE host_student_id IS NOT NULL;

-- ── 確認執行結果 ────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'registrations' AND column_name = 'host_student_id';

-- ------------------------------------------------------------
-- [23/81] add_placeholder_column.sql
-- ------------------------------------------------------------
-- 在 event_fields 加入 placeholder 欄位（text 欄位的灰底提示文字）
ALTER TABLE event_fields ADD COLUMN IF NOT EXISTS placeholder text;

-- ------------------------------------------------------------
-- [24/81] add_activities_fields.sql
-- ------------------------------------------------------------
-- 活動介紹頁相關欄位 (2026-05-25)
-- 執行方式：在 Supabase Dashboard > SQL Editor 貼上執行

-- 1. events 表新增欄位
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS show_on_activities BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS offline_registration BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_tag TEXT DEFAULT 'zhongtai',
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. 建立 Storage bucket（已存在則略過）
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-covers', 'event-covers', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage 存取政策（先刪再建，避免重複執行報錯）
DROP POLICY IF EXISTS "allow_auth_upload"  ON storage.objects;
DROP POLICY IF EXISTS "allow_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "allow_auth_update"  ON storage.objects;
DROP POLICY IF EXISTS "allow_auth_delete"  ON storage.objects;

-- 已登入使用者可上傳
CREATE POLICY "allow_auth_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'event-covers');

-- 所有人可讀取（公開介紹頁用）
CREATE POLICY "allow_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'event-covers');

-- 已登入使用者可更新
CREATE POLICY "allow_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'event-covers');

-- 已登入使用者可刪除
CREATE POLICY "allow_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'event-covers');

-- ------------------------------------------------------------
-- [25/81] add_related_links.sql
-- ------------------------------------------------------------
-- V6: 活動相關連結
-- 在 Supabase Dashboard → SQL Editor 執行，或 deploy 前手動跑一次
ALTER TABLE events ADD COLUMN IF NOT EXISTS related_links JSONB DEFAULT '[]';

-- ------------------------------------------------------------
-- [26/81] add_cover_image_position.sql
-- ------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cover_image_position TEXT DEFAULT '50% 50%';

-- ------------------------------------------------------------
-- [27/81] add_kiosk_open.sql
-- ------------------------------------------------------------
-- Migration: add kiosk_open to events
-- 用途：解耦「活動介紹頁顯示」與「刷卡報名開放」
-- 執行一次即可，現有活動全部預設 true（不影響現狀）

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS kiosk_open BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN events.kiosk_open IS
  '是否顯示於前台 Kiosk 報名清單。false = 不開放刷卡報名（但可仍在 activities 頁顯示）';

-- ------------------------------------------------------------
-- [28/81] add_volunteer_open.sql
-- ------------------------------------------------------------
-- V5: 義工開放模式
-- 在 Supabase Dashboard → SQL Editor 執行，或 deploy 前手動跑一次
ALTER TABLE events ADD COLUMN IF NOT EXISTS volunteer_open BOOLEAN DEFAULT false;

-- ------------------------------------------------------------
-- [29/81] add_walkin_mode.sql
-- ------------------------------------------------------------
-- 自由刷卡模式：學員刷卡即完成報名與報到，適合自由參加的活動
ALTER TABLE events ADD COLUMN IF NOT EXISTS walkin_mode boolean DEFAULT false;

-- ------------------------------------------------------------
-- [30/81] add_registration_source.sql
-- ------------------------------------------------------------
-- ============================================================================
-- registrations 表新增 source 欄位
-- 用途：區分報名來源
--   - 'kiosk'  ：前台 KioskPage 學員自己刷卡報名（預設、含現有舊資料）
--   - 'walkin' ：報到頁現場補報（紅卡按「現場報名」按鈕）
--   - 'manual' ：後台手動新增
-- 影響：報到頁統計列顯示「現場 X」chip；後台 CSV / 名單可分流追蹤
-- 安全性：NOT NULL DEFAULT 'kiosk'，舊資料自動填 kiosk，不影響既有邏輯
-- ============================================================================

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'kiosk';

COMMENT ON COLUMN registrations.source IS
  'kiosk=前台刷卡 / walkin=報到頁現場補報 / manual=後台手動';

-- 驗證
SELECT source, COUNT(*) FROM registrations GROUP BY source;

-- ------------------------------------------------------------
-- [31/81] add_templates_table.sql
-- ------------------------------------------------------------
-- ══════════════════════════════════════════════════════════
-- 模板管理：建立 event_templates 資料表
-- 在 Supabase SQL Editor 執行一次
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_templates (
  template_id  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  fields       jsonb       NOT NULL DEFAULT '[]',
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;

-- 師父（authenticated）：完整存取
CREATE POLICY "authenticated full access on event_templates"
  ON event_templates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON TABLE event_templates TO authenticated;

-- ── 插入內建模板 ─────────────────────────────────────────

INSERT INTO event_templates (name, sort_order, fields) VALUES

('回山模板', 1, '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求"}
]'::jsonb),

('精舍模板', 2, '[
  {"field_key":"identity","field_label":"身份別","field_type":"radio","options":["信眾","義工"],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"need_lunch","field_label":"是否需要午齋","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"need_parking","field_label":"是否需要停車位","field_type":"boolean","options":[],"show_if":null,"required":true,"placeholder":null},
  {"field_key":"volunteer_group","field_label":"組別","field_type":"radio","options":["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],"show_if":{"identity":"義工"},"required":true,"placeholder":null}
]'::jsonb);

-- ------------------------------------------------------------
-- [32/81] add_phase2_b.sql
-- ------------------------------------------------------------
-- ============================================================
-- Phase 2 補強 — Migration
-- 在 Supabase Dashboard → SQL Editor 執行一次
-- ============================================================
-- 變更內容：
-- 1. registrations 加 updated_at (timestamptz) + trigger 自動更新
-- 2. registrations 加 is_driver (boolean)  — 小車場景，含「車號」欄位者自動為 true
-- 3. head_leader 解除 (event_id,type) unique 約束，改成 (event_id,type,registration_id) unique
--    讓「小車領隊」可以多人
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. registrations.updated_at + is_driver
-- ────────────────────────────────────────────────────────────

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS is_driver  BOOLEAN     NOT NULL DEFAULT false;

COMMENT ON COLUMN registrations.updated_at IS '最後異動時間（INSERT/UPDATE 都會更新，名單顯示用此欄）';
COMMENT ON COLUMN registrations.is_driver  IS '是否為司機（小車自開場景，含車號欄位的報名為 true）';

-- 既有資料 updated_at 補成 registered_at（保留歷史時序）
UPDATE registrations
   SET updated_at = registered_at
 WHERE updated_at IS NULL OR updated_at = registered_at;


-- ────────────────────────────────────────────────────────────
-- 2. trigger：UPDATE 時自動推進 updated_at
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_registrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registrations_touch ON registrations;

CREATE TRIGGER trg_registrations_touch
  BEFORE UPDATE ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION touch_registrations_updated_at();


-- ────────────────────────────────────────────────────────────
-- 3. head_leader 解除 (event_id,type) unique，改 (event_id,type,registration_id)
--    讓小車領隊可多人；總領隊仍可以多人（彈性）
-- ────────────────────────────────────────────────────────────

-- 找出舊的 unique constraint 名稱（依 Supabase 慣例多為 head_leader_event_id_type_key）
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname, conkey
      FROM pg_constraint
     WHERE conrelid = 'head_leader'::regclass
       AND contype  = 'u'
  LOOP
    -- 只在「兩欄」的 unique 約束（舊的 event_id+type）才砍
    -- 新的三欄 unique（event_id+type+registration_id）會被保留
    IF array_length(con.conkey, 1) = 2 THEN
      EXECUTE format('ALTER TABLE head_leader DROP CONSTRAINT %I', con.conname);
    END IF;
  END LOOP;
END $$;

-- 新的多欄 unique（同一活動同一類型，同一 registration_id 只能出現一次）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'head_leader'::regclass
       AND conname  = 'head_leader_event_type_reg_uniq'
  ) THEN
    ALTER TABLE head_leader
      ADD CONSTRAINT head_leader_event_type_reg_uniq
      UNIQUE (event_id, type, registration_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 4. 索引（加速 updated_at 排序）
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_registrations_updated_at
  ON registrations(event_id, updated_at DESC);


-- ============================================================
-- 完成！執行後可用以下查詢確認：
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'registrations'
--      AND column_name IN ('updated_at','is_driver');
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'head_leader'::regclass;
-- ============================================================

-- ------------------------------------------------------------
-- [33/81] add_phase3.sql
-- ------------------------------------------------------------
-- ============================================================
-- Phase 3 — 法會功德主管理
-- 在 Supabase Dashboard → SQL Editor 執行一次
-- ============================================================
-- 變更內容：
-- 1. 新增 event_donors 表（功德主名單，每場活動一張表）
-- 2. 兩個 partial unique：學員型 (event_id, student_id) / 訪客型 (event_id, name)
-- 3. RLS 政策、GRANT 權限（與 registrations 對齊）
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. event_donors
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_donors (
  donor_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  student_id  TEXT,                                                   -- NULL = 訪客功德主
  name        TEXT NOT NULL,
  donor_item  TEXT,                                                   -- 功德項目（自由文字，例：消災功德主）
  seat        TEXT,                                                   -- 座位
  corsage     TEXT,                                                   -- 胸花
  offering    TEXT,                                                   -- 供具
  donor_note  TEXT,                                                   -- 備註
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  event_donors             IS '法會功德主名單（一場一筆，依 event_id + student_id 或 event_id + name 唯一）';
COMMENT ON COLUMN event_donors.student_id  IS '對應 students.student_id；NULL 代表訪客型功德主';
COMMENT ON COLUMN event_donors.donor_item  IS '功德項目（自由文字，由師父在匯入時填寫，顯示時若空白則整列不顯示）';

-- 不加 students FK，避免將來 registrations / event_donors 同時 nested 撞 PGRST201
-- （前端寫入時自行確認 student_id 有效）


-- ────────────────────────────────────────────────────────────
-- 2. unique 索引（partial，分學員型／訪客型）
-- ────────────────────────────────────────────────────────────

-- 學員型：同一活動同一位學員只能有一筆功德主紀錄
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_student
  ON event_donors(event_id, student_id)
  WHERE student_id IS NOT NULL;

-- 訪客型：同一活動同名訪客只能有一筆（同名不同人需師父手動處理）
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_donors_guest
  ON event_donors(event_id, name)
  WHERE student_id IS NULL;

-- 一般查詢索引
CREATE INDEX IF NOT EXISTS idx_event_donors_event   ON event_donors(event_id);
CREATE INDEX IF NOT EXISTS idx_event_donors_student ON event_donors(student_id) WHERE student_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 3. trigger：UPDATE 時自動推進 updated_at
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_event_donors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_donors_touch ON event_donors;

CREATE TRIGGER trg_event_donors_touch
  BEFORE UPDATE ON event_donors
  FOR EACH ROW
  EXECUTE FUNCTION touch_event_donors_updated_at();


-- ────────────────────────────────────────────────────────────
-- 4. RLS（與 registrations 同策略，anon 可全權；上線後可緊縮）
-- ────────────────────────────────────────────────────────────

ALTER TABLE event_donors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can select event_donors"        ON event_donors;
DROP POLICY IF EXISTS "anon can insert event_donors"        ON event_donors;
DROP POLICY IF EXISTS "anon can update event_donors"        ON event_donors;
DROP POLICY IF EXISTS "anon can delete event_donors"        ON event_donors;
DROP POLICY IF EXISTS "authenticated full access on event_donors" ON event_donors;

CREATE POLICY "anon can select event_donors"
  ON event_donors FOR SELECT TO anon USING (true);

CREATE POLICY "anon can insert event_donors"
  ON event_donors FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon can update event_donors"
  ON event_donors FOR UPDATE TO anon USING (true);

CREATE POLICY "anon can delete event_donors"
  ON event_donors FOR DELETE TO anon USING (true);

CREATE POLICY "authenticated full access on event_donors"
  ON event_donors FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ────────────────────────────────────────────────────────────
-- 5. GRANT
-- ────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON event_donors TO anon;
GRANT ALL ON event_donors TO authenticated;


-- ============================================================
-- 完成！執行後可用以下查詢確認：
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'event_donors' ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'event_donors';
-- ============================================================

-- ------------------------------------------------------------
-- [34/81] phase5_batch1_sessions.sql
-- ------------------------------------------------------------
-- ============================================================
-- Phase 5 Batch 1：多場次報名 — DB 建表
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-15
-- ============================================================

-- ① events 表新增 multi_session 欄位
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS multi_session BOOLEAN DEFAULT false;

-- ② 新表：event_sessions（場次設定）
CREATE TABLE IF NOT EXISTS event_sessions (
  session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  time_period  TEXT NOT NULL CHECK (time_period IN ('morning','afternoon','evening')),
  dharma_name  TEXT NOT NULL DEFAULT '',
  time_start   TIME,
  time_end     TIME,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);

-- ③ 新表：registration_session_checkins（多場次報到紀錄）
CREATE TABLE IF NOT EXISTS registration_session_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_id          UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES event_sessions(session_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reg_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_rsc_reg_id     ON registration_session_checkins(reg_id);
CREATE INDEX IF NOT EXISTS idx_rsc_session_id ON registration_session_checkins(session_id);

-- ④ RLS + GRANT
-- 注意：SQL Editor 建表需手動 GRANT，Dashboard 建表才自動處理
--   authenticated / service_role → 完整讀寫
--   anon → 只讀（前台 KioskPage 用 anon key 讀場次）
ALTER TABLE event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;

GRANT ALL ON event_sessions TO authenticated, service_role;
GRANT SELECT ON event_sessions TO anon;
GRANT ALL ON registration_session_checkins TO authenticated, service_role;

-- event_sessions：anon 可讀（前台）
CREATE POLICY "event_sessions_select_anon" ON event_sessions
  FOR SELECT TO anon USING (true);

-- event_sessions：authenticated 完整讀寫（後台）
CREATE POLICY "event_sessions_select" ON event_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "event_sessions_insert" ON event_sessions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "event_sessions_update" ON event_sessions
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "event_sessions_delete" ON event_sessions
  FOR DELETE TO authenticated USING (true);

-- registration_session_checkins：登入使用者可讀寫
CREATE POLICY "rsc_select" ON registration_session_checkins
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rsc_insert" ON registration_session_checkins
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "rsc_delete" ON registration_session_checkins
  FOR DELETE TO authenticated USING (true);

-- ------------------------------------------------------------
-- [35/81] phase5_session_fields.sql
-- ------------------------------------------------------------
-- ============================================================
-- Phase 5：多場次活動「場次共用子欄位」動態化
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-16
--
-- 目的：把原本寫死的「午齋 / 停車」改為可在後台設定的動態欄位，
--      同時保留向後相容（既有多場次活動自動 backfill 預設兩欄）。
-- ============================================================

-- ① 新表：event_session_fields（一個多場次活動共用一組子欄位）
CREATE TABLE IF NOT EXISTS event_session_fields (
  field_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key      TEXT NOT NULL,
  field_label    TEXT NOT NULL,
  field_type     TEXT NOT NULL DEFAULT 'radio' CHECK (field_type IN ('radio','boolean','text')),
  options        JSONB NOT NULL DEFAULT '[]'::jsonb,
  show_if_period JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [] = 所有時段；["morning"] = 只上午
  sort_order     INT  NOT NULL DEFAULT 0,
  required       BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_event_session_fields_event_id
  ON event_session_fields(event_id);

-- ② RLS + GRANT（沿用 event_sessions 模式）
ALTER TABLE event_session_fields ENABLE ROW LEVEL SECURITY;

GRANT ALL    ON event_session_fields TO authenticated, service_role;
GRANT SELECT ON event_session_fields TO anon;

DROP POLICY IF EXISTS "esf_select_anon"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_select_auth"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_insert_auth"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_update_auth"    ON event_session_fields;
DROP POLICY IF EXISTS "esf_delete_auth"    ON event_session_fields;

CREATE POLICY "esf_select_anon" ON event_session_fields
  FOR SELECT TO anon          USING (true);
CREATE POLICY "esf_select_auth" ON event_session_fields
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "esf_insert_auth" ON event_session_fields
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "esf_update_auth" ON event_session_fields
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "esf_delete_auth" ON event_session_fields
  FOR DELETE TO authenticated USING (true);

-- ③ Backfill：所有既有 multi_session=true 的活動，
--    若還沒有任何 event_session_fields，自動補上預設的「午齋」+「停車」兩筆。
--    這確保前台原本的寫死行為（午齋 morning + 停車 all）平滑遷移。
INSERT INTO event_session_fields
  (event_id, field_key, field_label, field_type, options, show_if_period, sort_order, required)
SELECT
  e.event_id, 'lunch', '午齋', 'radio',
  '["需要","不需要"]'::jsonb,
  '["morning"]'::jsonb,
  1, true
FROM events e
WHERE e.multi_session = true
  AND NOT EXISTS (
    SELECT 1 FROM event_session_fields esf WHERE esf.event_id = e.event_id
  );

INSERT INTO event_session_fields
  (event_id, field_key, field_label, field_type, options, show_if_period, sort_order, required)
SELECT
  e.event_id, 'parking', '停車', 'radio',
  '["機車","轎車","不需要"]'::jsonb,
  '[]'::jsonb,
  2, true
FROM events e
WHERE e.multi_session = true
  AND NOT EXISTS (
    SELECT 1 FROM event_session_fields esf
    WHERE esf.event_id = e.event_id AND esf.field_key = 'parking'
  );

-- ④ 驗證：列出每個多場次活動的子欄位
-- SELECT e.name, esf.field_key, esf.field_label, esf.show_if_period
-- FROM events e
-- LEFT JOIN event_session_fields esf ON esf.event_id = e.event_id
-- WHERE e.multi_session = true
-- ORDER BY e.name, esf.sort_order;

-- ------------------------------------------------------------
-- [36/81] phase5_batch1_fix_policies.sql
-- ------------------------------------------------------------
-- Phase 5 Batch 1 補執行：重建 event_sessions / registration_session_checkins Policy
-- 若已存在先刪除，再重建（冪等執行）

-- ① 確保欄位存在（重複執行安全）
ALTER TABLE events ADD COLUMN IF NOT EXISTS multi_session BOOLEAN DEFAULT false;

-- ② 確保資料表存在（重複執行安全）
CREATE TABLE IF NOT EXISTS event_sessions (
  session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  time_period  TEXT NOT NULL CHECK (time_period IN ('morning','afternoon','evening')),
  dharma_name  TEXT NOT NULL DEFAULT '',
  time_start   TIME,
  time_end     TIME,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);

CREATE TABLE IF NOT EXISTS registration_session_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_id          UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES event_sessions(session_id) ON DELETE CASCADE,
  checked_in_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(reg_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_rsc_reg_id     ON registration_session_checkins(reg_id);
CREATE INDEX IF NOT EXISTS idx_rsc_session_id ON registration_session_checkins(session_id);

-- ③ RLS 啟用
ALTER TABLE event_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;

-- ④ GRANT
GRANT ALL ON event_sessions TO authenticated, service_role;
GRANT SELECT ON event_sessions TO anon;
GRANT ALL ON registration_session_checkins TO authenticated, service_role;

-- ⑤ 先刪舊 Policy，再重建（避免 42710 衝突）
DROP POLICY IF EXISTS "event_sessions_select_anon" ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_select"      ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_insert"      ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_update"      ON event_sessions;
DROP POLICY IF EXISTS "event_sessions_delete"      ON event_sessions;
DROP POLICY IF EXISTS "rsc_select"                 ON registration_session_checkins;
DROP POLICY IF EXISTS "rsc_insert"                 ON registration_session_checkins;
DROP POLICY IF EXISTS "rsc_delete"                 ON registration_session_checkins;

CREATE POLICY "event_sessions_select_anon" ON event_sessions
  FOR SELECT TO anon USING (true);

CREATE POLICY "event_sessions_select" ON event_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "event_sessions_insert" ON event_sessions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "event_sessions_update" ON event_sessions
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "event_sessions_delete" ON event_sessions
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "rsc_select" ON registration_session_checkins
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rsc_insert" ON registration_session_checkins
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "rsc_delete" ON registration_session_checkins
  FOR DELETE TO authenticated USING (true);

-- ------------------------------------------------------------
-- [37/81] add_is_recurring.sql
-- ------------------------------------------------------------
-- 定期活動標記：is_recurring=true 的活動由系統自動建立，在後台有獨立管理頁籤
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false;

-- ------------------------------------------------------------
-- [38/81] create_recurring_templates.sql
-- ------------------------------------------------------------
-- 定期活動範本表
-- 每筆範本定義一個週期性活動的基本設定
-- Batch 1：建表（自動產生邏輯在 Batch 2 實作）

CREATE TABLE IF NOT EXISTS recurring_templates (
  template_id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text    NOT NULL,          -- 活動名稱（不含日期）
  prepend_date         boolean DEFAULT true,      -- 建立時是否自動在前加 YYYY/MM/DD
  frequency            text    NOT NULL CHECK (frequency IN ('weekly','monthly')),
  day_of_week          smallint,                  -- 0=日 1=一 2=二 3=三 4=四 5=五 6=六（weekly 用）
  day_of_month         smallint,                  -- 1-31（monthly 用）
  location             text    DEFAULT '',
  location_tag         text    DEFAULT 'puyi',
  event_type           text    DEFAULT 'temple',
  walkin_mode          boolean DEFAULT false,
  kiosk_open           boolean DEFAULT true,
  offline_registration boolean DEFAULT false,
  show_on_activities   boolean DEFAULT false,
  auto_create          boolean DEFAULT false,     -- 是否開啟自動建立（Batch 2 的 pg_cron 用）
  active               boolean DEFAULT true,
  created_at           timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users can manage recurring_templates"
  ON recurring_templates
  FOR ALL
  USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- [39/81] template_session_fields_migration.sql
-- ------------------------------------------------------------
-- ============================================================
-- 模板系統支援 session_fields（場次共用子欄位）
-- 建立日期：2026-05-19
--
-- 多場次活動的「場次共用子欄位」（event_session_fields）
-- 現在可以隨模板一起儲存／套用。模板套用到活動時：
--   - fields         → event_fields（覆蓋）
--   - session_fields → event_session_fields（覆蓋）
--
-- 舊模板沒設定 session_fields → 預設空陣列，套用模板時不動 event_session_fields
-- ============================================================

ALTER TABLE event_templates
  ADD COLUMN IF NOT EXISTS session_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN event_templates.session_fields IS
  '場次共用子欄位（多場次活動用）。結構同 event_session_fields，但少 event_id / field_id / sort_order（套用時由系統補）';

-- ------------------------------------------------------------
-- [40/81] registration_session_checkins.sql
-- ------------------------------------------------------------
-- ============================================================
-- Phase 5 Batch 5：多場次活動逐場報到
-- 建立日期：2026-05-19
--
-- 規格依據：SPEC.md Phase 5 → 「報到頁（多場次版）」段落
--   每位學員每場一筆 check-in 紀錄；同人同場不重複（複合 PK 阻擋）。
--
-- 與單場次 registrations.checked_in_at 並存：
--   - 單場次活動：沿用 registrations.checked_in_at
--   - 多場次活動：寫入本表
--
-- 不會回填舊資料：報到頁上線後新報到才有紀錄
-- ============================================================

CREATE TABLE IF NOT EXISTS registration_session_checkins (
  reg_id        uuid NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES event_sessions(session_id)     ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reg_id, session_id)
);

-- 用 session_id 查報到名單時加速
CREATE INDEX IF NOT EXISTS ix_rsc_session ON registration_session_checkins(session_id);

COMMENT ON TABLE registration_session_checkins IS
  'Phase 5：多場次活動每場一筆報到紀錄（複合 PK = 同人同場不重複）';
COMMENT ON COLUMN registration_session_checkins.checked_in_at IS
  '報到時間，預設 now()；取消報到 = 直接 DELETE';

-- ── RLS：跟 registrations 一致（公開讀寫，後續若有 RLS 強化再一起調）──
-- 目前 registrations 沒開啟 RLS，本表也比照處理。
-- ALTER TABLE registration_session_checkins ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- [41/81] class_normalization.sql
-- ------------------------------------------------------------
-- ================================================================
-- 班級名稱統一化
-- 目標格式：日間初級班 / 夜間初級班 / 日間中級班 / 夜間中級班
--           日間高級班 / 夜間高級班 / 日間研經班 / 夜間研經班
--
-- 步驟 1：先確認現有班級名稱（執行後確認再做 UPDATE）
-- 步驟 2：執行 UPDATE
-- ================================================================

-- ── 步驟 1：查看現有名稱分佈 ──────────────────────────────────
SELECT class_name, COUNT(*) AS 人數
FROM student_classes
GROUP BY class_name
ORDER BY class_name;

-- ── 步驟 2：執行統一化 UPDATE ─────────────────────────────────
-- （確認步驟 1 的結果正確後再執行此段）

UPDATE student_classes
SET class_name = CASE
  -- 初級班 -------------------------------------------------------
  WHEN class_name ILIKE '%初級%日%'  OR
       class_name ILIKE '%日%初級%'  THEN '日間初級班'
  WHEN class_name ILIKE '%初級%夜%'  OR
       class_name ILIKE '%夜%初級%'  THEN '夜間初級班'
  -- 中級班 -------------------------------------------------------
  WHEN class_name ILIKE '%中級%日%'  OR
       class_name ILIKE '%日%中級%'  THEN '日間中級班'
  WHEN class_name ILIKE '%中級%夜%'  OR
       class_name ILIKE '%夜%中級%'  THEN '夜間中級班'
  -- 高級班 -------------------------------------------------------
  WHEN class_name ILIKE '%高級%日%'  OR
       class_name ILIKE '%日%高級%'  THEN '日間高級班'
  WHEN class_name ILIKE '%高級%夜%'  OR
       class_name ILIKE '%夜%高級%'  THEN '夜間高級班'
  -- 研經班 -------------------------------------------------------
  WHEN class_name ILIKE '%研經%日%'  OR
       class_name ILIKE '%日%研經%'  THEN '日間研經班'
  WHEN class_name ILIKE '%研經%夜%'  OR
       class_name ILIKE '%夜%研經%'  THEN '夜間研經班'
  -- 其餘不變（手動確認）
  ELSE class_name
END
WHERE class_name NOT IN (
  '日間初級班','夜間初級班',
  '日間中級班','夜間中級班',
  '日間高級班','夜間高級班',
  '日間研經班','夜間研經班'
);

-- ── 步驟 3：確認結果 ──────────────────────────────────────────
SELECT class_name, COUNT(*) AS 人數
FROM student_classes
GROUP BY class_name
ORDER BY class_name;

-- ------------------------------------------------------------
-- [42/81] update_fields_and_transport.sql
-- ------------------------------------------------------------
-- ============================================================
-- 一次完成三件事：
--   A. 把活動欄位「交通方式」選項改為包含「精舍搭車」「搭學員的車」
--   B. 在活動欄位中插入「上山共乘者」「下山共乘者」（條件顯示）
--   C. 把已報名的「信眾」上下山交通改為「精舍搭車」
--
-- 建議執行順序：
--   1. 先跑「預覽查詢」確認現況
--   2. 再跑「正式更新」
-- ============================================================


-- ============================================================
-- 【預覽】查看目前活動欄位結構
-- ============================================================
SELECT
  e.name        AS 活動名稱,
  ef.sort_order AS 順序,
  ef.field_key  AS 欄位key,
  ef.field_label AS 欄位名稱,
  ef.options    AS 選項
FROM events e
JOIN event_fields ef ON e.event_id = ef.event_id
ORDER BY e.name, ef.sort_order;


-- ============================================================
-- 【預覽】查看身分別=信眾的報名資料（確認影響範圍）
-- ============================================================
SELECT
  registration_id,
  answers->>'identity'       AS 身分別,
  answers->>'transport_up'   AS 上山交通_舊,
  answers->>'transport_down' AS 下山交通_舊
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;


-- ============================================================
-- 【正式更新 A+B】更新活動欄位設定
--   - 把 transport_up / transport_down 的選項更新
--   - 在每個有 transport_up 的活動裡插入 carpool_up / carpool_down
--   - 自動調整 sort_order，插到正確位置
-- ============================================================
DO $$
DECLARE
  ev      RECORD;
  s_up    int;
  s_down  int;
BEGIN
  FOR ev IN
    SELECT DISTINCT event_id FROM event_fields WHERE field_key = 'transport_up'
  LOOP

    -- A. 更新上下山交通方式選項
    UPDATE event_fields
    SET options = '["精舍搭車","搭學員的車","自行開車","其他"]'::jsonb
    WHERE event_id = ev.event_id
      AND field_key IN ('transport_up', 'transport_down');

    -- B. 插入共乘者欄位（若已存在則跳過）
    IF NOT EXISTS (
      SELECT 1 FROM event_fields
      WHERE event_id = ev.event_id AND field_key = 'carpool_up'
    ) THEN

      -- 取 transport_up 的 sort_order
      SELECT sort_order INTO s_up
      FROM event_fields
      WHERE event_id = ev.event_id AND field_key = 'transport_up';

      -- 把 transport_up 之後的欄位全部 +1，騰出位置
      UPDATE event_fields
      SET sort_order = sort_order + 1
      WHERE event_id = ev.event_id AND sort_order > s_up;

      -- 插入「上山共乘者」
      INSERT INTO event_fields
        (event_id, field_key, field_label, field_type, options, show_if, sort_order, required)
      VALUES
        (ev.event_id, 'carpool_up', '上山共乘者（學員姓名）', 'text',
         '[]'::jsonb, '{"transport_up":"搭學員的車"}'::jsonb, s_up + 1, false);

      -- 再取 transport_down 的 sort_order（已被上面的 +1 移過了）
      SELECT sort_order INTO s_down
      FROM event_fields
      WHERE event_id = ev.event_id AND field_key = 'transport_down';

      -- 把 transport_down 之後的欄位全部 +1
      UPDATE event_fields
      SET sort_order = sort_order + 1
      WHERE event_id = ev.event_id AND sort_order > s_down;

      -- 插入「下山共乘者」
      INSERT INTO event_fields
        (event_id, field_key, field_label, field_type, options, show_if, sort_order, required)
      VALUES
        (ev.event_id, 'carpool_down', '下山共乘者（學員姓名）', 'text',
         '[]'::jsonb, '{"transport_down":"搭學員的車"}'::jsonb, s_down + 1, false);

    END IF;
  END LOOP;
END $$;


-- ============================================================
-- 【正式更新 C】把身分別=信眾的報名，交通方式改為「精舍搭車」
-- ============================================================
UPDATE registrations
SET answers = (
  answers
  || jsonb_build_object(
       'transport_up',   '精舍搭車',
       'transport_down', '精舍搭車'
     )
) - 'plate_up' - 'plate_down'
WHERE answers->>'identity' = '信眾';


-- ============================================================
-- 【驗收】確認欄位結構與資料都正確
-- ============================================================

-- 確認欄位順序
SELECT
  e.name        AS 活動名稱,
  ef.sort_order AS 順序,
  ef.field_key  AS 欄位key,
  ef.field_label AS 欄位名稱,
  ef.show_if    AS 條件顯示
FROM events e
JOIN event_fields ef ON e.event_id = ef.event_id
ORDER BY e.name, ef.sort_order;

-- 確認信眾資料已更新
SELECT
  registration_id,
  answers->>'identity'       AS 身分別,
  answers->>'transport_up'   AS 上山交通_新,
  answers->>'transport_down' AS 下山交通_新
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;

-- ------------------------------------------------------------
-- [43/81] batch_update_transport.sql
-- ------------------------------------------------------------
-- ============================================================
-- 批次更新：身分別為「信眾」的學員，上下山交通改為「精舍搭車」
-- 使用方式：
--   1. 先執行「第一步」，確認影響筆數與內容
--   2. 確認無誤後，再執行「第二步」正式更新
-- ============================================================


-- ★ 第一步：預覽（只查不改）
SELECT
  registration_id,
  answers->>'identity'      AS 身分別,
  answers->>'transport_up'  AS 上山交通_舊,
  answers->>'transport_down' AS 下山交通_舊
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;


-- ★ 第二步：正式更新（確認第一步結果正確後再執行）
--   - transport_up / transport_down 改為「精舍搭車」
--   - 順手移除 plate_up / plate_down（信眾不開車，不需要車牌）
UPDATE registrations
SET answers = (
  answers
  || jsonb_build_object(
       'transport_up',   '精舍搭車',
       'transport_down', '精舍搭車'
     )
) - 'plate_up' - 'plate_down'
WHERE answers->>'identity' = '信眾';


-- ★ 第三步：驗收（更新後再跑一次確認）
SELECT
  registration_id,
  answers->>'identity'      AS 身分別,
  answers->>'transport_up'  AS 上山交通_新,
  answers->>'transport_down' AS 下山交通_新
FROM registrations
WHERE answers->>'identity' = '信眾'
ORDER BY registration_id;

-- ------------------------------------------------------------
-- [44/81] update_default_templates.sql
-- ------------------------------------------------------------
-- ============================================================
-- 更新內建模板：精舍模板 / 回山模板，補上 dashboard_role + option_meta
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-18
--
-- 前置條件：先跑過 sql/dashboard_role_migration.sql
--          （但本檔只動 event_templates.fields 內的 jsonb，不依賴 DB schema）
--
-- 重要變更（精舍模板）：
--   - need_parking (boolean)        → parking_type (radio) + parking_kind 角色
--     原本是 boolean「是否需要停車位」，看板統計不出車輛數；
--     改 radio + 三選一，並用 option_meta 標記每個選項的車種
--   - identity / need_lunch / 新 parking_type 都加上 dashboard_role
--
-- 既有活動不受影響：本 UPDATE 只改模板本體，不會碰已建立的 event_fields
-- ============================================================

-- ① 精舍模板：四個 field 都重設
UPDATE event_templates
SET fields = '[
  {
    "field_key": "identity",
    "field_label": "身份別",
    "field_type": "radio",
    "options": ["信眾","義工"],
    "show_if": null,
    "required": true,
    "placeholder": null,
    "dashboard_role": "identity",
    "option_meta": null
  },
  {
    "field_key": "need_lunch",
    "field_label": "是否需要午齋",
    "field_type": "boolean",
    "options": [],
    "show_if": null,
    "required": true,
    "placeholder": null,
    "dashboard_role": "lunch_total",
    "option_meta": null
  },
  {
    "field_key": "parking_type",
    "field_label": "停車需求",
    "field_type": "radio",
    "options": ["機車","汽車","不需要"],
    "show_if": null,
    "required": true,
    "placeholder": null,
    "dashboard_role": "parking_kind",
    "option_meta": {
      "機車": "motorcycle",
      "汽車": "car",
      "不需要": "none"
    }
  },
  {
    "field_key": "volunteer_group",
    "field_label": "組別",
    "field_type": "radio",
    "options": ["心燈","照客","行堂","大寮","機動","環保","交通","司儀","梵唄","音響","攝影"],
    "show_if": {"identity":"義工"},
    "required": true,
    "placeholder": null,
    "dashboard_role": null,
    "option_meta": null
  }
]'::jsonb
WHERE name = '精舍模板';

-- ② 回山模板：identity 加 dashboard_role，其他維持原樣
UPDATE event_templates
SET fields = '[
  {"field_key":"identity","field_label":"身分別","field_type":"radio","options":["義工","信眾"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":"identity","option_meta":null},
  {"field_key":"arrive_time","field_label":"預計到達山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_up","field_label":"上山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_up","field_label":"上山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_up":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_up","field_label":"上山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_up":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"leave_time","field_label":"預計離開山上時間","field_type":"datetime","options":[],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"transport_down","field_label":"下山交通方式","field_type":"radio","options":["搭精舍車（大車）","搭學員的車","自行開車","其他"],"show_if":null,"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"carpool_down","field_label":"下山共乘者（司機學員姓名）","field_type":"text","options":[],"show_if":{"transport_down":"搭學員的車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"plate_down","field_label":"下山車牌號碼","field_type":"plate","options":[],"show_if":{"transport_down":"自行開車"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"volunteer_group","field_label":"發心組別","field_type":"radio","options":["交通組","行堂組","茶水間","大寮","客寮","機動組","環保組","大會安排","其他"],"show_if":{"identity":"義工"},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_overnight","field_label":"是否掛單","field_type":"boolean","options":[],"show_if":null,"required":false,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_start","field_label":"掛單開始日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"stay_end","field_label":"掛單結束日期","field_type":"date","options":[],"show_if":{"stay_overnight":true},"required":true,"placeholder":null,"dashboard_role":null,"option_meta":null},
  {"field_key":"note_to_temple","field_label":"備註","field_type":"text","options":[],"show_if":null,"required":false,"placeholder":"欲同車者或其他需求","dashboard_role":null,"option_meta":null}
]'::jsonb
WHERE name = '回山模板';

-- ③ 驗證：列出更新後的模板（看 dashboard_role / option_meta 是否進去）
-- SELECT name, jsonb_pretty(fields)
-- FROM event_templates
-- WHERE name IN ('精舍模板','回山模板');

-- ------------------------------------------------------------
-- [45/81] dashboard_role_migration.sql
-- ------------------------------------------------------------
-- ============================================================
-- 看板動態化（schema-driven dashboard）
-- 執行環境：Supabase SQL Editor
-- 建立日期：2026-05-18
--
-- 目的：把即時看板的「身份／午齋／停車」改為靠 metadata 觸發，
--      不再依賴寫死的 field_key（identity / need_lunch / parking_type）。
--
-- 加兩個欄位：
--   - dashboard_role：標記此欄位在看板擔任的角色
--                     (identity / lunch_total / parking_kind)
--   - option_meta   ：選項層級的 metadata，例如停車選項對應車種
--                     {"需要機車停車位":"motorcycle",
--                      "需要汽車停車位":"car",
--                      "不需要停車位":"none"}
--
-- 同步處理 event_fields（單場活動）與 event_session_fields（多場次）。
-- 既有資料不動；fallback 由前端負責。
-- ============================================================

-- ① event_fields：加 dashboard_role + option_meta
ALTER TABLE event_fields ADD COLUMN IF NOT EXISTS dashboard_role TEXT;
ALTER TABLE event_fields ADD COLUMN IF NOT EXISTS option_meta    JSONB;

ALTER TABLE event_fields
  DROP CONSTRAINT IF EXISTS event_fields_dashboard_role_check;
ALTER TABLE event_fields
  ADD CONSTRAINT event_fields_dashboard_role_check
  CHECK (
    dashboard_role IS NULL
    OR dashboard_role IN ('identity', 'lunch_total', 'parking_kind')
  );

COMMENT ON COLUMN event_fields.dashboard_role IS
  '看板角色：identity（身份統計）/ lunch_total（午齋總份數）/ parking_kind（停車車輛數，配合 option_meta）';
COMMENT ON COLUMN event_fields.option_meta IS
  '選項層級 metadata。parking_kind 時格式：{"<選項字串>":"motorcycle|car|none"}';


-- ② event_session_fields：同樣兩個欄位（多場次走同一套機制）
ALTER TABLE event_session_fields ADD COLUMN IF NOT EXISTS dashboard_role TEXT;
ALTER TABLE event_session_fields ADD COLUMN IF NOT EXISTS option_meta    JSONB;

ALTER TABLE event_session_fields
  DROP CONSTRAINT IF EXISTS event_session_fields_dashboard_role_check;
ALTER TABLE event_session_fields
  ADD CONSTRAINT event_session_fields_dashboard_role_check
  CHECK (
    dashboard_role IS NULL
    OR dashboard_role IN ('identity', 'lunch_total', 'parking_kind')
  );

COMMENT ON COLUMN event_session_fields.dashboard_role IS
  '看板角色：identity / lunch_total / parking_kind（語意同 event_fields）';
COMMENT ON COLUMN event_session_fields.option_meta IS
  '選項層級 metadata，格式同 event_fields.option_meta';


-- ③ 驗證：列出已加上 dashboard_role 的欄位
-- SELECT event_id, field_key, field_label, dashboard_role, option_meta
-- FROM event_fields
-- WHERE dashboard_role IS NOT NULL
-- ORDER BY event_id, sort_order;

-- ------------------------------------------------------------
-- [46/81] show_transport_to_public_migration.sql
-- ------------------------------------------------------------
-- 2026-05-19: 活動加上「對外公開排車資訊」開關
-- 勾選後，學員在前台刷卡可看到自己的車次（大車/小車）
-- 預設 false：避免排車還在編輯時就被學員看到

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS show_transport_to_public BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.show_transport_to_public IS
  '對外公開排車資訊：true 時學員在 KioskPage 刷卡可看到自己的車次（大車/小車、上下山方向）';

-- ── 全新環境補丁：pg_cron extension 提前啟用 ──────────────────────
-- 原始 migration 順序中，啟用指令（原本在 [51/81] 附近）晚於這裡第一次用到
-- cron.schedule 的位置，正式環境是先在 Supabase Dashboard 手動啟用過才沒發現。
-- 全新環境從頭跑會在這裡先報「schema "cron" does not exist」，故提前到此處。
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ------------------------------------------------------------
-- [47/81] recurring_batch2.sql
-- ------------------------------------------------------------
-- Batch 2：定期範本自動建立
-- 1. events 加 template_id
-- 2. pg_cron：每天台北 07:00 建未來 14 天內應存在但還沒建的活動

-- ── Step 1：events 加 template_id ────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES recurring_templates(template_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_template_id ON events(template_id);

-- ── Step 2：自動建立函式 ─────────────────────────────────────────
-- 計算 weekly/monthly 範本在指定日期範圍內的所有出現日期，
-- 跳過已存在同 template_id + date_start 的活動，batch insert。

CREATE OR REPLACE FUNCTION create_recurring_events_in_range(
  p_template_id uuid,
  p_date_start  date,
  p_date_end    date
)
RETURNS int   -- 回傳新建筆數
LANGUAGE plpgsql
AS $$
DECLARE
  tmpl         recurring_templates%ROWTYPE;
  cur_date     date;
  event_name   text;
  created_cnt  int := 0;
BEGIN
  SELECT * INTO tmpl FROM recurring_templates WHERE template_id = p_template_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  cur_date := p_date_start;

  WHILE cur_date <= p_date_end LOOP
    -- 判斷 cur_date 是否符合週期
    IF (tmpl.frequency = 'weekly'  AND EXTRACT(DOW FROM cur_date)::int = tmpl.day_of_week)
    OR (tmpl.frequency = 'monthly' AND EXTRACT(DAY FROM cur_date)::int = tmpl.day_of_month)
    THEN
      -- 組活動名稱
      IF tmpl.prepend_date THEN
        event_name := to_char(cur_date, 'YYYY/MM/DD') || ' ' || tmpl.name;
      ELSE
        event_name := tmpl.name;
      END IF;

      -- 跳過已存在的（同 template_id + date_start）
      IF NOT EXISTS (
        SELECT 1 FROM events
        WHERE template_id = p_template_id
          AND date_start  = cur_date
      ) THEN
        INSERT INTO events (
          name, date_start, date_end,
          location, location_tag, event_type, status,
          walkin_mode, kiosk_open, offline_registration, show_on_activities,
          is_recurring, template_id
        ) VALUES (
          event_name, cur_date, cur_date,
          tmpl.location, tmpl.location_tag, tmpl.event_type, 'active',
          tmpl.walkin_mode, tmpl.kiosk_open, tmpl.offline_registration, tmpl.show_on_activities,
          true, p_template_id
        );
        created_cnt := created_cnt + 1;
      END IF;
    END IF;

    cur_date := cur_date + 1;
  END LOOP;

  RETURN created_cnt;
END;
$$;

-- ── Step 3：pg_cron — 每天台北 07:00（UTC 23:00 前一天）跑 ────────
-- 對所有 auto_create=true && active=true 的範本，建未來 14 天內的活動

SELECT cron.schedule(
  'auto_create_recurring_events',
  '0 23 * * *',   -- UTC 23:00 = 台北 07:00
  $job$
  DO $$
  DECLARE
    tmpl recurring_templates%ROWTYPE;
  BEGIN
    FOR tmpl IN
      SELECT * FROM recurring_templates
      WHERE auto_create = true AND active = true
    LOOP
      PERFORM create_recurring_events_in_range(
        tmpl.template_id,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '14 days'
      );
    END LOOP;
  END;
  $$ LANGUAGE plpgsql;
  $job$
);

-- ------------------------------------------------------------
-- [48/81] recurring_batch3.sql
-- ------------------------------------------------------------
-- Batch 3：定期範本套用動態欄位 + 過期活動自動關閉

-- ── Step 1：recurring_templates 加 fields 欄位 ─────────────────────
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS fields jsonb DEFAULT '[]';

-- ── Step 2：pg_cron — 每天台北 07:00 自動關閉過期活動 ───────────────
-- 所有 date_end < 今天 且 status = 'active' 的活動，一律改為 closed

SELECT cron.schedule(
  'auto_close_past_events',
  '0 23 * * *',   -- UTC 23:00 = 台北 07:00
  $job$
  UPDATE events
  SET status = 'closed'
  WHERE date_end < CURRENT_DATE
    AND status = 'active';
  $job$
);

-- ── Step 3：recurring_templates 加 volunteer_ids ────────────────────
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS volunteer_ids jsonb DEFAULT '[]';

-- ------------------------------------------------------------
-- [49/81] events_lock.sql
-- ------------------------------------------------------------
-- 替 events 表加入「停止異動」欄位
-- 在 Supabase SQL Editor 執行此檔案

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN events.locked IS '是否鎖定報名（true = 前台只能查看，不能新增/修改/取消）';

-- ------------------------------------------------------------
-- [50/81] weekly_gonxiu_cron.sql
-- ------------------------------------------------------------
-- 每週五台北時間 12:00（UTC 04:00）自動建立下一天（周六）的共修活動
-- 執行前請確認 pg_cron 已啟用（Supabase Dashboard → Database → Extensions → pg_cron）

SELECT cron.schedule(
  'create-weekly-gonxiu',           -- 排程名稱（唯一）
  '0 4 * * 5',                      -- 每週五 UTC 04:00 = 台北 12:00
  $$
  INSERT INTO events (
    name,
    date_start,
    date_end,
    status,
    event_type,
    walkin_mode,
    kiosk_open,
    offline_registration,
    show_on_activities,
    is_recurring
  )
  VALUES (
    TO_CHAR(
      (NOW() AT TIME ZONE 'Asia/Taipei') + INTERVAL '1 day',
      'YYYY/MM/DD'
    ) || ' 周六晚間共修',
    ((NOW() AT TIME ZONE 'Asia/Taipei') + INTERVAL '1 day')::date,
    ((NOW() AT TIME ZONE 'Asia/Taipei') + INTERVAL '1 day')::date,
    'active',
    'temple',
    true,    -- walkin_mode：自由刷卡
    true,    -- kiosk_open：出現在刷卡報到頁
    false,   -- offline_registration
    false,   -- show_on_activities：預設不顯示在介紹頁，需要時手動勾
    true     -- is_recurring：標記為定期活動
  );
  $$
);

-- 若需要修改或刪除此排程：
-- SELECT cron.unschedule('create-weekly-gonxiu');

-- ------------------------------------------------------------
-- [51/81] clean_guest_phone_cron.sql
-- ------------------------------------------------------------
-- =============================================================
-- 訪客電話自動清除 — Supabase pg_cron
-- 建立日期：2026-05-17
-- 用途：活動結束 7 天後，自動把訪客報名 (registrations.answers.guest_phone) 刪掉
-- 個資原則：親友電話只用於活動期間聯絡，活動結束就不該再保留
-- =============================================================

-- ───────────────────────────────────────────────────────────────
-- Step 1：啟用 pg_cron extension（Supabase Dashboard → Database → Extensions
--         也可以勾選 UI 啟用；若已啟用，這行會自動跳過）
-- ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ───────────────────────────────────────────────────────────────
-- Step 2：先把可能已存在的同名任務移除（重跑這份 SQL 不會撞名）
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('clean-guest-phone');
EXCEPTION WHEN OTHERS THEN
  -- 第一次跑、還沒這個任務，會跳例外，直接吞掉
  NULL;
END $$;


-- ───────────────────────────────────────────────────────────────
-- Step 3：排程「每天 03:00（台北時間）清除過期訪客電話」
-- pg_cron 時間以 UTC 為準，台北 = UTC+8，所以 03:00 台北 = 19:00 UTC 前一天
-- 也就是 cron 表達式裡的 19:00 UTC
-- ───────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'clean-guest-phone',
  '0 19 * * *',  -- 每天 UTC 19:00 = 台北 03:00 凌晨
  $$
  UPDATE registrations r
     SET answers = r.answers - 'guest_phone'
    FROM events e
   WHERE r.event_id = e.event_id
     AND r.student_id IS NULL                                    -- 只動訪客 reg
     AND r.answers ? 'guest_phone'                               -- 真的有電話才更新
     AND e.date_end IS NOT NULL                                  -- 活動有設結束日
     AND e.date_end < (CURRENT_DATE - INTERVAL '7 days');        -- 結束超過 7 天
  $$
);


-- ───────────────────────────────────────────────────────────────
-- Step 4：驗證任務已建立（執行後應看到一筆 jobname=clean-guest-phone）
-- ───────────────────────────────────────────────────────────────
SELECT jobid, jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'clean-guest-phone';


-- ===============================================================
-- 維護指令備忘（需要時手動執行）
-- ===============================================================

-- ◉ 立刻手動跑一次（驗證 SQL 語法、想立刻清舊資料時用）
--   UPDATE registrations r
--      SET answers = r.answers - 'guest_phone'
--     FROM events e
--    WHERE r.event_id = e.event_id
--      AND r.student_id IS NULL
--      AND r.answers ? 'guest_phone'
--      AND e.date_end IS NOT NULL
--      AND e.date_end < (CURRENT_DATE - INTERVAL '7 days')
--   RETURNING r.registration_id, r.event_id;   -- 看清掉哪幾筆

-- ◉ 看最近一次執行紀錄
--   SELECT * FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'clean-guest-phone')
--    ORDER BY start_time DESC LIMIT 5;

-- ◉ 暫停任務（停用但保留設定）
--   UPDATE cron.job SET active = false WHERE jobname = 'clean-guest-phone';

-- ◉ 重啟任務
--   UPDATE cron.job SET active = true  WHERE jobname = 'clean-guest-phone';

-- ◉ 永久移除任務
--   SELECT cron.unschedule('clean-guest-phone');

-- ------------------------------------------------------------
-- [52/81] fix_rls_clean.sql
-- ------------------------------------------------------------
-- Fix 1: registrations -- 移除 anon 的 UPDATE 和 DELETE
DROP POLICY IF EXISTS "anon can update registrations" ON registrations;
DROP POLICY IF EXISTS "anon can delete registrations" ON registrations;

DROP POLICY IF EXISTS "anon can select registrations" ON registrations;
CREATE POLICY "anon can select registrations"
  ON registrations FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon can insert registrations" ON registrations;
CREATE POLICY "anon can insert registrations"
  ON registrations FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated full access on registrations" ON registrations;
CREATE POLICY "authenticated full access on registrations"
  ON registrations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Fix 2: event_donors -- 完全封鎖 anon
DROP POLICY IF EXISTS "anon can select event_donors" ON event_donors;
DROP POLICY IF EXISTS "anon can insert event_donors" ON event_donors;
DROP POLICY IF EXISTS "anon can update event_donors" ON event_donors;
DROP POLICY IF EXISTS "anon can delete event_donors" ON event_donors;

REVOKE SELECT, INSERT, UPDATE, DELETE ON event_donors FROM anon;

DROP POLICY IF EXISTS "authenticated full access on event_donors" ON event_donors;
CREATE POLICY "authenticated full access on event_donors"
  ON event_donors FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- [53/81] fix_recurring_fields_volunteers.sql
-- ------------------------------------------------------------
-- fix_recurring_fields_volunteers.sql
-- 修復 create_recurring_events_in_range：
-- 原版只 INSERT events，不複製 event_fields 和 volunteer_event_access
-- 本次補上：RETURNING event_id -> 複製動態欄位 + 義工存取設定

CREATE OR REPLACE FUNCTION create_recurring_events_in_range(
  p_template_id uuid,
  p_date_start  date,
  p_date_end    date
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  tmpl         recurring_templates%ROWTYPE;
  cur_date     date;
  event_name   text;
  new_event_id uuid;
  created_cnt  int := 0;
  field_rec    jsonb;
  vol_id       text;
  sort_idx     int;
BEGIN
  SELECT * INTO tmpl FROM recurring_templates WHERE template_id = p_template_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  cur_date := p_date_start;

  WHILE cur_date <= p_date_end LOOP
    IF (tmpl.frequency = 'weekly'  AND EXTRACT(DOW FROM cur_date)::int = tmpl.day_of_week)
    OR (tmpl.frequency = 'monthly' AND EXTRACT(DAY FROM cur_date)::int = tmpl.day_of_month)
    THEN
      IF tmpl.prepend_date THEN
        event_name := to_char(cur_date, 'YYYY/MM/DD') || ' ' || tmpl.name;
      ELSE
        event_name := tmpl.name;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM events
        WHERE template_id = p_template_id
          AND date_start  = cur_date
      ) THEN
        -- 建活動，並拿回 event_id
        INSERT INTO events (
          name, date_start, date_end,
          location, location_tag, event_type, status,
          walkin_mode, kiosk_open, offline_registration, show_on_activities,
          is_recurring, template_id
        ) VALUES (
          event_name, cur_date, cur_date,
          tmpl.location, tmpl.location_tag, tmpl.event_type, 'active',
          tmpl.walkin_mode, tmpl.kiosk_open, tmpl.offline_registration, tmpl.show_on_activities,
          true, p_template_id
        )
        RETURNING event_id INTO new_event_id;

        -- ── 複製動態欄位 ────────────────────────────────────────
        IF tmpl.fields IS NOT NULL AND jsonb_array_length(tmpl.fields) > 0 THEN
          sort_idx := 1;
          FOR field_rec IN SELECT * FROM jsonb_array_elements(tmpl.fields) LOOP
            INSERT INTO event_fields (
              event_id, field_key, field_label, field_type,
              options, show_if, sort_order, required,
              placeholder, dashboard_role, option_meta
            ) VALUES (
              new_event_id,
              field_rec->>'field_key',
              field_rec->>'field_label',
              field_rec->>'field_type',
              COALESCE(field_rec->'options', '[]'::jsonb),
              field_rec->'show_if',
              sort_idx,
              COALESCE((field_rec->>'required')::boolean, true),
              field_rec->>'placeholder',
              field_rec->>'dashboard_role',
              field_rec->'option_meta'
            );
            sort_idx := sort_idx + 1;
          END LOOP;
        END IF;

        -- ── 複製義工存取設定 ─────────────────────────────────────
        IF tmpl.volunteer_ids IS NOT NULL AND jsonb_array_length(tmpl.volunteer_ids) > 0 THEN
          FOR vol_id IN SELECT jsonb_array_elements_text(tmpl.volunteer_ids) LOOP
            INSERT INTO volunteer_event_access (volunteer_id, event_id)
            VALUES (vol_id::uuid, new_event_id)
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;

        created_cnt := created_cnt + 1;
      END IF;
    END IF;

    cur_date := cur_date + 1;
  END LOOP;

  RETURN created_cnt;
END;
$$;

-- ------------------------------------------------------------
-- [54/81] fix_rls_registrations_anon.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修正 registrations anon SELECT 過於開放的問題
-- 日期：2026-06-07
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 改動說明：
--   目前 "anon can select registrations" 政策是 USING(true)，
--   任何人可以查詢全場所有報名記錄（含 guest_phone）。
--
--   修法：
--   1. 建立 SECURITY DEFINER RPC kiosk_get_registrations_for_student
--      - 呼叫時必須提供 student_id，只回傳該學員相關的記錄
--      - 自動從 answers 移除 guest_phone（遮蔽電話號碼）
--   2. 移除開放的 anon SELECT 政策
--
--   前端 supabase.js 需同步更新（見配套說明）
-- ============================================================


-- ── Step 1：建立 Kiosk 專用 RPC ──────────────────────────────

CREATE OR REPLACE FUNCTION kiosk_get_registrations_for_student(
  p_student_id TEXT,
  p_event_ids  UUID[]
)
RETURNS TABLE (
  registration_id UUID,
  event_id        UUID,
  student_id      TEXT,
  host_student_id TEXT,
  answers         JSONB,
  is_driver       BOOLEAN,
  registered_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 限制：只回傳此 student_id 作為本人或代報者的記錄
  -- 並從 answers 移除 guest_phone（phone 是一次性欄位，不需要暴露給前台）
  RETURN QUERY
  SELECT
    r.registration_id,
    r.event_id,
    r.student_id,
    r.host_student_id,
    (r.answers - 'guest_phone') AS answers,   -- 遮掉親友電話
    r.is_driver,
    r.registered_at,
    r.updated_at
  FROM registrations r
  WHERE r.event_id = ANY(p_event_ids)
    AND (
      r.student_id      = p_student_id   -- 學員本人的報名
      OR r.host_student_id = p_student_id  -- 學員代報親友的紀錄
    );
END;
$$;

-- anon 和 authenticated 都可以呼叫（Kiosk 用 anon，後台用 authenticated）
GRANT EXECUTE ON FUNCTION kiosk_get_registrations_for_student(TEXT, UUID[]) TO anon, authenticated;


-- ── Step 2：移除開放的 anon SELECT 政策 ──────────────────────

DROP POLICY IF EXISTS "anon can select registrations" ON registrations;

-- authenticated 的全覆蓋政策保持不變（已存在，不需重建）
-- 確認 authenticated 政策還在：
-- SELECT policyname, cmd FROM pg_policies
-- WHERE tablename = 'registrations' AND roles @> '{authenticated}';


-- ── Step 3：驗證（執行後可跑這幾行確認）──────────────────────
/*
-- 確認 registrations 的 anon 政策只剩 INSERT
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'registrations' AND roles @> '{anon}';
-- 預期：只有 "anon can insert registrations"（INSERT）

-- 確認 RPC 存在
SELECT proname FROM pg_proc WHERE proname = 'kiosk_get_registrations_for_student';
-- 預期：1 筆
*/

-- ------------------------------------------------------------
-- [55/81] fix_volunteer_event_access.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修正 volunteer_event_access 義工可自行擴權的問題
-- 日期：2026-06-07
-- 執行方式：貼到 Supabase Dashboard -> SQL Editor -> Run
--
-- 問題說明：
--   原政策 FOR ALL USING(true) WITH CHECK(true)
--   讓任何已登入的義工帳號，都能自行 INSERT 任意活動的存取權，
--   繞過師父的授權機制。
--
-- 修法：
--   admin 才能寫入（由 app_metadata.role 判斷）
--   義工只能讀自己被授權的活動
-- ============================================================

-- Step 1：移除過於寬鬆的舊政策
DROP POLICY IF EXISTS "volunteer_event_access: authenticated 完整存取" ON volunteer_event_access;

-- 以防萬一，也清掉其他可能存在的舊政策名稱
DROP POLICY IF EXISTS "authenticated full access" ON volunteer_event_access;
DROP POLICY IF EXISTS "Allow full access for authenticated" ON volunteer_event_access;

-- Step 2：admin 可以管理（新增、刪除、修改義工的活動授權）
CREATE POLICY "volunteer_event_access: admin 可管理"
  ON volunteer_event_access FOR ALL TO authenticated
  USING  (auth.jwt()->'app_metadata'->>'role' = 'admin')
  WITH CHECK (auth.jwt()->'app_metadata'->>'role' = 'admin');

-- Step 3：義工只能讀自己被授權的活動（不能寫）
CREATE POLICY "volunteer_event_access: 義工只能讀自己"
  ON volunteer_event_access FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());


-- ── 驗證（執行後可跑這幾行確認）────────────────────────────
/*
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'volunteer_event_access';
-- 預期：只剩兩筆：
--   "volunteer_event_access: admin 可管理"   (ALL, app_metadata check)
--   "volunteer_event_access: 義工只能讀自己" (SELECT, volunteer_id check)
*/

-- ------------------------------------------------------------
-- [56/81] kiosk_submit_registration.sql
-- ------------------------------------------------------------
-- ============================================================
-- Kiosk 學員自助報名寫入 RPC
-- 建立日期：2026-06-11（原本只在 Supabase SQL Editor 建立，沒有存成檔案）
-- 補存日期：2026-07-18，用 SELECT pg_get_functiondef('kiosk_submit_registration'::regproc)
--           從普宜精舍正式 Supabase 取回，內容與正式環境一致
-- 用途：Kiosk 學員刷卡報名時呼叫，取代原本 anon 直接 .upsert() registrations
--       （anon 沒有 SELECT 權限，upsert 後 PostgREST 自動回讀會被擋，誤報 RLS 錯誤）
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE OR REPLACE FUNCTION public.kiosk_submit_registration(
  p_event_id uuid,
  p_student_id text,
  p_answers jsonb,
  p_terminal text DEFAULT 'tablet-01'::text,
  p_is_driver boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reg_id UUID;
BEGIN
  INSERT INTO registrations (event_id, student_id, answers, terminal, is_driver)
  VALUES (p_event_id, p_student_id, p_answers, p_terminal, p_is_driver)
  ON CONFLICT (event_id, student_id) DO UPDATE SET
    answers     = EXCLUDED.answers,
    terminal    = EXCLUDED.terminal,
    is_driver   = EXCLUDED.is_driver,
    updated_at  = now()
  RETURNING registration_id INTO v_reg_id;

  RETURN jsonb_build_object('success', true, 'registration_id', v_reg_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 確認 anon／authenticated 可執行（正式環境目前是靠 PUBLIC 預設 EXECUTE 權限涵蓋，
-- 這裡明確寫出來，避免新環境的預設權限跟正式環境不一樣導致漏掉）
GRANT EXECUTE ON FUNCTION public.kiosk_submit_registration(uuid, text, jsonb, text, boolean) TO anon, authenticated;

-- ============================================================
-- 驗證查詢（執行後可跑這行確認 grant 沒問題）
-- ============================================================
/*
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'kiosk_submit_registration';
-- 預期至少看到 anon / authenticated 兩筆 EXECUTE
*/

-- ------------------------------------------------------------
-- [57/81] grant_student_classes.sql
-- ------------------------------------------------------------
-- 讓後端 service_role 能讀取學員班級關聯表（比對未報名名單需要）
-- 在 Supabase Dashboard → SQL Editor 貼上執行
-- 只授予唯讀 SELECT，不改任何資料
GRANT SELECT ON TABLE student_classes TO service_role;

-- ------------------------------------------------------------
-- [58/81] fix_friend_registration_rls.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修正代報親友報名 RLS 錯誤
-- 日期：2026-06-26
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/07 健檢移除 registrations 的開放 anon SELECT 政策後，
--   學員本人報名已改用 RPC kiosk_submit_registration（6/11 修復）。
--   但「代報親友」(submitFriendRegistration) 仍用 .insert().select()，
--   insert 後 PostgREST 會自動 SELECT 回讀剛寫入的列做確認，
--   anon 沒有 SELECT 權限 → 回讀被擋 → 報成
--   "new row violates row-level security policy for table 'registrations'"
--   （與本人報名 6/11 的根因相同，只是發生在代報親友這條路徑）
--
--   修法：新增 SECURITY DEFINER RPC kiosk_submit_friend_registration，
--   以表格擁有者身份執行 insert，不受 RLS 限制，直接回傳 registration_id。
--   前端 submitFriendRegistration 改呼叫此 RPC。
-- ============================================================

CREATE OR REPLACE FUNCTION kiosk_submit_friend_registration(
  p_event_id        UUID,
  p_host_student_id TEXT,
  p_answers         JSONB,
  p_terminal        TEXT DEFAULT 'tablet-01',
  p_is_driver       BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id UUID;
BEGIN
  INSERT INTO registrations (event_id, student_id, host_student_id, answers, terminal, is_driver)
  VALUES (p_event_id, NULL, p_host_student_id, p_answers, p_terminal, p_is_driver)
  RETURNING registration_id INTO v_reg_id;

  RETURN json_build_object('success', true, 'registration_id', v_reg_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- anon（學員平板）和 authenticated（後台手動代報）都能呼叫
GRANT EXECUTE ON FUNCTION kiosk_submit_friend_registration(UUID, TEXT, JSONB, TEXT, BOOLEAN) TO anon, authenticated;

-- ── 驗證（執行後可跑這行確認）──────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'kiosk_submit_friend_registration';
-- 預期：1 筆

-- ------------------------------------------------------------
-- [59/81] fix_get_student_by_qr_active.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- [60/81] fix_cancel_registration_rls.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修正前台取消報名 RLS 錯誤
-- 日期：2026-07-07
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/05 健檢移除 registrations 的 anon DELETE 政策後，
--   前台學員「取消報名」走直接 .delete() → anon 沒有 DELETE 權限 →
--   靜默失敗（無錯誤提示）→ DB 未刪除 → 重整後仍顯示「已報名」
--
-- 修法：
--   建立 SECURITY DEFINER RPC kiosk_cancel_registration，
--   以表格擁有者身份執行 DELETE，不受 RLS 限制。
--   前端改呼叫此 RPC 取代直接 .delete()。
-- ============================================================

CREATE OR REPLACE FUNCTION kiosk_cancel_registration(
  p_registration_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM registrations
  WHERE registration_id = p_registration_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'registration not found');
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- anon（前台學員平板）和 authenticated（後台師父）都可呼叫
GRANT EXECUTE ON FUNCTION kiosk_cancel_registration(UUID) TO anon, authenticated;

-- ── 驗證 ──────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'kiosk_cancel_registration';
-- 預期：1 筆

-- ------------------------------------------------------------
-- [61/81] fix_update_checkin_rls.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修正 updateRegistration + checkInOtherTransport RLS 錯誤
-- 日期：2026-07-07
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
--
-- 背景：
--   6/05 健檢移除 registrations 的 anon UPDATE 政策後，
--   以下兩個前台功能靜默失敗：
--   1. KioskPage 「修改報名」— updateRegistration 直接 .update()
--   2. CarCheckinPage 「其他交通報到」— checkInOtherTransport 直接 .update()
--
-- 修法：各建一個 SECURITY DEFINER RPC，以表格擁有者身份執行 UPDATE。
-- ============================================================


-- ── RPC 1：前台修改報名答案 ──────────────────────────────────

CREATE OR REPLACE FUNCTION kiosk_update_registration(
  p_registration_id UUID,
  p_answers         JSONB,
  p_is_driver       BOOLEAN DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_is_driver IS NOT NULL THEN
    UPDATE registrations
    SET answers   = p_answers,
        is_driver = p_is_driver
    WHERE registration_id = p_registration_id;
  ELSE
    UPDATE registrations
    SET answers = p_answers
    WHERE registration_id = p_registration_id;
  END IF;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'registration not found');
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_update_registration(UUID, JSONB, BOOLEAN) TO anon, authenticated;


-- ── RPC 2：其他交通報到 / 取消報到（CarCheckinPage 用）────────

CREATE OR REPLACE FUNCTION kiosk_checkin_other_transport(
  p_registration_id UUID,
  p_direction       TEXT,     -- 'up' | 'down'
  p_check_in        BOOLEAN   -- true = 報到, false = 取消
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field TEXT;
  v_value TIMESTAMPTZ;
BEGIN
  -- 方向對應欄位
  v_field := CASE p_direction
    WHEN 'down' THEN 'checked_in_down_at'
    ELSE             'checked_in_at'
  END;

  v_value := CASE p_check_in
    WHEN true THEN NOW()
    ELSE           NULL
  END;

  -- 動態欄位名稱用 EXECUTE
  EXECUTE format(
    'UPDATE registrations SET %I = $1 WHERE registration_id = $2',
    v_field
  ) USING v_value, p_registration_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'registration not found');
  END IF;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_checkin_other_transport(UUID, TEXT, BOOLEAN) TO anon, authenticated;


-- ── 驗證 ──────────────────────────────────────────────────
-- SELECT proname FROM pg_proc
-- WHERE proname IN ('kiosk_update_registration', 'kiosk_checkin_other_transport');
-- 預期：2 筆

-- ------------------------------------------------------------
-- [62/81] add_dormitory_phone_lineid.sql
-- ------------------------------------------------------------
-- 2026-07-12 四大新功能 DB migration
-- 功能1 安單寮號 + 功能3 LINE 綁定 + 功能4 學員電話
-- 在 Supabase SQL Editor 直接執行

-- 1. registrations 加寮號欄位（功能1：安單寮號匯入）
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS dormitory_room TEXT;

-- 2. students 加電話與 LINE ID 欄位（功能4：學員電話 / 功能3：LINE 綁定）
ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- 註：stay_overnight 欄位已存在，不需新增

-- ------------------------------------------------------------
-- [63/81] add_show_dormitory_to_public.sql
-- ------------------------------------------------------------
-- 2026-07-12 功能1 安單寮號：對外公開開關（獨立於 show_transport_to_public）
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_dormitory_to_public BOOLEAN DEFAULT false;

-- ------------------------------------------------------------
-- [64/81] add_dormitory_room_to_rpcs.sql
-- ------------------------------------------------------------
-- ============================================================
-- 安單寮號顯示：既有 RPC 補上 dormitory_room 欄位
-- 前提：registrations.dormitory_room 已存在（add_dormitory_phone_lineid.sql）
-- 在 Supabase SQL Editor 執行
-- ============================================================

-- 1. get_car_by_token：car_members.registrations 補 dormitory_room
--    events 用 row_to_json(e.*)，show_dormitory_to_public 已隨欄位存在自動帶出，不需改
CREATE OR REPLACE FUNCTION get_car_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.access_token = p_token
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;

-- 2. get_leader_cars：同上補 dormitory_room
CREATE OR REPLACE FUNCTION get_leader_cars(p_token TEXT, p_car_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  result JSON;
BEGIN
  SELECT event_id INTO v_event_id
  FROM car_assignments WHERE access_token = p_token LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN '[]'::JSON;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return, ca.access_token,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = ANY(p_car_ids)
      AND ca.event_id = v_event_id
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;

-- 3. kiosk_get_registrations_for_student：RETURNS TABLE 改變欄位，需先 DROP 才能重建
--    （CREATE OR REPLACE 無法變更既有函式的回傳欄位組成，這點先前重建 get_student_by_qr 時也踩過）
DROP FUNCTION IF EXISTS kiosk_get_registrations_for_student(TEXT, UUID[]);

CREATE FUNCTION kiosk_get_registrations_for_student(
  p_student_id TEXT,
  p_event_ids  UUID[]
)
RETURNS TABLE (
  registration_id UUID,
  event_id        UUID,
  student_id      TEXT,
  host_student_id TEXT,
  answers         JSONB,
  is_driver       BOOLEAN,
  registered_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  dormitory_room  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.registration_id,
    r.event_id,
    r.student_id,
    r.host_student_id,
    (r.answers - 'guest_phone') AS answers,   -- 遮掉親友電話
    r.is_driver,
    r.registered_at,
    r.updated_at,
    r.dormitory_room
  FROM registrations r
  WHERE r.event_id = ANY(p_event_ids)
    AND (
      r.student_id      = p_student_id
      OR r.host_student_id = p_student_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_get_registrations_for_student(TEXT, UUID[]) TO anon, authenticated;

-- ------------------------------------------------------------
-- [65/81] add_line_notify_fields.sql
-- ------------------------------------------------------------
-- 2026-07-13 功能3：LINE 綁定與推播（車次通知）
-- students.line_user_id 已在 add_dormitory_phone_lineid.sql 建過，不再重複

-- 活動層級的「預設配合事項」範本（純文字，發車次通知時預帶入每台車）
ALTER TABLE events ADD COLUMN IF NOT EXISTS default_notice_text TEXT;

-- 每台車可個別覆寫配合事項文字；NULL 表示沿用 events.default_notice_text
ALTER TABLE car_assignments ADD COLUMN IF NOT EXISTS notice_text TEXT;

-- ------------------------------------------------------------
-- [66/81] grant_students_update_service_role.sql
-- ------------------------------------------------------------
-- 2026-07-13 修復：line-webhook Edge Function 用 service_role 寫入 students.line_user_id 時
-- 出現 42501 permission denied，因為 students 表之前只 GRANT 過 SELECT 給 service_role
-- （山上來信備份系統當初的設定），沒有開放 UPDATE。

GRANT UPDATE ON TABLE students TO service_role;

-- send-car-notification Edge Function 需要讀 car_members 才能查出每台車的學員名單
-- （registrations / students 的 SELECT 之前山上來信系統已經 GRANT 過，car_members 這次才第一次用到）
GRANT SELECT ON TABLE car_members TO service_role;

-- ------------------------------------------------------------
-- [67/81] add_chore_arrangement.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- [68/81] add_chore_monk_phone.sql
-- ------------------------------------------------------------
-- 2026-07-13 排坡系統：負責法師電話拆出獨立欄位（原本跟姓名混在同一段文字裡，沒辦法做撥打連結）
ALTER TABLE chores ADD COLUMN IF NOT EXISTS supervising_monk_phone TEXT;

-- ------------------------------------------------------------
-- [69/81] add_chore_checkin_rpc.sql
-- ------------------------------------------------------------
-- 2026-07-13 福慧出坡排坡系統：小組長免登入報到頁用 RPC
-- chores / chore_members 本身開放 anon SELECT（見 add_chore_arrangement.sql），
-- 但 registrations / students 對 anon 已鎖死（見 fix_rls_registrations_anon.sql），
-- 小組長頁需要姓名/性別/電話/上山車次，故比照 get_car_by_token 寫一支 SECURITY DEFINER RPC 一次撈齊。
--
-- 2026-07-14 更新：加上 supervising_monk_phone（負責法師電話）與各成員 phone（學員電話），
-- 供小組長頁做成 tel: 可撥打連結。

CREATE OR REPLACE FUNCTION get_chore_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      c.chore_id, c.event_id, c.session, c.unit, c.work_content, c.location,
      c.supervising_monk, c.supervising_monk_phone, c.leader_name, c.leader_phone,
      c.quota_male, c.quota_female,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(mem_row)
        FROM (
          SELECT
            cmem.id, cmem.registration_id,
            r.student_id,
            COALESCE(s.name, r.answers->>'guest_name', '訪客') AS name,
            s.phone AS phone,
            (
              SELECT sc.group_name FROM student_classes sc
              WHERE sc.student_id = r.student_id AND (sc.group_name LIKE '%男%' OR sc.group_name LIKE '%女%')
              LIMIT 1
            ) AS group_name,
            (
              SELECT ca.car_name FROM car_members cmm
              JOIN car_assignments ca ON ca.car_id = cmm.car_id
              WHERE cmm.registration_id = r.registration_id
                AND ca.event_id = c.event_id AND ca.direction = 'up'
              LIMIT 1
            ) AS car_name
          FROM chore_members cmem
          JOIN registrations r ON r.registration_id = cmem.registration_id
          LEFT JOIN students s ON s.student_id = r.student_id
          WHERE cmem.chore_id = c.chore_id
        ) mem_row
      ) AS members
    FROM chores c
    LEFT JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_by_token(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- [70/81] fix_car_token_security.sql
-- ------------------------------------------------------------
-- ============================================================
-- Fix Car Token Security
-- Run after existing schema
-- ============================================================

-- 1. Remove car_assignments anon SELECT policy
DROP POLICY IF EXISTS "anon can read car_assignments" ON car_assignments;

-- 2. RPC: get car by token (with full JOIN data)
CREATE OR REPLACE FUNCTION get_car_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.access_token = p_token
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;

-- 3. RPC: get linked cars for leader (token-verified)
CREATE OR REPLACE FUNCTION get_leader_cars(p_token TEXT, p_car_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  result JSON;
BEGIN
  SELECT event_id INTO v_event_id
  FROM car_assignments WHERE access_token = p_token LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN '[]'::JSON;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return, ca.access_token,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = ANY(p_car_ids)
      AND ca.event_id = v_event_id
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;

-- 4. RPC: check in car member (token-verified)
CREATE OR REPLACE FUNCTION checkin_car_member(
  p_token TEXT,
  p_car_id UUID,
  p_registration_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  UPDATE car_members
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE car_id = p_car_id AND registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_member(TEXT, UUID, UUID, BOOLEAN) TO anon, authenticated;

-- 5. RPC: check in all car members (token-verified)
CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  UPDATE car_members
  SET checked_in_at = NOW()
  WHERE car_id = p_car_id AND checked_in_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_all_car(TEXT, UUID) TO anon, authenticated;

-- 6. RPC: check in monk (token-verified)
CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_monks ck
    JOIN car_assignments ca ON ca.car_id = ck.car_id
    WHERE ck.id = p_car_monk_id AND ca.access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;

-- 7. Remove car_members / car_monks anon UPDATE policies
DROP POLICY IF EXISTS "anon can update car_members" ON car_members;
DROP POLICY IF EXISTS "car_monks_anon_update" ON car_monks;

-- ------------------------------------------------------------
-- [71/81] add_chore_session_times.sql
-- ------------------------------------------------------------
-- 2026-07-13 排坡系統追加：出坡時間／報到時間（上午/下午各一組），存在活動層級
-- 這兩個資訊在山上坡務表 Excel 最上面的說明區塊（例如「出坡時間 上午 08:45~11:30」「報到時間 上午 08:30」），
-- 之前匯入解析時被當成不重要的標題文字略過了，現在要抓出來存、並顯示給領隊/小組長看。
-- 純文字存原始顯示格式即可，不需要轉成真正的時間型別。

ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_am_work_time    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_am_checkin_time TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_pm_work_time    TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS chore_pm_checkin_time TEXT;

COMMENT ON COLUMN events.chore_am_work_time    IS '福慧出坡：上午出坡時間，原始文字，例如 08:45~11:30';
COMMENT ON COLUMN events.chore_am_checkin_time IS '福慧出坡：上午報到時間，原始文字，例如 08:30';
COMMENT ON COLUMN events.chore_pm_work_time    IS '福慧出坡：下午出坡時間';
COMMENT ON COLUMN events.chore_pm_checkin_time IS '福慧出坡：下午報到時間';

-- ------------------------------------------------------------
-- [72/81] lock_expired_token_pages.sql
-- ------------------------------------------------------------
-- ============================================================
-- 鎖住已結束活動的公開 token 頁面
-- 日期：2026-07-14
-- 背景：
--   領隊報到頁（/car-checkin/:token，大車/小車領隊、總領隊共用）、
--   小組長免登入查詢頁（/chore-checkin/:token）目前只驗證 token 是否存在，
--   沒有檢查活動是否已結束。活動結束後只要連結/QR code 還留著（義工手機、
--   LINE 對話紀錄很常見），頁面依然打得開，會顯示學員姓名、電話等個資。
--
--   修法：活動結束後（date_end 當天過後）完全鎖住，不留緩衝期。
--   活動結束「當天」整天仍算有效，隔天才鎖（良師父已確認這個範圍，
--   若要連結束當天晚上都鎖，需另外討論）。
--
--   時區注意：Supabase Postgres 預設 UTC，判斷式一律用
--   (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
--   換算成台北當地日期再比較，避免提前或延後鎖住。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================


-- ── 1. get_car_by_token：活動已結束回傳 NULL ──────────────────

CREATE OR REPLACE FUNCTION get_car_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;


-- ── 2. get_leader_cars：活動已結束回傳空陣列 ──────────────────

CREATE OR REPLACE FUNCTION get_leader_cars(p_token TEXT, p_car_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  result JSON;
BEGIN
  SELECT event_id INTO v_event_id
  FROM car_assignments WHERE access_token = p_token LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN '[]'::JSON;
  END IF;

  -- 活動已結束就鎖住，回傳空陣列（不 RAISE，前端統一當作查無資料處理）
  IF EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RETURN '[]'::JSON;
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.pre_depart, ca.late_return, ca.access_token,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = ANY(p_car_ids)
      AND ca.event_id = v_event_id
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;


-- ── 3. get_chore_by_token：活動已結束回傳 NULL ────────────────

CREATE OR REPLACE FUNCTION get_chore_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      c.chore_id, c.event_id, c.session, c.unit, c.work_content, c.location,
      c.supervising_monk, c.supervising_monk_phone, c.leader_name, c.leader_phone,
      c.quota_male, c.quota_female,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(mem_row)
        FROM (
          SELECT
            cmem.id, cmem.registration_id,
            r.student_id,
            COALESCE(s.name, r.answers->>'guest_name', '訪客') AS name,
            s.phone AS phone,
            (
              SELECT sc.group_name FROM student_classes sc
              WHERE sc.student_id = r.student_id AND (sc.group_name LIKE '%男%' OR sc.group_name LIKE '%女%')
              LIMIT 1
            ) AS group_name,
            (
              SELECT ca.car_name FROM car_members cmm
              JOIN car_assignments ca ON ca.car_id = cmm.car_id
              WHERE cmm.registration_id = r.registration_id
                AND ca.event_id = c.event_id AND ca.direction = 'up'
              LIMIT 1
            ) AS car_name
          FROM chore_members cmem
          JOIN registrations r ON r.registration_id = cmem.registration_id
          LEFT JOIN students s ON s.student_id = r.student_id
          WHERE cmem.chore_id = c.chore_id
        ) mem_row
      ) AS members
    FROM chores c
    LEFT JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_by_token(TEXT) TO anon, authenticated;


-- ── 4. checkin_car_member：活動已結束禁止寫入 ─────────────────

CREATE OR REPLACE FUNCTION checkin_car_member(
  p_token TEXT,
  p_car_id UUID,
  p_registration_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id AND ca.access_token = p_token
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE car_id = p_car_id AND registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_member(TEXT, UUID, UUID, BOOLEAN) TO anon, authenticated;


-- ── 5. checkin_all_car：活動已結束禁止寫入 ────────────────────

CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_assignments
    WHERE car_id = p_car_id AND access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id AND ca.access_token = p_token
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = NOW()
  WHERE car_id = p_car_id AND checked_in_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_all_car(TEXT, UUID) TO anon, authenticated;


-- ── 6. checkin_car_monk：活動已結束禁止寫入 ───────────────────

CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM car_monks ck
    JOIN car_assignments ca ON ca.car_id = ck.car_id
    WHERE ck.id = p_car_monk_id AND ca.access_token = p_token
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_monks ck
    JOIN car_assignments ca ON ca.car_id = ck.car_id
    JOIN events e ON e.event_id = ca.event_id
    WHERE ck.id = p_car_monk_id AND ca.access_token = p_token
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;


-- ── 7. get_head_leader_by_token：新增 RPC 取代前端直查 head_leader 表 ──
-- 原本 getHeadLeaderByToken 是前端直接 .from('head_leader').select(...)，
-- 沒辦法在資料庫層加日期判斷。比照 get_car_by_token 整包撈，
-- 加上「活動已結束回傳 NULL」判斷。
-- 注意：head_leader 表本身的 anon SELECT policy 不能移除——
-- findLeaderByStudentId（/leader 領隊掃卡入口頁）還是直接查這張表，
-- 詳見對話回報第④點。

CREATE OR REPLACE FUNCTION get_head_leader_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      hl.id, hl.registration_id, hl.event_id, hl.type,
      row_to_json(e.*) AS events,
      (
        SELECT row_to_json(r_row) FROM (
          SELECT
            reg.answers, reg.student_id,
            row_to_json(s.*) AS students
          FROM registrations reg
          LEFT JOIN LATERAL (
            SELECT st.name FROM students st WHERE st.student_id = reg.student_id
          ) s ON true
          WHERE reg.registration_id = hl.registration_id
        ) r_row
      ) AS registrations
    FROM head_leader hl
    LEFT JOIN events e ON e.event_id = hl.event_id
    WHERE hl.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_head_leader_by_token(TEXT) TO anon, authenticated;


-- ── 8. is_token_expired：供前端判斷「查無資料」是無效 token 還是活動已結束 ──
-- 三張公開 token 表（car_assignments / head_leader / chores）共用同一套判斷邏輯，
-- 只回傳布林值，不洩漏任何實際資料，anon 可放心呼叫。
-- 邏輯：token 在任一張表存在且對應活動已結束 → true；
--      token 不存在（單純無效）或活動尚未結束 → false。

CREATE OR REPLACE FUNCTION is_token_expired(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_end DATE;
BEGIN
  SELECT e.date_end INTO v_date_end
  FROM car_assignments ca JOIN events e ON e.event_id = ca.event_id
  WHERE ca.access_token = p_token
  LIMIT 1;

  IF v_date_end IS NULL THEN
    SELECT e.date_end INTO v_date_end
    FROM head_leader hl JOIN events e ON e.event_id = hl.event_id
    WHERE hl.access_token = p_token
    LIMIT 1;
  END IF;

  IF v_date_end IS NULL THEN
    SELECT e.date_end INTO v_date_end
    FROM chores c JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
    LIMIT 1;
  END IF;

  IF v_date_end IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (NOW() AT TIME ZONE 'Asia/Taipei')::date > v_date_end;
END;
$$;

GRANT EXECUTE ON FUNCTION is_token_expired(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- [73/81] fix_chores_anon_policy.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- [74/81] enhance_chore_locations_rpc.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- [75/81] add_all_cars_progress_by_token_rpc.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修復：總領隊看板／小車領隊看板 anon 讀不到資料的安全漏洞
-- 日期：2026-07-15
-- 背景：
--   fix_car_token_security.sql（2026-06-07）把 car_assignments 的 anon SELECT
--   政策移除，改用 get_car_by_token / get_leader_cars 這兩支 token 驗證的
--   SECURITY DEFINER RPC，取代前端直查 car_assignments 表——但當時只處理了
--   「單台車」領隊頁面（mode='car'），沒有一起改掉總領隊看板／小車領隊看板
--   （mode='head' / mode='small_car'）用的 getAllCarsProgress、
--   getEventRegistrations、getAllSmallCarsProgress 這三支，它們至今仍是
--   前端直接 .from('car_assignments')/.from('registrations') 查表。
--   政策移除後，這三支對 anon（真實領隊，未登入）等於永遠查到空結果，
--   總領隊/小車看板打開連結會是空的。
--
--   修法：新增一支 get_all_cars_progress_by_token(p_token)，比照
--   get_car_by_token 的驗證邏輯——用 head_leader.access_token 驗證身份、
--   確認活動未結束，才回傳該活動所有車輛進度（大車＋小車，small_car 類型
--   的領隊只看得到小車）＋（總領隊才需要的）全部報名資料，供前端算「其他
--   交通」名單用。leader_type 從 head_leader 表讀出，不接受前端傳入，
--   避免有人竄改參數看到不該看的範圍。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE OR REPLACE FUNCTION get_all_cars_progress_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id    UUID;
  v_leader_type TEXT;
  v_cars JSON;
  v_regs JSON;
BEGIN
  SELECT hl.event_id, hl.type INTO v_event_id, v_leader_type
  FROM head_leader hl
  JOIN events e ON e.event_id = hl.event_id
  WHERE hl.access_token = p_token
    AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_cars
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.sort_order, ca.car_type,
      ca.direction, ca.pre_depart, ca.late_return,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at, reg.student_id,
              reg.pre_depart_override, reg.late_return_override, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    WHERE ca.event_id = v_event_id
      AND (v_leader_type <> 'small_car' OR ca.car_type = 'small')
    ORDER BY ca.car_type DESC, ca.sort_order ASC
  ) t;

  -- 「其他交通」名單只有總領隊看板需要；小車領隊看板不用（前端本來就丟 []）
  IF v_leader_type = 'small_car' THEN
    v_regs := '[]'::json;
  ELSE
    SELECT COALESCE(json_agg(row_to_json(t2)), '[]'::json) INTO v_regs
    FROM (
      SELECT
        r.registration_id, r.answers, r.checked_in_at, r.checked_in_down_at, r.student_id,
        r.pre_depart_override, r.late_return_override,
        row_to_json(s.*) AS students
      FROM registrations r
      LEFT JOIN LATERAL (
        SELECT st.name,
          (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
        FROM students st WHERE st.student_id = r.student_id
      ) s ON true
      WHERE r.event_id = v_event_id
    ) t2;
  END IF;

  RETURN json_build_object('cars', v_cars, 'regs', v_regs);
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_cars_progress_by_token(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- [76/81] fix_head_leader_checkin_token.sql
-- ------------------------------------------------------------
-- ============================================================
-- 修復：總領隊看板／小車領隊看板點「報到」會失敗的連帶問題
-- 日期：2026-07-15
-- 背景：
--   接續 add_all_cars_progress_by_token_rpc.sql 修復「看得到資料」的問題後，
--   發現總領隊/小車領隊看板點選報到時會呼叫 checkin_car_member / checkin_all_car /
--   checkin_car_monk，這三支 RPC 的驗證邏輯是「p_token 必須等於該台車自己的
--   car_assignments.access_token」——但總領隊/小車領隊看板頁面用的是「看板自己
--   的 head_leader.access_token」，不是被點的那台車的 token，兩者本來就不會相等。
--   這代表這三支 RPC 從 fix_car_token_security.sql（2026-06-07）改成 token 驗證
--   以來，總領隊/小車領隊看板的報到動作其實一直會失敗（只是先前看板本身也是
--   空的，沒人有機會點到）。
--
--   修法：驗證邏輯放寬為「p_token 是該車自己的 token，或是同一活動底下、且
--   權限範圍涵蓋該車的 head_leader token（小車領隊只認得 car_type='small'）」，
--   兩種 token 都放行，維持向下相容（單台車領隊頁面的行為不變）。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

CREATE OR REPLACE FUNCTION checkin_car_member(
  p_token TEXT,
  p_car_id UUID,
  p_registration_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT event_id, car_type INTO v_event_id, v_car_type
  FROM car_assignments WHERE car_id = p_car_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_id %', p_car_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = p_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM events e WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE car_id = p_car_id AND registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_member(TEXT, UUID, UUID, BOOLEAN) TO anon, authenticated;


CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT event_id, car_type INTO v_event_id, v_car_type
  FROM car_assignments WHERE car_id = p_car_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_id %', p_car_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = p_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM events e WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = NOW()
  WHERE car_id = p_car_id AND checked_in_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_all_car(TEXT, UUID) TO anon, authenticated;


CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_car_id   UUID;
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT ck.car_id, ca.event_id, ca.car_type INTO v_car_id, v_event_id, v_car_type
  FROM car_monks ck
  JOIN car_assignments ca ON ca.car_id = ck.car_id
  WHERE ck.id = p_car_monk_id;

  IF v_car_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_monk_id %', p_car_monk_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = v_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM events e WHERE e.event_id = v_event_id
      AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;

-- ------------------------------------------------------------
-- [77/81] add_donor_dynamic_fields.sql
-- ------------------------------------------------------------
-- 功德主管理改動態欄位
-- 1. 新表 event_donor_fields：每個活動自訂功德主欄位（顯示名稱 + 順序）
-- 2. event_donors 新增 answers jsonb（不刪除舊的 5 個具名欄位，當安全網）
-- 3. Backfill：既有活動補建 5 個預設欄位，並把舊欄位值搬進 answers
--
-- RLS/GRANT：只開放 authenticated（比照 2026-06-05 event_donors 安全修正後的實際狀態——
-- donor 相關頁面全部在 ProtectedRoute 後面，沒有 anon 頁面需要存取功德主資料）

-- ════════════════════════════════════════════════════════════
-- 1. event_donor_fields
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_donor_fields (
  field_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  field_key    TEXT        NOT NULL,
  field_label  TEXT        NOT NULL,
  field_order  INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_event_donor_fields_event ON event_donor_fields(event_id);

CREATE OR REPLACE FUNCTION touch_event_donor_fields_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_event_donor_fields_touch ON event_donor_fields;
CREATE TRIGGER trg_event_donor_fields_touch
  BEFORE UPDATE ON event_donor_fields
  FOR EACH ROW EXECUTE FUNCTION touch_event_donor_fields_updated_at();

ALTER TABLE event_donor_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated full access on event_donor_fields" ON event_donor_fields;
CREATE POLICY "authenticated full access on event_donor_fields"
  ON event_donor_fields FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON event_donor_fields TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. event_donors 新增 answers
-- ════════════════════════════════════════════════════════════

ALTER TABLE event_donors ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ════════════════════════════════════════════════════════════
-- 3. Backfill（一次性）
-- ════════════════════════════════════════════════════════════

-- 3.1 對現有功德主資料涉及的活動，若還沒有 event_donor_fields，補建 5 個預設欄位
INSERT INTO event_donor_fields (event_id, field_key, field_label, field_order)
SELECT ev.event_id, f.field_key, f.field_label, f.field_order
FROM (SELECT DISTINCT event_id FROM event_donors) ev
CROSS JOIN (VALUES
  ('donor_item', '功德項目', 0),
  ('seat',       '座位',     1),
  ('corsage',    '胸花',     2),
  ('offering',   '供具',     3),
  ('donor_note', '備註',     4)
) AS f(field_key, field_label, field_order)
WHERE NOT EXISTS (
  SELECT 1 FROM event_donor_fields existing WHERE existing.event_id = ev.event_id
);

-- 3.2 把每筆舊欄位值搬進 answers
UPDATE event_donors
SET answers = jsonb_strip_nulls(jsonb_build_object(
  'donor_item', donor_item,
  'seat',       seat,
  'corsage',    corsage,
  'offering',   offering,
  'donor_note', donor_note
));

-- ------------------------------------------------------------
-- [78/81] fix_leader_scan_rpc.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- [79/81] add_chore_temple_date.sql
-- ------------------------------------------------------------
-- ============================================================
-- chores 表新增 temple（精舍）／chore_date（日期）欄位
-- 日期：2026-07-16
-- 背景：
--   匯入坡務表時，Excel 裡的「精舍」（善高、普宜等分院名稱）與「日期」
--   欄位原本只在匯入預覽畫面顯示（parseChoreExcel 有解析出來），
--   但 importChores 寫入時沒有存進 chores 表，做「匯出總表」功能
--   需要用到這兩欄，所以補上。
--
--   已匯入過坡務表的活動（例如星燈營），這兩欄會是 NULL。
--   ⚠️ 注意：importChores 是直接 INSERT、不是 upsert，對已排過坡的
--   活動「重新匯入」同一份 Excel 會產生整批重複的 chores 列
--   （原本的排坡結果不會不見，但畫面會多一份沒人的空坡務、
--   總表也會統計重複），所以**不建議用重新匯入來補這兩欄**。
--   已排過坡的舊活動如果需要補「精舍／日期」，用 UPDATE 依
--   （event_id, session, sort_order 或 unit+work_content+location）
--   比對後更新，不要用重新匯入；需要的話請提供原始 Excel 再另外處理。
--   新活動之後走「匯入坡務表」就會自動帶入這兩欄，不受影響。
--
-- 執行方式：貼到 Supabase Dashboard → SQL Editor → Run
-- ============================================================

ALTER TABLE chores ADD COLUMN IF NOT EXISTS temple TEXT;
ALTER TABLE chores ADD COLUMN IF NOT EXISTS chore_date TEXT;

-- ------------------------------------------------------------
-- [80/81] add_donor_ticket_copies.sql
-- ------------------------------------------------------------
-- 出單機列印張數：活動層級預設值
ALTER TABLE events ADD COLUMN IF NOT EXISTS donor_ticket_default_copies INTEGER NOT NULL DEFAULT 1;

-- ------------------------------------------------------------
-- [81/81] fix_students_phone_anon_leak.sql
-- ------------------------------------------------------------
-- 安全修正：收緊 students 表的 anon 讀取權限，只留白名單安全欄位
-- （先整表 REVOKE 再用白名單 GRANT，不影響刷 QR 報名與領隊/坡務報到頁，
--   已於 2026-07-19 在正式環境實測驗證，詳見該檔案內註解）
REVOKE SELECT ON students FROM anon;
GRANT SELECT (student_id, qr_code, name, active, created_at) ON students TO anon;

-- ============================================================
-- 第八階段：RPC 主檔整理（2026-07-22，函式健檢後的搬家）
-- 用 CREATE OR REPLACE 蓋掉前面第七階段留下的中間版本，補上合併後的正確欄位
-- 與從未真正上線的安全修正。詳見 sql/MIGRATION_ORDER.md 第八階段說明。
-- ============================================================

-- ------------------------------------------------------------
-- [82/86] rpc_car.sql
-- ------------------------------------------------------------
-- 職責：車輛／隨車法師／領隊 token 相關 RPC 主檔（本檔為這批函式唯一主檔）。
-- get_car_by_token／get_leader_cars／checkin_car_member／checkin_all_car／
-- checkin_car_monk／get_head_leader_by_token／is_token_expired（共 7 支）。
-- 已合併補齊 dormitory_room＋phone 欄位分歧，並補上「活動結束後鎖住」安全修正
-- （原本寫在 lock_expired_token_pages.sql 但從未真正部署到正式環境）。

-- ── get_car_by_token：車輛看板用 token 查詢單台車完整資料（含成員/法師/領隊） ──
CREATE OR REPLACE FUNCTION get_car_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.service_date, ca.pre_depart, ca.late_return,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.access_token = p_token
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date <= ca.service_date)
        OR (ca.service_date IS NULL AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end))
      )
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_car_by_token(TEXT) TO anon, authenticated;

-- ── get_leader_cars：領隊看板用 token 一次查詢自己權限範圍內的多台車 ──
CREATE OR REPLACE FUNCTION get_leader_cars(p_token TEXT, p_car_ids UUID[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  result JSON;
BEGIN
  SELECT event_id INTO v_event_id
  FROM car_assignments WHERE access_token = p_token LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN '[]'::JSON;
  END IF;

  -- 鎖定判斷改在下方主查詢的 WHERE 逐車判斷（每台車自己的 service_date 優先，NULL 才 fallback
  -- 回 e.date_end），不再用「整個活動 date_end 已過」一次鎖住全部——多日活動不同日期的車，
  -- 已過的那幾天鎖住、還沒到的維持開放，不會互相影響。

  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      ca.car_id, ca.car_name, ca.seats, ca.event_id, ca.sort_order,
      ca.direction, ca.service_date, ca.pre_depart, ca.late_return, ca.access_token,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(cm_row)
        FROM (
          SELECT
            cm.registration_id, cm.checked_in_at,
            row_to_json(r.*) AS registrations
          FROM car_members cm
          LEFT JOIN LATERAL (
            SELECT
              reg.registration_id, reg.answers, reg.checked_in_at,
              reg.student_id, reg.dormitory_room,
              row_to_json(s.*) AS students
            FROM registrations reg
            LEFT JOIN LATERAL (
              SELECT st.name, st.student_id, st.phone,
                (SELECT json_agg(sc.*) FROM student_classes sc WHERE sc.student_id = st.student_id) AS student_classes
              FROM students st WHERE st.student_id = reg.student_id
            ) s ON true
            WHERE reg.registration_id = cm.registration_id
          ) r ON true
          WHERE cm.car_id = ca.car_id
        ) cm_row
      ) AS car_members,
      (
        SELECT json_agg(json_build_object('registration_id', cl.registration_id))
        FROM car_leaders cl WHERE cl.car_id = ca.car_id
      ) AS car_leaders,
      (
        SELECT json_agg(json_build_object(
          'id', ck.id, 'monk_id', ck.monk_id, 'checked_in_at', ck.checked_in_at,
          'temple_monks', json_build_object('name', tm.name)
        ))
        FROM car_monks ck
        LEFT JOIN temple_monks tm ON tm.id = ck.monk_id
        WHERE ck.car_id = ca.car_id
      ) AS car_monks
    FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = ANY(p_car_ids)
      AND ca.event_id = v_event_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date <= ca.service_date)
        OR (ca.service_date IS NULL AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end))
      )
  ) t;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leader_cars(TEXT, UUID[]) TO anon, authenticated;

-- ── checkin_car_member／checkin_all_car／checkin_car_monk：報到三支 ──────────
-- 2026-07-15 修復：p_token 除了該車自己的 access_token，也放行同活動、權限涵蓋該車的
-- head_leader token（小車領隊只認得 car_type='small'），讓總領隊/小車領隊看板點報到
-- 不會失敗（fix_head_leader_checkin_token.sql 那次修復，內容原封不動搬過來）。
CREATE OR REPLACE FUNCTION checkin_car_member(
  p_token TEXT,
  p_car_id UUID,
  p_registration_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT event_id, car_type INTO v_event_id, v_car_type
  FROM car_assignments WHERE car_id = p_car_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_id %', p_car_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = p_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > ca.service_date)
        OR (ca.service_date IS NULL AND e.date_end IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end)
      )
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE car_id = p_car_id AND registration_id = p_registration_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_member(TEXT, UUID, UUID, BOOLEAN) TO anon, authenticated;


CREATE OR REPLACE FUNCTION checkin_all_car(p_token TEXT, p_car_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT event_id, car_type INTO v_event_id, v_car_type
  FROM car_assignments WHERE car_id = p_car_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_id %', p_car_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = p_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_id %', p_car_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = p_car_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > ca.service_date)
        OR (ca.service_date IS NULL AND e.date_end IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end)
      )
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_members
  SET checked_in_at = NOW()
  WHERE car_id = p_car_id AND checked_in_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_all_car(TEXT, UUID) TO anon, authenticated;


CREATE OR REPLACE FUNCTION checkin_car_monk(
  p_token TEXT,
  p_car_monk_id UUID,
  p_check_in BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_car_id   UUID;
  v_event_id UUID;
  v_car_type TEXT;
BEGIN
  SELECT ck.car_id, ca.event_id, ca.car_type INTO v_car_id, v_event_id, v_car_type
  FROM car_monks ck
  JOIN car_assignments ca ON ca.car_id = ck.car_id
  WHERE ck.id = p_car_monk_id;

  IF v_car_id IS NULL THEN
    RAISE EXCEPTION 'Invalid car_monk_id %', p_car_monk_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM car_assignments WHERE car_id = v_car_id AND access_token = p_token
  ) AND NOT EXISTS (
    SELECT 1 FROM head_leader
    WHERE access_token = p_token AND event_id = v_event_id
      AND (type <> 'small_car' OR v_car_type = 'small')
  ) THEN
    RAISE EXCEPTION 'Invalid token for car_monk_id %', p_car_monk_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM car_assignments ca
    LEFT JOIN events e ON e.event_id = ca.event_id
    WHERE ca.car_id = v_car_id
      AND (
        (ca.service_date IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > ca.service_date)
        OR (ca.service_date IS NULL AND e.date_end IS NOT NULL AND (NOW() AT TIME ZONE 'Asia/Taipei')::date > e.date_end)
      )
  ) THEN
    RAISE EXCEPTION '活動已結束，無法報到';
  END IF;

  UPDATE car_monks
  SET checked_in_at = CASE WHEN p_check_in THEN NOW() ELSE NULL END
  WHERE id = p_car_monk_id;
END;
$$;

GRANT EXECUTE ON FUNCTION checkin_car_monk(TEXT, UUID, BOOLEAN) TO anon, authenticated;

-- ── get_head_leader_by_token：總領隊／小車領隊看板用 token 查詢自己的權限範圍 ──
CREATE OR REPLACE FUNCTION get_head_leader_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      hl.id, hl.registration_id, hl.event_id, hl.type,
      row_to_json(e.*) AS events,
      (
        SELECT row_to_json(r_row) FROM (
          SELECT
            reg.answers, reg.student_id,
            row_to_json(s.*) AS students
          FROM registrations reg
          LEFT JOIN LATERAL (
            SELECT st.name FROM students st WHERE st.student_id = reg.student_id
          ) s ON true
          WHERE reg.registration_id = hl.registration_id
        ) r_row
      ) AS registrations
    FROM head_leader hl
    LEFT JOIN events e ON e.event_id = hl.event_id
    WHERE hl.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_head_leader_by_token(TEXT) TO anon, authenticated;

-- ── is_token_expired：供前端判斷「查無資料」是無效 token 還是活動已結束 ──
-- 三張公開 token 表（car_assignments / head_leader / chores）共用同一套判斷邏輯，
-- 只回傳布林值，不洩漏任何實際資料，anon 可放心呼叫。
-- 邏輯：token 在任一張表存在且對應活動已結束 → true；
--      token 不存在（單純無效）或活動尚未結束 → false。
CREATE OR REPLACE FUNCTION is_token_expired(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_end DATE;
  v_service_date DATE;
BEGIN
  SELECT e.date_end, ca.service_date INTO v_date_end, v_service_date
  FROM car_assignments ca JOIN events e ON e.event_id = ca.event_id
  WHERE ca.access_token = p_token
  LIMIT 1;

  -- 車輛 token：service_date 優先於 date_end；兩者皆 NULL 才視為「查無資料」繼續往下查
  -- head_leader／chores（這兩張表沒有 service_date 欄位，維持原邏輯）
  IF v_service_date IS NOT NULL THEN
    RETURN (NOW() AT TIME ZONE 'Asia/Taipei')::date > v_service_date;
  END IF;

  IF v_date_end IS NULL THEN
    SELECT e.date_end INTO v_date_end
    FROM head_leader hl JOIN events e ON e.event_id = hl.event_id
    WHERE hl.access_token = p_token
    LIMIT 1;
  END IF;

  IF v_date_end IS NULL THEN
    SELECT e.date_end INTO v_date_end
    FROM chores c JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
    LIMIT 1;
  END IF;

  IF v_date_end IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN (NOW() AT TIME ZONE 'Asia/Taipei')::date > v_date_end;
END;
$$;

GRANT EXECUTE ON FUNCTION is_token_expired(TEXT) TO anon, authenticated;
-- ------------------------------------------------------------
-- [83/86] rpc_chore.sql
-- ------------------------------------------------------------
-- 職責：坡務（義工工作）相關 RPC 主檔（本檔為這批函式唯一主檔）。
-- get_chore_locations_by_event／get_chore_by_token（含活動結束鎖定）。

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

CREATE OR REPLACE FUNCTION get_chore_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT row_to_json(t) INTO result
  FROM (
    SELECT
      c.chore_id, c.event_id, c.session, c.unit, c.work_content, c.location,
      c.supervising_monk, c.supervising_monk_phone, c.leader_name, c.leader_phone,
      c.quota_male, c.quota_female,
      row_to_json(e.*) AS events,
      (
        SELECT json_agg(mem_row)
        FROM (
          SELECT
            cmem.id, cmem.registration_id,
            r.student_id,
            COALESCE(s.name, r.answers->>'guest_name', '訪客') AS name,
            s.phone AS phone,
            (
              SELECT sc.group_name FROM student_classes sc
              WHERE sc.student_id = r.student_id AND (sc.group_name LIKE '%男%' OR sc.group_name LIKE '%女%')
              LIMIT 1
            ) AS group_name,
            (
              SELECT ca.car_name FROM car_members cmm
              JOIN car_assignments ca ON ca.car_id = cmm.car_id
              WHERE cmm.registration_id = r.registration_id
                AND ca.event_id = c.event_id AND ca.direction = 'up'
              LIMIT 1
            ) AS car_name
          FROM chore_members cmem
          JOIN registrations r ON r.registration_id = cmem.registration_id
          LEFT JOIN students s ON s.student_id = r.student_id
          WHERE cmem.chore_id = c.chore_id
        ) mem_row
      ) AS members
    FROM chores c
    LEFT JOIN events e ON e.event_id = c.event_id
    WHERE c.access_token = p_token
      AND (e.date_end IS NULL OR (NOW() AT TIME ZONE 'Asia/Taipei')::date <= e.date_end)
    LIMIT 1
  ) t;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_chore_by_token(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- [84/86] rpc_kiosk_student.sql
-- ------------------------------------------------------------
-- 職責：kiosk_get_registrations_for_student 主檔（本檔為這支函式唯一主檔）。
-- 含 dormitory_room 欄位，回傳欄位組成有變更，用 DROP + CREATE。

DROP FUNCTION IF EXISTS kiosk_get_registrations_for_student(TEXT, UUID[]);

CREATE FUNCTION kiosk_get_registrations_for_student(
  p_student_id TEXT,
  p_event_ids  UUID[]
)
RETURNS TABLE (
  registration_id UUID,
  event_id        UUID,
  student_id      TEXT,
  host_student_id TEXT,
  answers         JSONB,
  is_driver       BOOLEAN,
  registered_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  dormitory_room  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.registration_id,
    r.event_id,
    r.student_id,
    r.host_student_id,
    (r.answers - 'guest_phone') AS answers,
    r.is_driver,
    r.registered_at,
    r.updated_at,
    r.dormitory_room
  FROM registrations r
  WHERE r.event_id = ANY(p_event_ids)
    AND (
      r.student_id      = p_student_id
      OR r.host_student_id = p_student_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION kiosk_get_registrations_for_student(TEXT, UUID[]) TO anon, authenticated;

-- ------------------------------------------------------------
-- [85/86] rpc_events.sql
-- ------------------------------------------------------------
-- 職責：週期性活動（recurring events）相關 RPC 主檔（本檔為這批函式唯一主檔）。
-- create_recurring_events_in_range，含複製動態欄位／義工存取設定的完整版本。
-- 注意：這支函式只由 recurring_batch2.sql 的 pg_cron 排程呼叫，沒有前端直接
-- 呼叫，因此沒有 GRANT TO anon/authenticated（也不需要）。

CREATE OR REPLACE FUNCTION create_recurring_events_in_range(
  p_template_id uuid,
  p_date_start  date,
  p_date_end    date
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  tmpl         recurring_templates%ROWTYPE;
  cur_date     date;
  event_name   text;
  new_event_id uuid;
  created_cnt  int := 0;
  field_rec    jsonb;
  vol_id       text;
  sort_idx     int;
BEGIN
  SELECT * INTO tmpl FROM recurring_templates WHERE template_id = p_template_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  cur_date := p_date_start;

  WHILE cur_date <= p_date_end LOOP
    IF (tmpl.frequency = 'weekly'  AND EXTRACT(DOW FROM cur_date)::int = tmpl.day_of_week)
    OR (tmpl.frequency = 'monthly' AND EXTRACT(DAY FROM cur_date)::int = tmpl.day_of_month)
    THEN
      IF tmpl.prepend_date THEN
        event_name := to_char(cur_date, 'YYYY/MM/DD') || ' ' || tmpl.name;
      ELSE
        event_name := tmpl.name;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM events
        WHERE template_id = p_template_id
          AND date_start  = cur_date
      ) THEN
        INSERT INTO events (
          name, date_start, date_end,
          location, location_tag, event_type, status,
          walkin_mode, kiosk_open, offline_registration, show_on_activities,
          is_recurring, template_id
        ) VALUES (
          event_name, cur_date, cur_date,
          tmpl.location, tmpl.location_tag, tmpl.event_type, 'active',
          tmpl.walkin_mode, tmpl.kiosk_open, tmpl.offline_registration, tmpl.show_on_activities,
          true, p_template_id
        )
        RETURNING event_id INTO new_event_id;

        IF tmpl.fields IS NOT NULL AND jsonb_array_length(tmpl.fields) > 0 THEN
          sort_idx := 1;
          FOR field_rec IN SELECT * FROM jsonb_array_elements(tmpl.fields) LOOP
            INSERT INTO event_fields (
              event_id, field_key, field_label, field_type,
              options, show_if, sort_order, required,
              placeholder, dashboard_role, option_meta
            ) VALUES (
              new_event_id,
              field_rec->>'field_key',
              field_rec->>'field_label',
              field_rec->>'field_type',
              COALESCE(field_rec->'options', '[]'::jsonb),
              field_rec->'show_if',
              sort_idx,
              COALESCE((field_rec->>'required')::boolean, true),
              field_rec->>'placeholder',
              field_rec->>'dashboard_role',
              field_rec->'option_meta'
            );
            sort_idx := sort_idx + 1;
          END LOOP;
        END IF;

        IF tmpl.volunteer_ids IS NOT NULL AND jsonb_array_length(tmpl.volunteer_ids) > 0 THEN
          FOR vol_id IN SELECT jsonb_array_elements_text(tmpl.volunteer_ids) LOOP
            INSERT INTO volunteer_event_access (volunteer_id, event_id)
            VALUES (vol_id::uuid, new_event_id)
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;

        created_cnt := created_cnt + 1;
      END IF;
    END IF;

    cur_date := cur_date + 1;
  END LOOP;

  RETURN created_cnt;
END;
$$;

-- ------------------------------------------------------------
-- [86/86] 第八階段收尾：確認第八階段函式已生效
-- ------------------------------------------------------------
-- SELECT proname FROM pg_proc WHERE proname IN (
--   'get_car_by_token','get_leader_cars','checkin_car_member','checkin_all_car',
--   'checkin_car_monk','get_head_leader_by_token','is_token_expired',
--   'get_chore_locations_by_event','get_chore_by_token',
--   'kiosk_get_registrations_for_student','create_recurring_events_in_range'
-- );

-- ------------------------------------------------------------
-- [87/87] add_donor_dayof_fields.sql（2026-07-22 追加，回山活動功德主通知功能）
-- ------------------------------------------------------------
-- 回山活動功德主通知：當天資訊管理欄位
-- 1. events.has_donor_notify：獨立開關，控制「功德主通知」功能是否開放（任何 event_type 皆可用）
--    跟既有 is_dharma（精舍法會報到用途）互不影響，刻意分開。
-- 2. event_donors.lunch_table / is_table_leader：活動當天午齋桌次與桌長標記。
--    「合影波次」不新增欄位，沿用既有 event_donor_fields 自訂欄位機制（field_key: photo_wave）。
--
-- 注意：event_donors 的 anon 權限修復（fix_event_donors_anon_leak.sql）不排在這裡——
-- 那件事在 [52/81] fix_rls_clean.sql 就已經做過了（DROP POLICY + REVOKE event_donors 的
-- anon 權限），這裡再排一次是重複定義。fix_event_donors_anon_leak.sql 保留為獨立小工具，
-- 只給「只跑過 schema.sql、沒跑完整套 migration」的舊環境單獨執行救急用，見該檔案開頭註解。

ALTER TABLE events        ADD COLUMN IF NOT EXISTS has_donor_notify BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE event_donors  ADD COLUMN IF NOT EXISTS lunch_table       TEXT;
ALTER TABLE event_donors  ADD COLUMN IF NOT EXISTS is_table_leader   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.has_donor_notify        IS '是否開放功德主通知功能（回山等外出活動用；與 is_dharma 精舍法會報到用途互不影響）';
COMMENT ON COLUMN event_donors.lunch_table       IS '活動當天午齋桌次（當天資訊管理頁填寫）';
COMMENT ON COLUMN event_donors.is_table_leader   IS '是否為該桌桌長（發送當天通知時，桌長會額外收到一則全桌名單訊息）';

-- ------------------------------------------------------------
-- [88/88] add_multiday_transport_and_small_overrides.sql（2026-08-04 追加，多日回山排車＋大車移小車持久化）
-- ------------------------------------------------------------
-- 多日回山排車：events.multi_day_transport 開關 + car_assignments.service_date（車輛服務日期）。
-- 大車移小車持久化：新表 car_small_overrides，取代原本只存在前端 state 的 guestSmallOverrides。
-- 只套用到之後新建的活動，不回填任何舊資料。

ALTER TABLE events ADD COLUMN IF NOT EXISTS multi_day_transport BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN events.multi_day_transport IS '多日交通安排：開啟後報名表單出現參加日期/是否掛單欄位，排車頁出現日期籤';

ALTER TABLE car_assignments ADD COLUMN IF NOT EXISTS service_date DATE;
COMMENT ON COLUMN car_assignments.service_date IS '這台車服務的日期，NULL=單日活動（沿用舊行為）';
CREATE INDEX IF NOT EXISTS idx_car_assignments_event_date_dir ON car_assignments(event_id, service_date, direction);

CREATE TABLE IF NOT EXISTS car_small_overrides (
  registration_id      UUID PRIMARY KEY REFERENCES registrations(registration_id) ON DELETE CASCADE,
  direction             TEXT NOT NULL CHECK (direction IN ('up','down')),
  service_date          DATE,
  target_driver_reg_id  UUID NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE car_small_overrides IS '師父手動把大車的人移到某台小車（用司機的 registration_id 識別那台小車），取代原本只存在前端 state 的 guestSmallOverrides';
CREATE INDEX IF NOT EXISTS idx_car_small_overrides_target ON car_small_overrides(target_driver_reg_id);

ALTER TABLE car_small_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth full access on car_small_overrides" ON car_small_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON car_small_overrides TO authenticated;

-- ------------------------------------------------------------
-- 第十階段收尾：確認 rpc_car.sql 已用 service_date 重新部署（本檔案上方 [82/86] 區塊即為最新版）
-- ------------------------------------------------------------
