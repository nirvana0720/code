-- 2026-07-12 功能1 安單寮號：對外公開開關（獨立於 show_transport_to_public）
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_dormitory_to_public BOOLEAN DEFAULT false;
