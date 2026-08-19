-- Migration 035: Rich Menu Editor — groups / pages / areas
-- See: docs/superpowers/specs/2026-05-08-rich-menu-editor-design.md
--
-- 1 group = 1 リッチメニューセット (1 ページ構成も 1 group として扱う)
-- 1 page  = タブ 1 枚 = LINE 上の richmenu 1 個
-- areas[] = 1 page につき最大 20 (LINE 上限)
--
-- alias_id は決定論的に lhx-{groupId 先頭 8 文字}-{order_index} で命名。
-- LINE alias の制約「1〜100 文字、英数字＋ハイフン」を満たす。
-- richmenuswitch アクションの遷移先は self の page_id (action_data.targetPageId) で
-- 持つことで、再 publish の際に最新 alias_id へ解決できる。

CREATE TABLE IF NOT EXISTS rich_menu_groups (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  chat_bar_text      TEXT NOT NULL,
  size               TEXT NOT NULL CHECK (size IN ('large','compact')),
  default_page_id    TEXT,
  is_default_for_all INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  publishing_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS rich_menu_pages (
  id                 TEXT PRIMARY KEY,
  group_id           TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  order_index        INTEGER NOT NULL,
  name               TEXT NOT NULL,
  alias_id           TEXT NOT NULL,
  line_richmenu_id   TEXT,
  image_r2_key       TEXT,
  image_content_type TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (group_id, order_index)
);

CREATE TABLE IF NOT EXISTS rich_menu_areas (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES rich_menu_pages(id) ON DELETE CASCADE,
  bounds_x        INTEGER NOT NULL,
  bounds_y        INTEGER NOT NULL,
  bounds_width    INTEGER NOT NULL,
  bounds_height   INTEGER NOT NULL,
  action_type     TEXT NOT NULL CHECK (action_type IN ('uri','message','postback','richmenuswitch')),
  action_data     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_pages_group  ON rich_menu_pages(group_id, order_index);
CREATE INDEX IF NOT EXISTS idx_rich_menu_areas_page   ON rich_menu_areas(page_id);
CREATE INDEX IF NOT EXISTS idx_rich_menu_groups_account ON rich_menu_groups(account_id, status);
