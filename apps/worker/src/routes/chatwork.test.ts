import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getFriendById: vi.fn(),
  updateChat: vi.fn(),
  jstNow: vi.fn(() => '2026-09-15T18:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const lineClientMocks = { pushTextMessage: vi.fn() };
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => lineClientMocks),
}));

// 実際の Chatwork には投げない。投稿本文を集めて assert する
const posted: string[] = [];
vi.mock('../services/chatwork.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/chatwork.js')>();
  return {
    ...actual,
    sendChatworkMessage: vi.fn(async (_t: string, _r: string, body: string) => {
      posted.push(body);
      return '777';
    }),
  };
});

const { chatworkRoutes } = await import('./chatwork.js');

const TOKEN = btoa('webhook-secret');
const OWNER = '1390104';
const ROOM = '422111222';

async function sign(raw: string, tokenBase64 = TOKEN): Promise<string> {
  const keyBytes = Uint8Array.from(atob(tokenBase64), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

type Row = Record<string, unknown> | null;

// prepare(sql).bind(...).first()/run() を SQL の断片で振り分ける D1 スタブ
function makeDb(rows: { account?: Row; relay?: Row; owning?: Row; chat?: Row }) {
  const runs: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    runs,
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM line_accounts WHERE chatwork_room_id')) return rows.account ?? null;
          if (sql.includes('FROM chatwork_relay_messages')) return rows.relay ?? null;
          if (sql.includes('FROM line_accounts WHERE id')) return rows.owning ?? null;
          if (sql.includes('FROM chats')) return rows.chat ?? null;
          return null;
        }),
        run: vi.fn(async () => {
          runs.push({ sql, binds });
          return { success: true };
        }),
      })),
    })),
  };
  return db;
}

function app(env: Record<string, unknown>) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.env = env;
    await next();
  });
  a.route('/', chatworkRoutes);
  return a;
}

async function postEvent(
  a: Hono,
  event: Record<string, unknown>,
  opts: { token?: string; type?: string } = {},
) {
  const raw = JSON.stringify({ webhook_event_type: opts.type ?? 'message_created', webhook_event: event });
  return a.request('/chatwork-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ChatWorkWebhookSignature': await sign(raw, opts.token) },
    body: raw,
  });
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

const baseEnv = () => ({
  CHATWORK_WEBHOOK_TOKEN: TOKEN,
  CHATWORK_API_TOKEN: 'api-token',
  CHATWORK_OWNER_ACCOUNT_ID: OWNER,
});

const accountRow = { id: 'acc-2', name: 'MNP個別相談2026', channel_access_token: 'cat-2' };
const replyBody = (text: string) => `[rp aid=${OWNER} to=${ROOM}-1999][pname:${OWNER}]さん\n${text}`;

beforeEach(() => {
  posted.length = 0;
  vi.clearAllMocks();
});

describe('POST /chatwork-webhook', () => {
  test('トークン未設定なら 401 (disabled)', async () => {
    const a = app({ DB: makeDb({}) });
    const res = await a.request('/chatwork-webhook', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  test('署名が合わなければ 401', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: 'x' }, { token: btoa('other') });
    expect(res.status).toBe(401);
    expect(posted).toEqual([]);
  });

  test('[info] で始まる自分の通知はエコーとして無視', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: '[info]💬 x[/info]' });
    expect((await json(res)).ignored).toBe('echo');
    expect(posted).toEqual([]);
  });

  test('池田本人以外の発言は LINE に送らない', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow, relay: { friend_id: 'f1' } }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: '999', body: replyBody('こんにちは') });
    expect((await json(res)).ignored).toBe('sender');
    expect(lineClientMocks.pushTextMessage).not.toHaveBeenCalled();
  });

  test('owner 未設定なら誰の発言も通さない (fail-closed)', async () => {
    const a = app({ ...baseEnv(), CHATWORK_OWNER_ACCOUNT_ID: undefined, DB: makeDb({ account: accountRow }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: replyBody('x') });
    expect((await json(res)).ignored).toBe('sender');
  });

  test('紐づいていないルームの発言は無視 (ヒントも出さない)', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: null }) });
    const res = await postEvent(a, { room_id: '1', account_id: OWNER, body: 'メモ' });
    expect((await json(res)).ignored).toBe('room-not-linked');
    expect(posted).toEqual([]);
  });

  test('返信タグが無い発言は送らず、使い方のヒントを返す', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: '返信ボタンを使わず書いた' });
    expect((await json(res)).ignored).toBe('no-reply-tag');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('返信');
    expect(lineClientMocks.pushTextMessage).not.toHaveBeenCalled();
  });

  test('返信先が対応表に無ければ送らない', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow, relay: null }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: replyBody('x') });
    expect((await json(res)).ignored).toBe('unknown-target');
    expect(posted[0]).toContain('見つかりません');
  });

  test('返信タグあり + 対応表あり → LINE push + ログ + 確認投稿', async () => {
    dbMocks.getFriendById.mockResolvedValue({
      id: 'f1', line_user_id: 'Uabc', display_name: '山田太郎', line_account_id: 'acc-2',
    });
    const db = makeDb({ account: accountRow, relay: { friend_id: 'f1', line_account_id: 'acc-2' }, chat: { id: 'chat-1' } });
    const a = app({ ...baseEnv(), DB: db });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: replyBody('明日の10時でいかがでしょうか？') });
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, sent: true, friendId: 'f1' });
    expect(lineClientMocks.pushTextMessage).toHaveBeenCalledWith('Uabc', '明日の10時でいかがでしょうか？');
    const log = db.runs.find((r) => r.sql.includes('INSERT INTO messages_log'));
    expect(log?.binds).toEqual(expect.arrayContaining(['f1', '明日の10時でいかがでしょうか？', 'acc-2']));
    expect(dbMocks.updateChat).toHaveBeenCalledWith(db, 'chat-1', { status: 'in_progress', lastMessageAt: '2026-09-15T18:00:00.000+09:00' });
    expect(posted[0]).toContain('山田太郎');
    expect(posted[0]).toContain('送信しました');
  });

  test('友だちが別アカウント所属なら、そのアカウントのトークンで送る', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'f9', line_user_id: 'Uzzz', display_name: null, line_account_id: 'acc-1' });
    const db = makeDb({ account: accountRow, relay: { friend_id: 'f9' }, owning: { id: 'acc-1', channel_access_token: 'cat-1' } });
    const a = app({ ...baseEnv(), DB: db });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: replyBody('ok') });
    expect((await json(res)).sent).toBe(true);
    const { LineClient } = await import('@line-crm/line-sdk');
    expect(LineClient).toHaveBeenCalledWith('cat-1');
  });

  test('LINE push 失敗は 502 と失敗の投稿', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'f1', line_user_id: 'Uabc', display_name: 'x', line_account_id: 'acc-2' });
    lineClientMocks.pushTextMessage.mockRejectedValueOnce(new Error('boom'));
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow, relay: { friend_id: 'f1' } }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: replyBody('x') });
    expect(res.status).toBe(502);
    expect(posted[0]).toContain('失敗');
  });

  test('message_created 以外のイベントは無視', async () => {
    const a = app({ ...baseEnv(), DB: makeDb({ account: accountRow }) });
    const res = await postEvent(a, { room_id: ROOM, account_id: OWNER, body: replyBody('x') }, { type: 'mention_to_me' });
    expect((await json(res)).ignored).toBe('event-type');
  });
});
