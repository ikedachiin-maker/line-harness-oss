CREATE TABLE IF NOT EXISTS form_opens (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  friend_id TEXT,
  friend_name TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_opens_form ON form_opens (form_id, opened_at);
