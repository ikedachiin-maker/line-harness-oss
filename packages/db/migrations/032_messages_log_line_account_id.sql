-- 032_messages_log_line_account_id.sql
--
-- messages_log に line_account_id カラムを追加する。
--
-- 動機: per-account-stats endpoint が「この broadcast はアカ別に何通送ったか」を集計
-- する際、現状は friends.line_account_id で GROUP BY していた。しかし
-- friends.line_account_id は webhook の handleEvent や account migration で書き換わる
-- mutable フィールドなので、過去の送信履歴を後から呼び戻すと現在のアカウント帰属で
-- 集計され、「実際に送ったチャネル」と乖離する。
--
-- 送信時点のアカウントを messages_log 行に直接刻むことで歴史の改竄を防ぐ。
-- 既存行 (column 追加直後) は NULL のまま残るので、SQL 側は COALESCE で
-- friends.line_account_id にフォールバックして互換性を保つ。
ALTER TABLE messages_log ADD COLUMN line_account_id TEXT;

-- per-account-stats endpoint は messages_log を broadcast_id で頻繁に検索する
-- (送信中は 3 秒ごとの polling)。FK 宣言だけでは SQLite は自動 index しないので
-- 明示 index で full table scan を防ぐ。
CREATE INDEX IF NOT EXISTS idx_messages_log_broadcast_id ON messages_log(broadcast_id);
