-- auto_replies に template_id 追加。NULL のときは既存 response_content/response_type を使う
-- (resolution は worker 側で template_id 優先 / fallback)。
ALTER TABLE auto_replies ADD COLUMN template_id TEXT
  REFERENCES templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_auto_replies_template_id
  ON auto_replies(template_id);
