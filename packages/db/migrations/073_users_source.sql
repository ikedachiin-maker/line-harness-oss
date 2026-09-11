-- 073: users に「どこから来た人か」を持たせる
--
-- users はチャネル非依存の人テーブルだが、これまで入る経路が mail-harness の
-- /subscribe と UTAGE の受け口だけで、行数も1桁だった。UTAGE のメルマガ読者
-- 13,000 人を「人」として取り込む(2026-09-11 の池田の判断)にあたり、
-- 友だち管理の画面で LINE 友だちと並べて見分けられる必要がある。
--
-- 名簿の正本は UTAGE のまま。ここに入るのは計測と閲覧のための影で、
-- どの名簿の影なのかを source / source_list で持つ。
--
--   source       … 'utage' / 'mail-harness' など。出どころのシステム
--   source_list  … 出どころの中の名簿の識別子。名簿規模の系列 key と同じ語彙
--                  (utage-purchasers / utage-mailmaga-error / utage-mnp-consult)
--   source_label … 画面に出す名簿の名前(購入者リスト 等)
--   subscribed_at … 出どころでの登録日時。users.created_at は取り込んだ日になって
--                  しまうので、並べ替えにはこちらを使う
--
-- 追加のみ。既存行は全部 NULL のまま(= 出どころ不明)で壊れない。
ALTER TABLE users ADD COLUMN source TEXT;
ALTER TABLE users ADD COLUMN source_list TEXT;
ALTER TABLE users ADD COLUMN source_label TEXT;
ALTER TABLE users ADD COLUMN subscribed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_source ON users (source, source_list);
CREATE INDEX IF NOT EXISTS idx_users_subscribed_at ON users (subscribed_at);
