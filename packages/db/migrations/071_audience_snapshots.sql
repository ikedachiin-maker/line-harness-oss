-- Migration 071: 全チャネルの名簿規模を1箇所で数える
--
-- 狙い (2026-09-11 池田):
--   メルマガ読者数・LINE友だち数・各SNSのフォロワー数を、1つのサイトで見たい。
--
-- いま5ハーネス + UTAGE に数字が散らばっていて、どれも形が違う:
--   line-harness  friends (is_following=1)
--   x-harness     followers / follower_snapshots
--   ig-harness    followers
--   threads       followers テーブル自体が無い (publish専用。Threads API から取る)
--   mail-harness  subscribers (status='active')
--   UTAGE         メルマガ読者の正本。ここは解約できないので外部のまま残る
--
-- 名簿そのものを寄せ集めることはしない。人の正本は各チャネル/UTAGE のまま置き、
-- **「その日その名簿が何人だったか」だけ**をここに日次で積む。
-- 寄せるのが数字だけなら、同期ズレも二重登録も起きない。
--
-- 入り方は2通りある。どちらもこの1テーブルに着地する:
--   pull   … line-harness の cron が各ハーネスの GET /api/audience を叩く
--   report … 叩けない相手が POST /api/audience/report で送り込む
--             (UTAGE は認証の都合で ikeda-os 経由。そちらが report を使う)
CREATE TABLE IF NOT EXISTS audience_snapshots (
  id            TEXT PRIMARY KEY,
  -- 'line' | 'mail' | 'x' | 'instagram' | 'threads' など。増えても schema は触らない
  channel       TEXT NOT NULL,
  -- チャネル内でアカウントを一意にする値 (line_account_id / @handle / リストID)
  account_key   TEXT NOT NULL,
  -- 画面に出す名前。account_key が内部IDのときに人が読めるようにする
  account_label TEXT,
  total         INTEGER NOT NULL,
  -- 'self'(自分のDBを数えた) | 'poll'(相手のAPIを叩いた) | 'report'(送られてきた)
  source        TEXT NOT NULL DEFAULT 'poll',
  -- JST の日付 (YYYY-MM-DD)。1日1行に畳む単位
  captured_on   TEXT NOT NULL,
  captured_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  -- 同じ日に何度取り直しても行が増えないようにする。cron は毎分回るので
  -- これが無いと1日1,440行積む。UPSERT で最後の値が残る
  UNIQUE (channel, account_key, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_audience_snapshots_day
  ON audience_snapshots (captured_on DESC);
CREATE INDEX IF NOT EXISTS idx_audience_snapshots_series
  ON audience_snapshots (channel, account_key, captured_on DESC);
