-- migration-policy: allow-recreate — NOT NULL を外すには SQLite ではテーブルを
--   作り直すしかない。DROP TABLE は使わず旧テーブルを _pre070 として残す形にした。
--   目的と背景は下の解説を参照。

-- Migration 070: チャネル非依存のコンバージョン計測
--
-- 背景 (harness 統合 GOAL A / 2026-09-10):
--   LINE / Threads / X / IG / メール の5ハーネスで「どの投稿から来た人が
--   いくら払ったか」を1本に繋ぐ、という目的に対して、line-harness が唯一の
--   ハブになれる器を既に持っている (users / entry_routes / ref_tracking /
--   affiliates / affiliate_links / affiliate_offers)。
--
--   ところが最初のオプトインをメールで取った人は LINE を通らないため
--   friends に行が作れない。friends.line_user_id が UNIQUE NOT NULL だからだ。
--   その結果 conversion_events.friend_id NOT NULL が成果の記録を丸ごと塞ぐ。
--   実測したところ、塞いでいるのはこの1箇所だけだった:
--
--     friends.line_user_id        TEXT UNIQUE NOT NULL  ← LINE 前提 (これは正しい)
--     conversion_events.friend_id TEXT NOT NULL         ← ここが余計な制約
--
--   users は既にチャネル非依存 (id / email / phone / external_id) で email に
--   索引まで張ってあり、conversion_events.user_id の口も既にある。よって
--   friends を汎用化するのではなく、CV を「friend か user のどちらかに紐づく」
--   ものに緩めるのが最小の変更になる。
--
-- このマイグレーションがやること:
--   1. ref_tracking.user_id を追加 — LINE 友だちが存在しない ref タッチ
--      (メール登録・UTAGE オプトイン) を記録できるようにする
--   2. conversion_events を作り直して friend_id を nullable にし、
--      「friend_id か user_id のどちらかは必ず入る」CHECK を足す
--
-- friends 側は一切触らない。LINE チャネル行としての friends の意味 (line_user_id
-- が必須) はそのまま正しい。

-- ============================================================
-- Part 1: ref_tracking.user_id
-- ============================================================
-- friend_id は元から nullable なので、user_id を足すだけで「LINE を通らない
-- 人の ref タッチ」が表現できる。両方 NULL の行 (誰か分からない生クリック) も
-- 従来どおり許す — /r/:ref のランディング計測がそれに当たる。
ALTER TABLE ref_tracking ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ref_tracking_user ON ref_tracking (user_id);
CREATE INDEX IF NOT EXISTS idx_ref_tracking_user_created ON ref_tracking (user_id, created_at);

-- ============================================================
-- Part 2: conversion_events.friend_id を nullable に (table recreate)
-- ============================================================
-- SQLite は NOT NULL を in-place で外せないので作り直す。手順の元は
-- migrations/027_dedup_delivery.sql / 029_account_management_v2.sql。
--
-- ただしその2本と違い DROP TABLE は使わない。旧テーブルは
-- conversion_events_pre070 として残す:
--
--   - D1 の `wrangler d1 execute --file` は文をトランザクションで束ねない。
--     DROP → RENAME の間で落ちると CV が丸ごと消える。残せばその窓が無くなる
--   - リポジトリの追加専用ポリシー (scripts/check-migrations.ts) は DROP TABLE を
--     常に禁じている。この形なら DROP を1つも使わずに済む
--   - 中身を確認したあと人間が手で落とせる (急がない。数千行のテキスト)
--
-- 既存データの形 (schema.sql + migrations 001-069 を適用して確認):
--   - 11カラム、index は point / friend / affiliate の3本 + PK autoindex
--   - user_id は FK 無しの素の TEXT。作り直しでも FK は足さない
--     (既存行の user_id が users に無い可能性があり、FK を足すと D1 の
--      外部キー強制で INSERT が落ちうる)
--
-- CHECK は新規の制約なので既存行が違反しないことが要る。既存行はすべて
-- friend_id NOT NULL なので必ず通る。
CREATE TABLE conversion_events_new (
  id                   TEXT PRIMARY KEY,
  conversion_point_id  TEXT NOT NULL REFERENCES conversion_points (id) ON DELETE CASCADE,
  friend_id            TEXT REFERENCES friends (id) ON DELETE CASCADE,
  user_id              TEXT,
  affiliate_code       TEXT,
  metadata             TEXT,
  affiliate_id         TEXT REFERENCES affiliates (id),
  attributed_ref_code  TEXT,
  approval_status      TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  approved_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  -- CV は必ず誰かに紐づく。片方が NULL でも、両方 NULL の孤児 CV は作らせない。
  CHECK (friend_id IS NOT NULL OR user_id IS NOT NULL)
);

INSERT INTO conversion_events_new (
  id, conversion_point_id, friend_id, user_id, affiliate_code, metadata,
  affiliate_id, attributed_ref_code, approval_status, approved_at, created_at
) SELECT
  id, conversion_point_id, friend_id, user_id, affiliate_code, metadata,
  affiliate_id, attributed_ref_code, approval_status, approved_at, created_at
FROM conversion_events;

-- 旧テーブルは退避して残す (消さない)。
--
-- 代償: 新規インストールでもこの ALTER は走るので、空の
-- conversion_events_pre070 が bootstrap.sql に載る。データが1行も無いテーブルが
-- 1つ増えるだけなので、CV 履歴を失う窓と引き換えなら安いと判断した。
-- 中身を確認したあと、運用者が手で `DROP TABLE conversion_events_pre070;` して
-- よい (このリポジトリの追加専用ポリシー上、DROP をマイグレーションには書けない)。
ALTER TABLE conversion_events RENAME TO conversion_events_pre070;
ALTER TABLE conversion_events_new RENAME TO conversion_events;

-- ⚠ RENAME TO は index を「名前を保ったまま」旧テーブルに連れていく。
-- つまりこの時点で idx_conversion_events_point は conversion_events_pre070 の
-- index になっている。ここを飛ばすと、下の CREATE INDEX IF NOT EXISTS が
-- 「同名が既にある」として黙って何もせず、本番テーブルが index ゼロで走り出す
-- (この罠を実際に踏んで気づいた)。
-- 退避テーブルは読まないので index は要らない。先に落として名前を空ける。
DROP INDEX IF EXISTS idx_conversion_events_point;
DROP INDEX IF EXISTS idx_conversion_events_friend;
DROP INDEX IF EXISTS idx_conversion_events_affiliate;
-- _user も落とす。新規インストールは schema.sql から作るので、このマイグレーションが
-- 走る時点で既にこの名前が存在する (そして RENAME で退避テーブル側へ移っている)。
DROP INDEX IF EXISTS idx_conversion_events_user;

CREATE INDEX IF NOT EXISTS idx_conversion_events_point ON conversion_events (conversion_point_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_friend ON conversion_events (friend_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_affiliate ON conversion_events (affiliate_code);
-- 新規: user 起点の CV を引くため (メール/UTAGE 経由のレポート)
CREATE INDEX IF NOT EXISTS idx_conversion_events_user ON conversion_events (user_id);
