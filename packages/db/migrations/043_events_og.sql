-- 043_events_og.sql
-- events に OGP 手動上書き用カラム3つを追加。NULL なら events.name / description / image_url 自動マッピング。

ALTER TABLE events ADD COLUMN og_title TEXT;
ALTER TABLE events ADD COLUMN og_description TEXT;
ALTER TABLE events ADD COLUMN og_image_url TEXT;
