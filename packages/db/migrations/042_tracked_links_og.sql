-- 042_tracked_links_og.sql
-- tracked_links に OGP 手動上書き用カラム3つを追加。NULL なら自動生成にフォールバック。

ALTER TABLE tracked_links ADD COLUMN og_title TEXT;
ALTER TABLE tracked_links ADD COLUMN og_description TEXT;
ALTER TABLE tracked_links ADD COLUMN og_image_url TEXT;
