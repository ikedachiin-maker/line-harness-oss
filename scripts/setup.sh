#!/bin/bash
set -e

# ============================================================
# LINE Harness ワンクリックセットアップスクリプト
#
# 使い方:
#   bash scripts/setup.sh
#
# 前提条件:
#   - Node.js 20+, pnpm 9+
#   - Cloudflareアカウント
#   - LINE Developersアカウント（Messaging API + LINE Loginチャネル作成済み）
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    LINE Harness ワンクリックセットアップ    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# --- 1. pnpm install ---
echo -e "${CYAN}[1/10] 依存関係インストール...${NC}"
pnpm install --silent 2>/dev/null || pnpm install

# --- 2. Cloudflare ログイン ---
echo ""
echo -e "${CYAN}[2/10] Cloudflare ログイン${NC}"
if npx wrangler whoami 2>/dev/null | grep -q "Account ID"; then
  echo -e "${GREEN}✓ 既にログイン済み${NC}"
else
  npx wrangler login
fi

# --- 3. アカウントID取得 ---
echo ""
echo -e "${CYAN}[3/10] Cloudflare アカウント情報取得...${NC}"
ACCOUNT_ID=$(npx wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1)
if [ -z "$ACCOUNT_ID" ]; then
  echo -e "${RED}✗ アカウントIDが取得できません。npx wrangler login を実行してください。${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Account ID: ${ACCOUNT_ID}${NC}"

# --- 4. D1データベース作成 ---
echo ""
echo -e "${CYAN}[4/10] D1データベース作成...${NC}"
DB_EXISTS=$(npx wrangler d1 list 2>/dev/null | grep "line-crm" || true)
if [ -n "$DB_EXISTS" ]; then
  echo -e "${GREEN}✓ line-crm は既に存在します${NC}"
  DB_ID=$(npx wrangler d1 list 2>/dev/null | grep "line-crm" | grep -oE '[a-f0-9-]{36}' | head -1)
else
  DB_OUTPUT=$(npx wrangler d1 create line-crm 2>&1)
  DB_ID=$(echo "$DB_OUTPUT" | grep -oE '"database_id": "[a-f0-9-]+"' | grep -oE '[a-f0-9-]{36}')
  echo -e "${GREEN}✓ D1 作成完了${NC}"
fi
echo -e "${GREEN}  Database ID: ${DB_ID}${NC}"

# --- 5. wrangler.toml 更新 ---
echo ""
echo -e "${CYAN}[5/10] wrangler.toml 設定...${NC}"
TOML="apps/worker/wrangler.toml"
sed -i '' "s|account_id = \".*\"|account_id = \"${ACCOUNT_ID}\"|" "$TOML"
sed -i '' "s|database_id = \".*\"|database_id = \"${DB_ID}\"|" "$TOML"
sed -i '' "s|database_name = \".*\"|database_name = \"line-crm\"|" "$TOML"

# assets directory 追加（なければ）
if ! grep -q 'directory = ' "$TOML"; then
  sed -i '' 's|\[assets\]|[assets]\ndirectory = "./public"|' "$TOML"
fi

# R2 セクション削除（なければスキップ）
if grep -q 'r2_buckets' "$TOML"; then
  sed -i '' '/\[\[r2_buckets\]\]/,/bucket_name/d' "$TOML"
fi

echo -e "${GREEN}✓ wrangler.toml 更新完了${NC}"

# --- 6. スキーマ適用 ---
echo ""
echo -e "${CYAN}[6/10] D1スキーマ適用...${NC}"
npx wrangler d1 execute line-crm --remote --file=packages/db/schema.sql 2>/dev/null || true

# line_account_id カラム追加（既存の場合はエラーを無視）
npx wrangler d1 execute line-crm --remote --command="
ALTER TABLE friends ADD COLUMN line_account_id TEXT;
ALTER TABLE auto_replies ADD COLUMN line_account_id TEXT;
ALTER TABLE automations ADD COLUMN line_account_id TEXT;
ALTER TABLE broadcasts ADD COLUMN line_account_id TEXT;
ALTER TABLE notification_rules ADD COLUMN line_account_id TEXT;
ALTER TABLE reminders ADD COLUMN line_account_id TEXT;
ALTER TABLE scenarios ADD COLUMN line_account_id TEXT;
ALTER TABLE chats ADD COLUMN line_account_id TEXT;
ALTER TABLE scenario_steps ADD COLUMN condition_type TEXT;
ALTER TABLE scenario_steps ADD COLUMN condition_value TEXT;
ALTER TABLE scenario_steps ADD COLUMN next_step_on_false INTEGER;
" 2>/dev/null || true
echo -e "${GREEN}✓ スキーマ適用完了${NC}"

# --- 7. public ディレクトリ作成 ---
echo ""
echo -e "${CYAN}[7/10] publicディレクトリ準備...${NC}"
mkdir -p apps/worker/public
echo -e "${GREEN}✓ 完了${NC}"

# --- 8. シークレット設定 ---
echo ""
echo -e "${CYAN}[8/10] シークレット設定${NC}"
echo -e "${YELLOW}以下のシークレットを設定します。${NC}"
echo -e "${YELLOW}各値を入力してEnterを押してください。${NC}"
echo ""

cd apps/worker

for SECRET_NAME in LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN LINE_LOGIN_CHANNEL_ID LINE_LOGIN_CHANNEL_SECRET LIFF_URL API_KEY; do
  case $SECRET_NAME in
    LINE_CHANNEL_SECRET) DESC="Messaging API → 基本設定 → チャネルシークレット" ;;
    LINE_CHANNEL_ACCESS_TOKEN) DESC="Messaging API → Messaging API設定 → チャネルアクセストークン" ;;
    LINE_LOGIN_CHANNEL_ID) DESC="LINE Login → 基本設定 → チャネルID" ;;
    LINE_LOGIN_CHANNEL_SECRET) DESC="LINE Login → 基本設定 → チャネルシークレット" ;;
    LIFF_URL) DESC="LINE Login → LIFF → LIFF URL (例: https://liff.line.me/xxxxx-xxxxx)" ;;
    API_KEY) DESC="管理画面ログイン用（自分で決める文字列）" ;;
  esac
  echo -e "${CYAN}${SECRET_NAME}${NC}: ${DESC}"
  npx wrangler secret put "$SECRET_NAME"
  echo ""
done

cd ../..

# --- 9. ビルド＆デプロイ ---
echo ""
echo -e "${CYAN}[9/10] ビルド＆デプロイ...${NC}"

# パッケージビルド
pnpm -r build 2>/dev/null || true

# Worker デプロイ
cd apps/worker
npx wrangler deploy
cd ../..

# 管理画面ビルド＆デプロイ
echo ""
echo -e "${YELLOW}管理画面のAPI URLを入力してください${NC}"
echo -e "${YELLOW}(例: https://line-harness.xxxxx.workers.dev)${NC}"
read -p "> " WORKER_URL

echo "NEXT_PUBLIC_API_URL=${WORKER_URL}" > apps/web/.env.production
pnpm --filter web build
npx wrangler pages deploy apps/web/out --project-name=line-harness-web

# --- 10. 完了 ---
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         セットアップ完了！                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}次のステップ:${NC}"
echo ""
echo "1. LINE Developers Console → Messaging API → Webhook URL に以下を設定:"
echo -e "   ${WORKER_URL}/webhook"
echo ""
echo "2. LINE Developers Console → Webhook の利用を ON"
echo ""
echo "3. LINE Login チャネル → LINEログイン設定 → コールバックURL:"
echo -e "   ${WORKER_URL}/auth/callback"
echo ""
echo "4. LINE Login チャネルを「公開」に変更"
echo ""
echo "5. 友だち追加URL:"
echo -e "   ${WORKER_URL}/auth/line?ref=test"
echo ""
echo -e "${GREEN}管理画面にAPIキーでログインしてアカウントを登録してください。${NC}"
