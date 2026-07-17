-- 出單機列印張數：活動層級預設值
ALTER TABLE events ADD COLUMN IF NOT EXISTS donor_ticket_default_copies INTEGER NOT NULL DEFAULT 1;
