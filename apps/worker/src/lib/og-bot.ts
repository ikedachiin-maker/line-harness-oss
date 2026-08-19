// WhatsApp は webview の実ユーザーも UA に `WhatsApp/<version>` を含むため
// 偽陽性で実クリックが OGP HTML 化（リダイレクト停止）してしまう。除外する。
const BOT_PATTERN = /(LINEdc|Twitterbot|facebookexternalhit|meta-externalagent|Discordbot|Slackbot-LinkExpanding|Slack-ImgProxy|TelegramBot|LinkedInBot|LINE-Bot)/i;

export function isLinkPreviewBot(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_PATTERN.test(ua);
}
