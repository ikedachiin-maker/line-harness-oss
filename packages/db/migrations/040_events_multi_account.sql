-- 040_events_multi_account.sql
-- events を broadcasts と同型の multi-account-dedup 構造に拡張。
-- 既存 events はすべて target_type='single' で動作不変。
-- See: docs/superpowers/specs/2026-05-11-event-booking-multi-account-design.md

ALTER TABLE events ADD COLUMN target_type TEXT NOT NULL DEFAULT 'single'
  CHECK (target_type IN ('single', 'multi-account-dedup'));
ALTER TABLE events ADD COLUMN account_ids TEXT
  CHECK (account_ids IS NULL OR json_valid(account_ids));
ALTER TABLE events ADD COLUMN dedup_priority TEXT
  CHECK (dedup_priority IS NULL OR json_valid(dedup_priority));
ALTER TABLE events ADD COLUMN failed_account_ids TEXT
  CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids));

-- identity_key for cross-account 同一人物検知 (broadcasts の IDENTITY_KEY_SQL
-- と同じ算出式: url_token > user_id > id) を POST 時にアプリ側で計算して
-- 書き込む。重複制限は events.max_bookings_per_friend と組み合わせて
-- アプリ層で実施 (max=N まで許容するため DB 側 UNIQUE は使わない)。
ALTER TABLE event_bookings ADD COLUMN identity_key TEXT;
UPDATE event_bookings SET identity_key = 'solo:' || id WHERE identity_key IS NULL;

-- 集計クエリ高速化用のインデックス (UNIQUE ではない)。
-- max_bookings_per_friend 制約や my_existing_booking 検出で
-- (event_id, identity_key, status) の lookup が頻発するため。
CREATE INDEX idx_event_bookings_identity_status
  ON event_bookings (event_id, identity_key, status);
