import { Hono } from 'hono';
import { getFriendCount, getTags, getScenarios, createBroadcast } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { processBroadcastSend } from '../services/broadcast.js';
import { sendDiscordMessage } from '../services/discord.js';
import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Discord Interactions helpers
// ---------------------------------------------------------------------------

const DISCORD_API = 'https://discord.com/api/v10';

/** Convert a hex string to Uint8Array */
function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/**
 * Verify the Ed25519 signature Discord sends with every Interaction request.
 * Uses Web Crypto API — compatible with Cloudflare Workers.
 */
async function verifyDiscordSignature(
  request: Request,
  publicKey: string,
): Promise<boolean> {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp) return false;

  const body = await request.clone().text();
  const message = new TextEncoder().encode(timestamp + body);

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify('Ed25519', key, hexToUint8Array(signature), message);
  } catch {
    return false;
  }
}

/** Patch the original deferred interaction response with a final message. */
async function patchInteractionResponse(
  appId: string,
  token: string,
  content: string,
): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

// Discord Interaction type constants
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

// Line account used for broadcast commands from Discord
const DISCORD_LINE_ACCOUNT_ID = '749d9010-4c42-4f2d-99c4-4db843557c1b';

const discordRoutes = new Hono<Env>();

/**
 * POST /api/discord/command
 *
 * Accepts a JSON body with a "command" field and executes the corresponding
 * LINE Harness action. The result is posted back to the configured Discord
 * channel via Bot API.
 *
 * Body: { "command": "friends" }
 *       { "command": "broadcast Hello everyone!" }
 *       { "command": "scenarios" }
 *       { "command": "tags" }
 *       { "command": "health" }
 *
 * Authentication: Bearer token (API_KEY) — enforced by authMiddleware upstream.
 */
discordRoutes.post('/api/discord/command', async (c) => {
  const token = c.env.DISCORD_BOT_TOKEN;
  const channelId = c.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    return c.json(
      { success: false, error: 'DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is not configured' },
      500,
    );
  }

  let body: { command?: string };
  try {
    body = await c.req.json<{ command?: string }>();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const rawCommand = (body.command ?? '').trim();
  if (!rawCommand) {
    return c.json({ success: false, error: 'command field is required' }, 400);
  }

  // Split into verb + optional args
  const spaceIdx = rawCommand.indexOf(' ');
  const verb = spaceIdx === -1 ? rawCommand : rawCommand.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : rawCommand.slice(spaceIdx + 1).trim();

  const db = c.env.DB;

  try {
    switch (verb.toLowerCase()) {
      case 'friends': {
        const count = await getFriendCount(db);
        await sendDiscordMessage(token, channelId, `友だち数: **${count}人**`);
        return c.json({ success: true, data: { count } });
      }

      case 'broadcast': {
        if (!args) {
          await sendDiscordMessage(token, channelId, 'broadcast コマンドにはメッセージが必要です。例: `broadcast こんにちは！`');
          return c.json({ success: false, error: 'broadcast message is required' }, 400);
        }

        // Create a broadcast record then send immediately
        const broadcast = await createBroadcast(db, {
          title: `Discord配信 ${new Date().toISOString()}`,
          messageType: 'text',
          messageContent: args,
          targetType: 'all',
          targetTagId: null,
          scheduledAt: null,
        });

        // Associate with the configured LINE account
        await db
          .prepare('UPDATE broadcasts SET line_account_id = ? WHERE id = ?')
          .bind(DISCORD_LINE_ACCOUNT_ID, broadcast.id)
          .run();

        // Resolve channel access token for this account
        const accountRow = await db
          .prepare('SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1')
          .bind(DISCORD_LINE_ACCOUNT_ID)
          .first<{ channel_access_token: string }>();

        const lineToken = accountRow?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
        const lineClient = new LineClient(lineToken);
        await processBroadcastSend(db, lineClient, broadcast.id, c.env.WORKER_URL);

        const successMsg = `配信しました: ${args}`;
        await sendDiscordMessage(token, channelId, successMsg);
        return c.json({ success: true, data: { broadcastId: broadcast.id, message: args } });
      }

      case 'scenarios': {
        const items = await getScenarios(db);
        if (items.length === 0) {
          await sendDiscordMessage(token, channelId, 'シナリオは登録されていません。');
        } else {
          const lines = items.map(
            (s, i) =>
              `${i + 1}. **${s.name}** — トリガー: ${s.trigger_type} / ${s.is_active ? '有効' : '無効'}`,
          );
          await sendDiscordMessage(token, channelId, `シナリオ一覧:\n${lines.join('\n')}`);
        }
        return c.json({ success: true, data: { count: items.length } });
      }

      case 'tags': {
        const items = await getTags(db);
        if (items.length === 0) {
          await sendDiscordMessage(token, channelId, 'タグは登録されていません。');
        } else {
          // Fetch friend counts per tag
          const lines = await Promise.all(
            items.map(async (tag) => {
              const row = await db
                .prepare(
                  'SELECT COUNT(*) as cnt FROM friend_tags WHERE tag_id = ?',
                )
                .bind(tag.id)
                .first<{ cnt: number }>();
              return `• **${tag.name}** — ${row?.cnt ?? 0}人`;
            }),
          );
          await sendDiscordMessage(token, channelId, `タグ一覧:\n${lines.join('\n')}`);
        }
        return c.json({ success: true, data: { count: items.length } });
      }

      case 'health': {
        const friendCount = await getFriendCount(db);
        const scenarioCount = (await getScenarios(db)).length;
        const tagCount = (await getTags(db)).length;

        const msg = [
          'LINE Harness システム状態',
          `友だち数: ${friendCount}人`,
          `シナリオ数: ${scenarioCount}件`,
          `タグ数: ${tagCount}件`,
          `Worker URL: ${c.env.WORKER_URL || '未設定'}`,
        ].join('\n');

        await sendDiscordMessage(token, channelId, msg);
        return c.json({ success: true, data: { friendCount, scenarioCount, tagCount } });
      }

      default: {
        const helpText = [
          '使用可能なコマンド:',
          '• `friends` — 友だち数を表示',
          '• `broadcast <メッセージ>` — 全体配信',
          '• `scenarios` — シナリオ一覧',
          '• `tags` — タグ一覧と人数',
          '• `health` — システム状態',
        ].join('\n');
        await sendDiscordMessage(token, channelId, helpText);
        return c.json({ success: false, error: `Unknown command: ${verb}` }, 400);
      }
    }
  } catch (err) {
    console.error('Discord command error:', err);
    await sendDiscordMessage(token, channelId, `エラーが発生しました: ${String(err)}`);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/discord/interactions
//
// Discord Slash Command Interactions endpoint.
// Discord POSTs here whenever a user runs a slash command registered against
// this application. The request MUST be signature-verified before processing.
//
// Auth middleware is intentionally bypassed for this path — verification is
// done via Ed25519 signature (DISCORD_PUBLIC_KEY env var).
// ---------------------------------------------------------------------------
discordRoutes.post('/api/discord/interactions', async (c) => {
  const publicKey = c.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return c.json({ error: 'DISCORD_PUBLIC_KEY is not configured' }, 500);
  }

  // Verify Ed25519 signature
  const isValid = await verifyDiscordSignature(c.req.raw, publicKey);
  if (!isValid) {
    return c.json({ error: 'Invalid request signature' }, 401);
  }

  let interaction: {
    type: number;
    id: string;
    token: string;
    data?: {
      name: string;
      options?: Array<{ name: string; value: string }>;
    };
  };

  try {
    interaction = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // PING — Discord connectivity check
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  // APPLICATION_COMMAND — slash command
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name ?? '';
    const db = c.env.DB;

    // ------------------------------------------------------------------
    // /friends
    // ------------------------------------------------------------------
    if (commandName === 'friends') {
      const count = await getFriendCount(db);
      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `友だち数: **${count}人**` },
      });
    }

    // ------------------------------------------------------------------
    // /scenarios
    // ------------------------------------------------------------------
    if (commandName === 'scenarios') {
      const items = await getScenarios(db);
      const content =
        items.length === 0
          ? 'シナリオは登録されていません。'
          : `シナリオ一覧:\n${items
              .map(
                (s, i) =>
                  `${i + 1}. **${s.name}** — トリガー: ${s.trigger_type} / ${s.is_active ? '有効' : '無効'}`,
              )
              .join('\n')}`;
      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content },
      });
    }

    // ------------------------------------------------------------------
    // /tags
    // ------------------------------------------------------------------
    if (commandName === 'tags') {
      const items = await getTags(db);
      if (items.length === 0) {
        return c.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'タグは登録されていません。' },
        });
      }
      const lines = await Promise.all(
        items.map(async (tag) => {
          const row = await db
            .prepare('SELECT COUNT(*) as cnt FROM friend_tags WHERE tag_id = ?')
            .bind(tag.id)
            .first<{ cnt: number }>();
          return `• **${tag.name}** — ${row?.cnt ?? 0}人`;
        }),
      );
      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: `タグ一覧:\n${lines.join('\n')}` },
      });
    }

    // ------------------------------------------------------------------
    // /health
    // ------------------------------------------------------------------
    if (commandName === 'health') {
      const [friendCount, scenarios, tags] = await Promise.all([
        getFriendCount(db),
        getScenarios(db),
        getTags(db),
      ]);
      const content = [
        'LINE Harness システム状態',
        `友だち数: ${friendCount}人`,
        `シナリオ数: ${scenarios.length}件`,
        `タグ数: ${tags.length}件`,
        `Worker URL: ${c.env.WORKER_URL || '未設定'}`,
      ].join('\n');
      return c.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content },
      });
    }

    // ------------------------------------------------------------------
    // /broadcast message:<text>
    // Deferred response: return type=5 immediately, then process in
    // waitUntil and patch the original message when done.
    // ------------------------------------------------------------------
    if (commandName === 'broadcast') {
      const message = interaction.data?.options?.find((o) => o.name === 'message')?.value ?? '';
      if (!message) {
        return c.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'メッセージを入力してください。例: `/broadcast こんにちは！`' },
        });
      }

      const appId = c.env.DISCORD_APP_ID;
      const interactionToken = interaction.token;

      // Immediately acknowledge with deferred response (type=5)
      // Discord requires a response within 3 seconds.
      const deferredResponse = c.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });

      // Process broadcast asynchronously
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const broadcast = await createBroadcast(db, {
              title: `Discord配信 ${new Date().toISOString()}`,
              messageType: 'text',
              messageContent: message,
              targetType: 'all',
              targetTagId: null,
              scheduledAt: null,
            });

            await db
              .prepare('UPDATE broadcasts SET line_account_id = ? WHERE id = ?')
              .bind(DISCORD_LINE_ACCOUNT_ID, broadcast.id)
              .run();

            const accountRow = await db
              .prepare(
                'SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1',
              )
              .bind(DISCORD_LINE_ACCOUNT_ID)
              .first<{ channel_access_token: string }>();

            const lineToken =
              accountRow?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
            const lineClient = new LineClient(lineToken);
            await processBroadcastSend(db, lineClient, broadcast.id, c.env.WORKER_URL);

            if (appId) {
              await patchInteractionResponse(
                appId,
                interactionToken,
                `配信しました: ${message}`,
              );
            }
          } catch (err) {
            console.error('Discord slash broadcast error:', err);
            if (appId) {
              await patchInteractionResponse(
                appId,
                interactionToken,
                `エラーが発生しました: ${String(err)}`,
              );
            }
          }
        })(),
      );

      return deferredResponse;
    }

    // Unknown command
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '不明なコマンドです。' },
    });
  }

  return c.json({ error: 'Unsupported interaction type' }, 400);
});

export { discordRoutes };
