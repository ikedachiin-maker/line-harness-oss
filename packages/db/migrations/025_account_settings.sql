-- Account-level settings (test recipients, etc.)
CREATE TABLE IF NOT EXISTS account_settings (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(line_account_id, key)
);
