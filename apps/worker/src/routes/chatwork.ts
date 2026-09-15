// Chatwork → LINE 返信リレー（池田独自・上流に無い。upstream merge で必ず残す）
//
// Chatwork の専用ルームで、届いた通知に「返信」ボタンで書いた本文を、
// その通知の元になった LINE 友だちに push する。
//
// 安全則:
//   - 署名検証 (X-ChatWorkWebhookSignature) を通らない要求は 401
//   - 発言者が CHATWORK_OWNER_ACCOUNT_ID でなければ何もしない (fail-closed)
//   - [info] で始まる投稿（ハーネス自身の通知・確認）はエコーとして捨てる
//   - 返信タグ [rp … to=ROOM-MSGID] が無い発言は LINE に送らず、使い方のヒントだけ返す
//   - MSGID が chatwork_relay_messages に無ければ送らない（推測で相手を選ばない）
//
// 認証: /api/ で始まらないパスなので authMiddleware は素通し（/webhook と同じ扱い）。
// このルートは署名検証だけで守る。

import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { getFriendById, jstNow, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  chatworkSenderId,
  formatReplyHint,
  formatSentConfirmation,
  isHarnessChatworkPost,
  parseChatworkReplyTarget,
  sendChatworkMessage,
  stripChatworkReplyMarkup,
  verifyChatworkSignature,
  type ChatworkWebhookPayload,
} from '../services/chatwork.js';

const chatworkRoutes = new Hono<Env>();

const MAX_BODY = 256 * 1024; // Chatwork の本文上限は約65,000字。余裕を見て 256KiB

chatworkRoutes.post('/chatwork-webhook', async (c) => {
  const env = c.env;
  if (!env.CHATWORK_WEBHOOK_TOKEN || !env.CHATWORK_API_TOKEN) {
    return c.text('disabled', 401);
  }

  const lengthHeader = Number(c.req.header('content-length') ?? '0');
  if (lengthHeader > MAX_BODY) return c.text('payload too large', 413);

  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return c.text('payload too large', 413);

  const signature = c.req.header('X-ChatWorkWebhookSignature') ?? c.req.header('x-chatworkwebhooksignature');
  if (!(await verifyChatworkSignature(raw, signature, env.CHATWORK_WEBHOOK_TOKEN))) {
    console.error('[chatwork] invalid webhook signature');
    return c.text('invalid signature', 401);
  }

  let payload: ChatworkWebhookPayload;
  try {
    payload = JSON.parse(raw) as ChatworkWebhookPayload;
  } catch {
    return c.json({ ok: true, ignored: 'bad-json' });
  }

  if (payload.webhook_event_type !== 'message_created') {
    return c.json({ ok: true, ignored: 'event-type' });
  }

  const ev = payload.webhook_event ?? {};
  const body = String(ev.body ?? '');
  const roomId = ev.room_id === undefined || ev.room_id === null ? '' : String(ev.room_id);
  if (!body || !roomId) return c.json({ ok: true, ignored: 'empty' });

  // ハーネス自身の投稿（通知・確認・ヒント）は必ず [info] で始まる。エコーを捨てる
  if (isHarnessChatworkPost(body)) return c.json({ ok: true, ignored: 'echo' });

  // 本人限定。owner 未設定なら誰の発言も通さない
  const owner = String(env.CHATWORK_OWNER_ACCOUNT_ID ?? '').trim();
  if (!owner || chatworkSenderId(ev) !== owner) {
    return c.json({ ok: true, ignored: 'sender' });
  }

  // このルームが紐づく LINE アカウント。紐づいていないルームの発言は無視する
  const account = await env.DB
    .prepare(`SELECT id, name, channel_access_token FROM line_accounts WHERE chatwork_room_id = ? AND is_active = 1 LIMIT 1`)
    .bind(roomId)
    .first<{ id: string; name: string; channel_access_token: string }>();
  if (!account) return c.json({ ok: true, ignored: 'room-not-linked' });

  const apiToken = env.CHATWORK_API_TOKEN;
  const post = async (text: string) => {
    try {
      await sendChatworkMessage(apiToken, roomId, text);
    } catch (err) {
      console.error('[chatwork] post error:', err);
    }
  };

  // 送り先の決め方（スマホ運用が前提。返信ボタンは必須にしない）
  //   - 「返信」タグがあれば、その受信メッセージの相手
  //   - 無ければ、このルームで直近にLINEをくれた（または友だち追加した）相手
  type RelayRow = { friend_id: string; line_account_id: string | null };
  const target = parseChatworkReplyTarget(body);
  let relay: RelayRow | null;
  if (target) {
    relay = await env.DB
      .prepare(`SELECT friend_id, line_account_id FROM chatwork_relay_messages WHERE cw_message_id = ? LIMIT 1`)
      .bind(target.messageId)
      .first<RelayRow>();
    if (!relay) {
      await post(formatReplyHint('unknown-target'));
      return c.json({ ok: true, ignored: 'unknown-target' });
    }
  } else {
    relay = await env.DB
      .prepare(`SELECT friend_id, line_account_id FROM chatwork_relay_messages WHERE cw_room_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(roomId)
      .first<RelayRow>();
    if (!relay) {
      await post(formatReplyHint('no-conversation'));
      return c.json({ ok: true, ignored: 'no-conversation' });
    }
  }

  const text = stripChatworkReplyMarkup(body);
  if (!text) return c.json({ ok: true, ignored: 'empty-after-strip' });

  const friend = await getFriendById(env.DB, relay.friend_id);
  if (!friend) {
    await post(formatReplyHint('friend-missing'));
    return c.json({ ok: true, ignored: 'friend-missing' });
  }

  // 送信に使うトークンは友だちが属するアカウントを優先し、無ければルームのアカウント
  let accessToken = account.channel_access_token;
  let lineAccountId: string | null = account.id;
  if (friend.line_account_id && friend.line_account_id !== account.id) {
    const owning = await env.DB
      .prepare(`SELECT id, channel_access_token FROM line_accounts WHERE id = ? LIMIT 1`)
      .bind(friend.line_account_id)
      .first<{ id: string; channel_access_token: string }>();
    if (owning) {
      accessToken = owning.channel_access_token;
      lineAccountId = owning.id;
    }
  }

  try {
    const lineClient = new LineClient(accessToken);
    await lineClient.pushTextMessage(friend.line_user_id, text);
  } catch (err) {
    console.error('[chatwork] LINE push error:', err);
    await post('[info]⚠️ LINEへの送信に失敗しました。時間をおいてもう一度「返信」してください。[/info]');
    return c.json({ ok: false, error: 'line-push-failed' }, 502);
  }

  const now = jstNow();
  try {
    await env.DB
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, line_account_id, created_at)
         VALUES (?, ?, 'outgoing', 'text', ?, 'chatwork', ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, text, lineAccountId, now)
      .run();
    const chat = await env.DB
      .prepare(`SELECT id FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(friend.id)
      .first<{ id: string }>();
    if (chat) {
      await updateChat(env.DB, chat.id, { status: 'in_progress', lastMessageAt: now });
    }
  } catch (err) {
    // 送信自体は済んでいるので、記録の失敗で 5xx にはしない
    console.error('[chatwork] log/chat update error:', err);
  }

  await post(formatSentConfirmation(friend.display_name ?? friend.line_user_id));
  return c.json({ ok: true, sent: true, friendId: friend.id });
});

export { chatworkRoutes };
