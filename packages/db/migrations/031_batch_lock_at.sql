-- 031_batch_lock_at.sql
--
-- batch_offset=-1 でロックを取った時刻を保持するカラムを追加する。
--
-- 動機: recoverStalledBroadcasts は今まで `created_at` から 30 分経過を判定基準に
-- していたが、created_at は draft 作成時刻であり、実際のロック取得時刻とは
-- ずれる (例: Monday 作成 / Tuesday 送信)。古い broadcast を Tuesday に送ると
-- ロック取得直後でも recover の閾値を超えており、`waitUntil` パスでまだ走って
-- いる Worker と並走して重複配信する race window が生じていた。
--
-- batch_lock_at をロック取得時に同時更新し、recover 側はこちらを参照することで
-- 「lock 取得後 N 分経過」だけを見れる。
--
-- 注意: created_at は jstNow() で `+09:00` suffix 付きで書かれている一方、
-- recover の比較は julianday('now', '+9 hours') (naive JST) を使う。両者を直接
-- 比較すると SQLite が offset 付きを UTC 正規化して 9 時間ズレるため、
-- recover 側は **batch_lock_at ベースのみ** に統一し、batch_lock_at は本マイグレーション
-- 以降ずっと naive JST 形式 (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')) で
-- 書く設計にしている (worker/services/broadcast.ts の lock UPDATE 参照)。
ALTER TABLE broadcasts ADD COLUMN batch_lock_at TEXT;

-- 在庫処理: マイグレーション apply 時点で既に batch_offset=-1 の状態にある
-- 旧 row (resume 機能 deploy 直前にロックされていた broadcast) に対して
-- batch_lock_at を現在時刻で backfill する。これがないと recover 側が
-- `batch_lock_at IS NOT NULL` 条件で素通りして、永久に stuck 状態になる。
UPDATE broadcasts
   SET batch_lock_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
 WHERE status = 'sending' AND batch_offset = -1 AND batch_lock_at IS NULL;
