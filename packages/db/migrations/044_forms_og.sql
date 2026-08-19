-- 044_forms_og.sql
-- forms に OGP 手動上書き用カラム3つを追加。NULL なら forms.name / description 自動マッピング。

ALTER TABLE forms ADD COLUMN og_title TEXT;
ALTER TABLE forms ADD COLUMN og_description TEXT;
ALTER TABLE forms ADD COLUMN og_image_url TEXT;
