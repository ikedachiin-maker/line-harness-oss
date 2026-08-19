-- scenario_steps: テンプレ参照 + 到達タグ付与
ALTER TABLE scenario_steps ADD COLUMN template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;
ALTER TABLE scenario_steps ADD COLUMN on_reach_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;

-- messages_log: 配信時点で使ったテンプレ ID を記録（FK 制約なし、テンプレ削除後も履歴を残す）
ALTER TABLE messages_log ADD COLUMN template_id_at_send TEXT;
