-- バッチ送信キュー対応: batch_offset と segment_conditions を追加
ALTER TABLE broadcasts ADD COLUMN batch_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN segment_conditions TEXT;
