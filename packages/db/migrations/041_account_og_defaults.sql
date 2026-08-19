-- 041_account_og_defaults.sql
-- line_accounts に OGP（リンクプレビュー）のアカウントデフォルト値を追加。
-- og_site_name が NULL のとき、UI/Worker は display_name にフォールバックする。

ALTER TABLE line_accounts ADD COLUMN og_site_name TEXT;
ALTER TABLE line_accounts ADD COLUMN og_default_image_url TEXT;
ALTER TABLE line_accounts ADD COLUMN og_default_description TEXT;
