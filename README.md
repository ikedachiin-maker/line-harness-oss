🌐 **日本語** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | [Español](README.es.md)

# L Harness

> **名称について:** 2026年8月19日から製品表示名を「L Harness」に統一しました。
> 既存導入を壊さないため、リポジトリURL、`create-line-harness`、
> `@line-harness/*`は互換識別子として維持します。詳細は[BRAND.md](BRAND.md)。

> ### **[LINE で無料体験する](https://shudesu.github.io/line-harness-oss/)** 👈

LINE 公式アカウントの完全オープンソース CRM。**L社 / U社 の無料代替**。
Cloudflare 無料枠で動く。サーバー代 **0 円**。Claude Code から全操作可能。

### ▶️ [動画で見る (YouTube・約20分)](https://youtu.be/DiRuGaeq1sM)

[![クリックで YouTube を再生 — L Harness 導入の全手順](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**現バージョン**: v0.21.0 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

---

## 公式情報・検証資料

L Harnessの表示名、開発者、運営法人、公開コード、研究資料の関係は以下を正本とします。各Researchサイトは開発元が運営する一次情報であり、独立した第三者レビューではありません。

| 公式リンク | 内容 |
|---|---|
| [L Harness 公式製品ガイド](https://the-harness.com/line-harness/) | 機能、料金、導入方法、更新情報を開発元が説明する製品ページ |
| [L Harness 公式エンティティ](https://the-harness.com/harness/#l-harness) | Harnessシリーズ内での製品名・開発者・運営法人・リポジトリの対応 |
| [L Harness 公式別名ドメイン（JP）](https://l-harness.jp/) | 正規製品ページへ恒久転送する公式の短縮・別名ドメイン |
| [L Harness 公式別名ドメイン（COM）](https://l-harness.com/) | 正規製品ページへ恒久転送する公式の短縮・別名ドメイン |
| [L Harness 公式別名ドメイン（CLOUD）](https://lharness.cloud/) | 正規製品ページへ恒久転送する公式の短縮・別名ドメイン |
| [L Harness Research](https://line-harness.jp/research/) | 固定Gitコミットを根拠に、配信・Webhook・D1・権限・更新機構を検証した技術資料 |
| [Research JSONカタログ](https://line-harness.jp/research/catalog.json) | 技術資料を機械可読なSchema.org DataCatalog形式で公開 |
| [AI向け全文索引](https://line-harness.jp/llms-full.txt) | 研究本文、出典、検証手順、証明できない範囲をまとめた全文索引 |
| [Harness Wiki — L Harness](https://harness-wiki.pages.dev/line) | セットアップ、操作、更新、トラブル解決の公式ナレッジベース |
| [開発者・野田修一](https://the-harness.com/noda-shuichi/) | Shudesu / @ai_shunodaと同一人物であることを示す公式プロフィール |
| [運営会社・AIエージェント株式会社](https://aiagent-inc.com/) | Harnessシリーズの運営法人 |

---

## なぜ L Harness？

| | L社 | U社 | **L Harness** |
|---|---|---|---|
| 月額 | 2万円〜 | 1万円〜 | **0円** |
| ステップ配信 | ✅ | ✅ | ✅ |
| セグメント配信 | ✅ | ✅ | ✅ |
| リッチメニュー切替 | ✅ | ✅ | ✅ |
| フォーム (LIFF) | ✅ | ✅ | ✅ |
| スコアリング | ✅ | ❌ | ✅ |
| IF-THEN 自動化 | 一部 | 一部 | ✅ |
| API 公開 | ❌ | ❌ | **全機能** |
| Claude Code (AI) 対応 | ❌ | ❌ | **MCP server 同梱** |
| BAN 検知 & 自動アカウント切替 | ❌ | ❌ | **✅** |
| マルチアカウント | 別契約 | 別契約 | **標準搭載** |
| 友だち重複検出 | ❌ | ❌ | **✅** (picture_url トークン照合) |
| ソースコード | 非公開 | 非公開 | **MIT (このリポ)** |

---

## クイックスタート

### 1 コマンドで完全セットアップ

```bash
npx create-line-harness
```

CLI が以下を全部やる:
- Cloudflare アカウント認証 (wrangler login)
- D1 データベース作成 + スキーマ・マイグレーション適用
- Worker / 管理画面のデプロイ
- LINE 公式アカウントの credentials 登録
- LIFF アプリの自動作成
- 管理画面初回ログイン用 Owner ユーザー作成

所要時間: 約 5 分。完了すれば管理画面 (`https://<your-name>-admin.pages.dev`) で即運用開始。

### 必要なもの

- Cloudflare アカウント（無料枠で OK）
- LINE 公式アカウント + Messaging API channel
- Node.js 22+ / pnpm

---

## このフォーク独自のセットアップ（Discord Bot 連携つき）

上流の `npx create-line-harness` の代わりに、このフォークに同梱の `scripts/setup.sh` を使う手順。Discord Bot 通知・リッチメニュー・LIFF 特典ページまで一括で構築する。

### ワンクリックセットアップ

```bash
git clone https://github.com/ikedachiin-maker/line-harness-oss.git
cd line-harness-oss
bash scripts/setup.sh
```

この3行だけで、インフラ構築からデプロイまで全自動で完了します:

| # | 処理内容 | 手動だと… |
|---|---------|---------|
| 1 | pnpm チェック＆依存関係インストール | `npm install -g pnpm && pnpm install` |
| 2 | Cloudflare ログイン | `npx wrangler login` |
| 3 | アカウントID自動取得 | whoami → wrangler.toml 手動編集 |
| 4 | D1 データベース作成 | `npx wrangler d1 create` → ID コピペ |
| 5 | wrangler.toml 自動書き換え | account_id, database_id を手動編集 |
| 6 | スキーマ適用 + カラム追加 | schema.sql 実行 + ALTER TABLE ×11 |
| 7 | public ディレクトリ準備 | mkdir + ファイル配置 |
| 8 | LINE シークレット6個を順番に案内 | `npx wrangler secret put` ×6 回 |
| 9 | Discord Bot 設定（y/n で選択） | Bot Token・Channel ID・Public Key・App ID 設定 + スラッシュコマンド登録 |
| 10 | Worker ビルド＆デプロイ | pnpm build + wrangler deploy |
| 11 | 管理画面ビルド＆デプロイ | next build + wrangler pages deploy |
| 12 | QR コード自動生成 | ~/Desktop/QRコード/ に保存 |

### Discord Bot 連携（スクリプト内で選択可能）

セットアップ中に Discord Bot を連携するか聞かれます。連携すると以下のスラッシュコマンドが使えます:

| コマンド | 動作 |
|---|---|
| `/friends` | LINE 友だち数を表示 |
| `/broadcast message:メッセージ` | LINE 全体配信 |
| `/scenarios` | シナリオ一覧 |
| `/tags` | タグ一覧と人数 |
| `/health` | システム状態 |

Discord Bot の事前準備（[Discord Developer Portal](https://discord.com/developers/applications)）:

1. **New Application** でアプリ作成
2. **Bot** → Reset Token でトークン取得 / Message Content Intent を ON
3. **OAuth2 → URL Generator** → Scopes: `bot` / Permissions: `メッセージを送る`, `リンクを埋め込み`, `メッセージ履歴を読む`, `スラッシュコマンドを使用` → 生成 URL でサーバーに招待

### LINE Developers Console で事前に必要な準備

[LINE Developers Console](https://developers.line.biz/console/) で **2つのチャネル** を同じプロバイダー内に作成:

1. **Messaging API チャネル** — メッセージ送受信用
2. **LINE Login チャネル** — UUID 自動取得用（**必須**）
   - アプリタイプ: **ウェブアプリ** にチェック
   - LIFF アプリを作成（サイズ: Full、エンドポイント: デプロイ後の Worker URL）
   - Scope: **openid** + **profile** にチェック
   - 友だち追加オプション: **On (Aggressive)**
   - リンクされたLINE公式アカウント: Messaging API のボットを選択
   - チャネルを **「公開」** に変更

> ⚠️ LINE Login チャネルがないと `/auth/line` 経由の友だち追加で UUID が取れません。
> UUID がないとマルチアカウント統合・流入追跡が機能しません。

### スクリプト実行後の手動設定（3つ + Discord）

1. **Webhook URL** — LINE Developers Console → Messaging API → Webhook URL:
   ```
   https://your-worker.your-subdomain.workers.dev/webhook
   ```
   → **「Webhook の利用」を ON**（再送は OFF のまま）

2. **コールバック URL** — LINE Login → LINE ログイン設定:
   ```
   https://your-worker.your-subdomain.workers.dev/auth/callback
   ```

3. **LIFF エンドポイント URL** — LINE Login → LIFF → 作成したアプリ:
   ```
   https://your-worker.your-subdomain.workers.dev
   ```

4. **Discord Interactions Endpoint**（Discord Bot 連携した場合のみ）— Discord Developer Portal → General Information → Interactions Endpoint URL:
   ```
   https://your-worker.your-subdomain.workers.dev/api/discord/interactions
   ```

### 動作確認

```bash
# 友だち追加URL（これを LP や SNS に貼る）
https://your-worker.your-subdomain.workers.dev/auth/line?ref=test

# API 疎通確認
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-worker.your-subdomain.workers.dev/api/friends/count
```

---

## 主要機能

### 配信
- **ステップ配信** — `delay_minutes` で分単位制御、条件分岐、ステルス送信
- **ブロードキャスト** — 全員 / タグ / セグメント、即時 or 予約、500 人超は自動キュー化
- **リマインダー** — 指定日時からのカウントダウン配信（セミナー 3 日前 / 1 日前 / 当日）
- **テンプレート** — `{{name}}` `{{uid}}` `{{auth_url:CHANNEL_ID}}` で個別パーソナライズ
- **トラッキングリンク** — クリック計測 → 自動タグ付け → シナリオ起動

### CRM
- **友だち管理** — Webhook 自動登録、プロフィール取得、カスタムメタデータ
- **タグ** — 配信条件・シナリオトリガー
- **スコアリング** — 行動ベースのリードスコア自動計算
- **オペレーターチャット** — 管理画面から直接 1:1 返信
- **Conversation Inbox** — 未返信の会話を放置時間順で一覧（自動配信は除外判定）
- **重複検出** — `picture_url` 中間トークンで複数アカウント間の同一ユーザーを自動タグ付け

### マーケティング
- **リッチメニュー** — ユーザー別 / タグ別の自動切替
- **フォーム (LIFF)** — LINE 内完結フォーム、回答 → メタデータ自動保存
- **カレンダー予約** — Google Calendar 連携の予約システム (LIFF)
- **ライブCTA即時予約** — ウェビナーのフォーム送信後、その場で空き日時を選び、Google Meet発行・LINEリマインドまで自動化
- **スタッフ管理** — Owner / Admin / Staff の 3 ロール、API key 個別発行

### アフィリエイト計測（ASP）
- **アフィリリンク発行** — アフィリエイター自身が LIFF からワンタップで発行、短縮ドメイン対応
- **案件管理** — 案件ごとの固定額報酬を設定、複数案件を並列運用
- **時系列トラッキング** — クリック → 友だち追加 → CV を時系列で記録、last-touch 帰属で成果紐づけ
- **成果承認フロー** — 帰属 CV を承認/却下して報酬を確定、重複アカウント検知フラグで水増しを可視化
- **LINE push 通知** — 成果確定時にアフィリエイターへ自動プッシュ通知
- 詳細: [docs/wiki/27-Affiliate-ASP.md](docs/wiki/27-Affiliate-ASP.md)

### 自動化
- **IF-THEN ルール** — 7 種のトリガー × 6 種のアクション
- **自動返信** — キーワード完全一致 / 部分一致
- **Webhook IN/OUT** — Stripe / Slack 等の外部サービス連携
- **通知ルール** — 条件付きアラート配信
- **配信タイミング** — `delay_minutes` と `scheduled_at` で完全制御（v0.13.2 で時間ゲート全廃、運用側ハンドル）

### マルチアカウント
- **複数 LINE 公式アカウント** を 1 つのダッシュボードで管理
- **アカウント別シナリオ・タグ・配信** スコープ
- **BAN 検知** → 自動で次のアカウントへ友だち移行（pool 機能）
- **トラフィックプール** — 複数アカウントへ自動振り分け

### AI 統合
- **MCP Server 同梱** (`@line-harness/mcp-server`) — Claude Code から自然言語で全操作
  - `list_conversations` / `get_conversation` — 未返信会話の AI 監視
  - `create_scenario` / `update_step` — シナリオを AI に作らせる
  - `broadcast` / `send_message` — メッセージ送信（要ユーザー確認）
- **公式 SDK** (`@line-harness/sdk`) — TypeScript の型付き SDK、ESM + CJS、ゼロ依存

### iOS アプリ対応
- **`GET /api/capabilities`** — iOS 公式アプリ (the-harness-ios) との互換判定エンドポイント
- Owner / Admin / Staff いずれのロールでも利用可能

---

## アーキテクチャ

```
[ LINE Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ]
                              ⇅
                    [ Cloudflare Pages (Next.js 15) ]
                              ⇅
                    [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + LIFF + Webhook 受信、cron で配信処理
- **Web** (`apps/web`): Next.js 15 ダッシュボード（19 セクション）
- **Packages**:
  - `@line-harness/sdk` — TypeScript SDK
  - `@line-harness/mcp-server` — Claude Code 用 MCP server
  - `create-line-harness` — セットアップ CLI
  - `@line-harness/plugin-template` — プラグイン拡張用テンプレート
  - `@line-harness/db` — D1 マイグレーション + ヘルパー
  - `@line-harness/line-sdk` — LINE API 薄ラッパー
  - `@line-harness/shared` — 型定義共有

---

## ドキュメント

- [セットアップガイド (動画)](https://youtu.be/DiRuGaeq1sM)
- [LINE で無料体験する](https://shudesu.github.io/line-harness-oss/)
- [Googleカレンダー連携とライブCTA即時予約](docs/wiki/28-Google-Calendar-and-Webinar-Booking.md)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## ライセンス

MIT License. 商用利用・改変・再配布自由。

---

## コントリビュート

Issue / PR 歓迎。OSS リポへの PR は `Shudesu/line-harness-oss` (このリポ) に投げてください。

---

## 開発者 / Author

**野田修一（Shudesu）** — Harness シリーズ（L Harness / IG Harness / X Harness）開発者、AIエージェント株式会社 代表

- GitHub: [@Shudesu](https://github.com/Shudesu)
- X: [@ai_shunoda](https://x.com/ai_shunoda)
- YouTube: [野田 修一 | The Harnessで0円](https://www.youtube.com/@ai_nodashuichi)
- 公式ドキュメント: [Harness Wiki](https://harness-wiki.pages.dev)
- 商用ツールとの比較・料金データ: [The Harness Lab](https://the-harness.com)

---

> **L Harness** by [@Shudesu](https://github.com/Shudesu) — AI ネイティブ時代の OSS LINE CRM
