-- 038_entry_routes_pool_and_push.sql
-- Add pool_id (送り先 Pool), intro_template_id (即時 push テンプレ),
-- run_account_friend_add_scenarios (アカウント標準 friend_add シナリオ併走フラグ).
-- All NULL/default values keep existing rows behaviorally identical.

ALTER TABLE entry_routes
  ADD COLUMN pool_id TEXT REFERENCES traffic_pools (id) ON DELETE SET NULL;

ALTER TABLE entry_routes
  ADD COLUMN intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL;

ALTER TABLE entry_routes
  ADD COLUMN run_account_friend_add_scenarios INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_entry_routes_pool ON entry_routes (pool_id);
