-- Migration 072: 管理画面のログインをメールアドレス+パスワードにする
--
-- 背景 (2026-09-11 池田):
--   管理画面のログインが API キーを貼り付ける方式だった。実運用で困る点が3つある。
--
--   1. **セッションCookieの中身が API キーそのものだった。** Cookie を盗まれたら
--      API キーを盗まれたのと同じで、しかも「そのログインだけ無効化する」ことが
--      できない。止めるにはキー本体を回して全ての機械側を作り直すしかない
--   2. 人ごとに分けられない。誰がログインしたのかが記録に残らない
--   3. 人間が覚えて入力できる形ではない
--
-- admin_users テーブルは 001_round2.sql の時点から存在していたが、コードから
-- 一度も参照されておらず 0 行のままだった (実測)。器はあったので、それを使う。
--
-- **機械の認証は一切変えない。** SDK / MCP / ハーネス間のポーリング /
-- ikeda-os の集計スクリプトは Authorization: Bearer <API キー> のまま動く。
-- 変わるのはブラウザからのログインだけ。
--
-- env の API キーは break-glass として残す。パスワードを失ってもロックアウト
-- されないため、そして最初の1人を作る足場として必要なため。

-- ============================================================
-- Part 1: admin_users を実用に足りる形にする
-- ============================================================
-- 既存は id / email / password_hash / created_at の4列しか無い。
-- すべて DEFAULT 付きの ADD COLUMN なので、追加専用ポリシーに収まる。

-- 画面に出す名前。staff (予約のスタッフ) とは別概念なので独立して持つ。
ALTER TABLE admin_users ADD COLUMN name TEXT;

-- 既存の権限モデル (owner / admin / staff) に合わせる。認証後はこの役割が
-- そのまま c.set('staff') に載るので、role-guard の判定が変わらずに済む。
ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

-- 初期パスワードを配った直後は必ず変えさせる。1 の間はログインしても
-- パスワード変更以外の API を通さない。
ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

ALTER TABLE admin_users ADD COLUMN last_login_at TEXT;
ALTER TABLE admin_users ADD COLUMN updated_at TEXT;

-- 総当たり対策。失敗を数えて、続いたら一定時間締める。
-- Workers には共有のレート制限が無いので DB 側に置く。
ALTER TABLE admin_users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN locked_until TEXT;

-- email は元から UNIQUE だが大文字小文字を区別する。同じ人が Foo@ と foo@ で
-- 2行作れてしまうので、小文字で一意にする索引を足す (書き込み側でも小文字に
-- 正規化するが、索引があれば経路が増えても崩れない)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email_lower
  ON admin_users (lower(email));

-- ============================================================
-- Part 2: セッション
-- ============================================================
-- Cookie に入れるのは「ランダムな入場券」で、API キーではない。
--
-- 保存するのは券そのものではなく **SHA-256 のハッシュ**。DB が漏れても、
-- そこからログインできる券は作れない。照合は受け取った券をハッシュして引く。
--
-- これで「この端末のログインだけ無効化する」ができるようになる
-- (API キー方式ではキー本体を回すしかなかった)。
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash    TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions (admin_user_id);
-- 期限切れの掃除用。cron から古い行を落とす。
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions (expires_at);
