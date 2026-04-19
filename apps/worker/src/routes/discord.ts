import { Hono } from 'hono';
import { getFriendCount, getTags, getScenarios, createBroadcast } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { processBroadcastSend } from '../services/broadcast.js';
import { sendDiscordMessage } from '../services/discord.js';
import type { Env } from '../index.js';

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

export { discordRoutes };
