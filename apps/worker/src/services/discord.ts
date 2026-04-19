const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Send a plain text message to a Discord channel via Bot API.
 */
export async function sendDiscordMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Discord API ${res.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * Send an embed message to a Discord channel via Bot API.
 * embed should conform to Discord's Embed Object structure.
 * https://discord.com/developers/docs/resources/message#embed-object
 */
export async function sendDiscordEmbed(
  token: string,
  channelId: string,
  embed: object,
): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ embeds: [embed] }),
  });

  const text = await res.text();
  console.log(`Discord sendEmbed: status=${res.status} response=${text.slice(0, 200)}`);
}
