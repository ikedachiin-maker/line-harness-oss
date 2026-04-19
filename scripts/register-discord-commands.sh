#!/usr/bin/env bash
# register-discord-commands.sh
#
# Discord Slash Commands (Global Application Commands) の登録スクリプト。
# Discord Developer Portal でアプリケーションを作成した後、このスクリプトを
# 一度実行するだけでスラッシュコマンドが有効になります。
#
# 必須環境変数:
#   DISCORD_BOT_TOKEN — Bot のトークン（Discord Developer Portal > Bot > Token）
#   DISCORD_APP_ID    — アプリケーション ID（Discord Developer Portal > General Information > Application ID）
#
# 使い方:
#   export DISCORD_BOT_TOKEN="your-bot-token"
#   export DISCORD_APP_ID="your-application-id"
#   chmod +x scripts/register-discord-commands.sh
#   ./scripts/register-discord-commands.sh
#
# グローバルコマンドの反映には最大 1 時間かかる場合があります。
# 開発中はギルド（サーバー）コマンドを使うと即時反映されます。
# ギルドコマンドにする場合は URL を以下に変更してください:
#   https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/{GUILD_ID}/commands

set -euo pipefail

# ---------------------------------------------------------------------------
# 環境変数チェック
# ---------------------------------------------------------------------------
if [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then
  echo "ERROR: DISCORD_BOT_TOKEN が設定されていません。" >&2
  exit 1
fi

if [[ -z "${DISCORD_APP_ID:-}" ]]; then
  echo "ERROR: DISCORD_APP_ID が設定されていません。" >&2
  exit 1
fi

API_BASE="https://discord.com/api/v10"
COMMANDS_URL="${API_BASE}/applications/${DISCORD_APP_ID}/commands"

echo "Discord Slash Commands を登録します..."
echo "Application ID: ${DISCORD_APP_ID}"
echo "Endpoint: ${COMMANDS_URL}"
echo ""

# ---------------------------------------------------------------------------
# コマンド定義 (JSON)
# ---------------------------------------------------------------------------
COMMANDS_JSON=$(cat <<'EOF'
[
  {
    "name": "friends",
    "description": "LINEの友だち数を表示します"
  },
  {
    "name": "broadcast",
    "description": "LINE全体配信を送信します",
    "options": [
      {
        "type": 3,
        "name": "message",
        "description": "配信するメッセージ",
        "required": true
      }
    ]
  },
  {
    "name": "scenarios",
    "description": "登録済みシナリオの一覧を表示します"
  },
  {
    "name": "tags",
    "description": "登録済みタグと友だち数の一覧を表示します"
  },
  {
    "name": "health",
    "description": "LINE Harnessシステムの状態を表示します"
  }
]
EOF
)

# ---------------------------------------------------------------------------
# PUT /applications/{app_id}/commands でコマンドを一括登録（上書き）
# PUT を使うと既存コマンドが自動的に同期されます
# ---------------------------------------------------------------------------
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X PUT \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${COMMANDS_JSON}" \
  "${COMMANDS_URL}")

HTTP_BODY=$(echo "${RESPONSE}" | head -n -1)
HTTP_CODE=$(echo "${RESPONSE}" | tail -n 1)

echo "HTTP Status: ${HTTP_CODE}"
echo "Response:"
echo "${HTTP_BODY}" | python3 -m json.tool 2>/dev/null || echo "${HTTP_BODY}"

if [[ "${HTTP_CODE}" == "200" ]]; then
  echo ""
  echo "スラッシュコマンドの登録が完了しました。"
  echo "グローバルコマンドは反映まで最大 1 時間かかる場合があります。"
else
  echo ""
  echo "ERROR: コマンドの登録に失敗しました (HTTP ${HTTP_CODE})。" >&2
  exit 1
fi
