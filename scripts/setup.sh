#!/bin/bash
set -e

# ============================================================
# LINE Harness ワンクリックセットアップスクリプト
#
# 使い方:
#   git clone https://github.com/ikedachiin-maker/line-harness-oss.git
#   cd line-harness-oss
#   bash scripts/setup.sh
#
# 前提条件:
#   - Node.js 20+, pnpm 9+
#   - Cloudflareアカウント
#   - LINE Developersアカウント（Messaging API + LINE Loginチャネル作成済み）
#   - Discord Botアプリ作成済み（任意）
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    LINE Harness ワンクリックセットアップ         ║${NC}"
echo -e "${GREEN}║    インフラ + LINE + Discord を一括構築        ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# --- 1. pnpm チェック＆インストール ---
echo -e "${CYAN}[1/12] 依存関係インストール...${NC}"
if ! command -v pnpm &>/dev/null; then
  echo -e "${YELLOW}pnpm が見つかりません。インストールします...${NC}"
  npm install -g pnpm
fi
pnpm install --silent 2>/dev/null || pnpm install

# --- 2. Cloudflare ログイン ---
echo ""
echo -e "${CYAN}[2/12] Cloudflare ログイン${NC}"
if npx wrangler whoami 2>/dev/null | grep -q "Account ID"; then
  echo -e "${GREEN}✓ 既にログイン済み${NC}"
else
  npx wrangler login
fi

# --- 3. アカウントID取得 ---
echo ""
echo -e "${CYAN}[3/12] Cloudflare アカウント情報取得...${NC}"
ACCOUNT_ID=$(npx wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1)
if [ -z "$ACCOUNT_ID" ]; then
  echo -e "${RED}✗ アカウントIDが取得できません。npx wrangler login を実行してください。${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Account ID: ${ACCOUNT_ID}${NC}"

# --- 4. D1データベース作成 ---
echo ""
echo -e "${CYAN}[4/12] D1データベース作成...${NC}"
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
echo -e "${CYAN}[5/12] wrangler.toml 設定...${NC}"
TOML="apps/worker/wrangler.toml"

# sed -i の互換性（macOS vs Linux）
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_INPLACE="sed -i ''"
else
  SED_INPLACE="sed -i"
fi

$SED_INPLACE "s|account_id = \".*\"|account_id = \"${ACCOUNT_ID}\"|" "$TOML"
$SED_INPLACE "s|database_id = \".*\"|database_id = \"${DB_ID}\"|" "$TOML"
$SED_INPLACE "s|database_name = \".*\"|database_name = \"line-crm\"|" "$TOML"

# assets directory 追加（なければ）
if ! grep -q 'directory = ' "$TOML"; then
  $SED_INPLACE 's|\[assets\]|[assets]\ndirectory = "./public"|' "$TOML"
fi

# R2 セクション削除（あれば）
if grep -q 'r2_buckets' "$TOML"; then
  $SED_INPLACE '/\[\[r2_buckets\]\]/,/bucket_name/d' "$TOML"
fi

echo -e "${GREEN}✓ wrangler.toml 更新完了${NC}"

# --- 6. スキーマ適用 ---
echo ""
echo -e "${CYAN}[6/12] D1スキーマ適用...${NC}"
npx wrangler d1 execute line-crm --remote --file=packages/db/schema.sql 2>/dev/null || true

# 追加カラム（既存の場合はエラーを無視）
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

# --- 7. public ディレクトリ準備 ---
echo ""
echo -e "${CYAN}[7/12] publicディレクトリ準備...${NC}"
mkdir -p apps/worker/public
echo -e "${GREEN}✓ 完了${NC}"

# --- 8. LINE シークレット設定 ---
echo ""
echo -e "${CYAN}[8/12] LINE シークレット設定${NC}"
echo -e "${YELLOW}LINE Developers Console の値を入力してください。${NC}"
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

# --- 9. Discord Bot 設定（任意） ---
echo ""
echo -e "${CYAN}[9/12] Discord Bot 設定${NC}"
echo -e "${YELLOW}Discord Bot を連携しますか？ (y/n)${NC}"
read -p "> " SETUP_DISCORD

if [[ "$SETUP_DISCORD" =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${YELLOW}Discord Developer Portal の値を入力してください。${NC}"
  echo ""

  cd apps/worker

  for SECRET_NAME in DISCORD_BOT_TOKEN DISCORD_CHANNEL_ID DISCORD_PUBLIC_KEY DISCORD_APP_ID; do
    case $SECRET_NAME in
      DISCORD_BOT_TOKEN) DESC="Bot → Token" ;;
      DISCORD_CHANNEL_ID) DESC="通知先チャンネルID（右クリック→IDをコピー）" ;;
      DISCORD_PUBLIC_KEY) DESC="General Information → Public Key" ;;
      DISCORD_APP_ID) DESC="General Information → Application ID" ;;
    esac
    echo -e "${CYAN}${SECRET_NAME}${NC}: ${DESC}"
    npx wrangler secret put "$SECRET_NAME"
    echo ""
  done

  cd ../..

  # スラッシュコマンド登録
  echo -e "${YELLOW}スラッシュコマンドを登録します。${NC}"
  echo -e "${YELLOW}Bot Token を入力してください:${NC}"
  read -p "> " DISCORD_BOT_TOKEN_INPUT
  echo -e "${YELLOW}Application ID を入力してください:${NC}"
  read -p "> " DISCORD_APP_ID_INPUT

  export DISCORD_BOT_TOKEN="$DISCORD_BOT_TOKEN_INPUT"
  export DISCORD_APP_ID="$DISCORD_APP_ID_INPUT"
  bash scripts/register-discord-commands.sh

  echo -e "${GREEN}✓ Discord Bot 設定完了${NC}"
else
  echo -e "${GREEN}✓ Discord Bot はスキップしました（後から設定可能）${NC}"
fi

# --- 10. ビルド＆デプロイ ---
echo ""
echo -e "${CYAN}[10/12] ビルド＆デプロイ...${NC}"

# パッケージビルド
pnpm -r build 2>/dev/null || true

# Worker デプロイ
cd apps/worker
npx wrangler deploy
cd ../..

# --- 11. 管理画面デプロイ ---
echo ""
echo -e "${CYAN}[11/12] 管理画面デプロイ...${NC}"
echo -e "${YELLOW}Worker URL を入力してください${NC}"
echo -e "${YELLOW}(デプロイ後に表示された https://line-harness.xxxxx.workers.dev)${NC}"
read -p "> " WORKER_URL

echo "NEXT_PUBLIC_API_URL=${WORKER_URL}" > apps/web/.env.production
pnpm --filter web build
npx wrangler pages deploy apps/web/out --project-name=line-harness-web

# --- 12. QRコード生成 ---
echo ""
echo -e "${CYAN}[12/12] QRコード生成...${NC}"
if python3 -c "import qrcode" 2>/dev/null; then
  QR_READY=true
else
  echo -e "${YELLOW}qrcode ライブラリをインストールします...${NC}"
  pip3 install --break-system-packages qrcode pillow 2>/dev/null && QR_READY=true || QR_READY=false
fi

if [ "$QR_READY" = true ]; then
  python3 << PYEOF
import qrcode, os

url = "${WORKER_URL}/auth/line?ref=default"
qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
qr.add_data(url)
qr.make(fit=True)
img = qr.make_image(fill_color="#06C755", back_color="white")

output_dir = os.path.expanduser("~/Desktop/QRコード")
os.makedirs(output_dir, exist_ok=True)
path = os.path.join(output_dir, "QR_default.png")
img.save(path)
print(f"QRコード生成: {path}")
PYEOF
  echo -e "${GREEN}✓ QRコード生成完了（~/Desktop/QRコード/）${NC}"
else
  echo -e "${YELLOW}✗ QRコードの生成をスキップしました（qrcodeライブラリ未インストール）${NC}"
fi

# --- 完了 ---
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            セットアップ完了！                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}LINE Developers Console で以下を設定してください:${NC}"
echo ""
echo "1. Messaging API → Webhook URL:"
echo -e "   ${GREEN}${WORKER_URL}/webhook${NC}"
echo "   → 「Webhookの利用」を ON（再送は OFF）"
echo ""
echo "2. LINE Login → LINEログイン設定 → コールバックURL:"
echo -e "   ${GREEN}${WORKER_URL}/auth/callback${NC}"
echo ""
echo "3. LINE Login → LIFF → エンドポイントURL:"
echo -e "   ${GREEN}${WORKER_URL}${NC}"
echo ""
echo "4. LINE Login チャネルを「公開」に変更"
echo ""
if [[ "$SETUP_DISCORD" =~ ^[Yy]$ ]]; then
  echo "5. Discord Developer Portal → General Information → Interactions Endpoint URL:"
  echo -e "   ${GREEN}${WORKER_URL}/api/discord/interactions${NC}"
  echo ""
fi
echo -e "${CYAN}動作確認:${NC}"
echo "  友だち追加URL: ${WORKER_URL}/auth/line?ref=test"
echo "  API確認: curl -H 'Authorization: Bearer YOUR_API_KEY' ${WORKER_URL}/api/friends/count"
echo ""
echo -e "${GREEN}管理画面にAPIキーでログインしてアカウントを登録してください。${NC}"
