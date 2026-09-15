-- 074: Chatwork 双方向リレー（池田独自・上流に無い）
--
-- LINE 友だちからの受信を、アカウントごとに決めた Chatwork ルームへ流し、
-- Chatwork の「返信」で書いた本文をその友だちの LINE に push する。
--
-- line_accounts.chatwork_room_id … このアカウント宛の受信を流す Chatwork ルーム。
--   NULL なら Chatwork 連携なし（従来どおり）。
-- chatwork_relay_messages … Chatwork に投稿した通知の message_id と友だちの対応表。
--   Chatwork の返信タグ [rp aid=… to=ROOM-MSGID] の MSGID からここを引いて返信先を決める。
--   投稿した通知1件につき1行。友だちが消えたら一緒に消える。

ALTER TABLE line_accounts ADD COLUMN chatwork_room_id TEXT;

CREATE TABLE IF NOT EXISTS chatwork_relay_messages (
  cw_message_id   TEXT PRIMARY KEY,
  cw_room_id      TEXT NOT NULL,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  line_account_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_chatwork_relay_friend ON chatwork_relay_messages (friend_id);
