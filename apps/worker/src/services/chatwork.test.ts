import { describe, expect, test, vi } from 'vitest';
import {
  chatworkSenderId,
  formatIncomingNotice,
  isHarnessChatworkPost,
  parseChatworkReplyTarget,
  sendChatworkMessage,
  stripChatworkReplyMarkup,
  verifyChatworkSignature,
} from './chatwork.js';

async function signLikeChatwork(rawBody: string, tokenBase64: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(tokenBase64), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const TOKEN = btoa('secret-token-bytes');

describe('verifyChatworkSignature', () => {
  test('正しい署名は通る', async () => {
    const body = '{"webhook_event_type":"message_created"}';
    const sig = await signLikeChatwork(body, TOKEN);
    expect(await verifyChatworkSignature(body, sig, TOKEN)).toBe(true);
  });

  test('別トークンの署名は落ちる', async () => {
    const body = '{"x":1}';
    const sig = await signLikeChatwork(body, btoa('other'));
    expect(await verifyChatworkSignature(body, sig, TOKEN)).toBe(false);
  });

  test('カンマ区切りの複数トークンのどれかに一致すれば通る', async () => {
    const body = '{"x":1}';
    const sig = await signLikeChatwork(body, TOKEN);
    expect(await verifyChatworkSignature(body, sig, `${btoa('other')},${TOKEN}`)).toBe(true);
  });

  test('全角カッコや空白が混ざったトークンでも照合できる', async () => {
    const body = '{"x":1}';
    const sig = await signLikeChatwork(body, TOKEN);
    expect(await verifyChatworkSignature(body, sig, `（${TOKEN} ）`)).toBe(true);
  });

  test('署名やトークンが無ければ fail-closed', async () => {
    expect(await verifyChatworkSignature('{}', undefined, TOKEN)).toBe(false);
    expect(await verifyChatworkSignature('{}', 'abc', undefined)).toBe(false);
  });
});

describe('chatworkSenderId', () => {
  test('ルームイベント(account_id)とアカウントイベント(from_account_id)の両方を読む', () => {
    expect(chatworkSenderId({ account_id: 1390104 })).toBe('1390104');
    expect(chatworkSenderId({ from_account_id: '1390104' })).toBe('1390104');
    expect(chatworkSenderId({})).toBe('');
    expect(chatworkSenderId(undefined)).toBe('');
  });
});

describe('parseChatworkReplyTarget', () => {
  test('返信タグから room と message_id を取り出す', () => {
    const body = '[rp aid=1390104 to=422111222-1999888777666555444][pname:1390104]さん\nこんにちは';
    expect(parseChatworkReplyTarget(body)).toEqual({ roomId: '422111222', messageId: '1999888777666555444' });
  });

  test('返信タグが無ければ null', () => {
    expect(parseChatworkReplyTarget('ただのメモ')).toBeNull();
  });
});

describe('stripChatworkReplyMarkup', () => {
  test('返信タグ・pname・引用を落として本文だけ残す', () => {
    const body =
      '[rp aid=1390104 to=422111222-1999][pname:1390104]さん\n[qt][qtmeta aid=1 time=1]元の文[/qt]\n明日の10時でいかがでしょうか？';
    expect(stripChatworkReplyMarkup(body)).toBe('明日の10時でいかがでしょうか？');
  });

  test('[To:] と [info] も落とす', () => {
    expect(stripChatworkReplyMarkup('[To:1][info]x[/info]了解です')).toBe('了解です');
  });
});

describe('isHarnessChatworkPost', () => {
  test('[info] で始まる投稿はハーネス自身の投稿とみなす', () => {
    expect(isHarnessChatworkPost(formatIncomingNotice({ accountName: 'A', friendName: 'B', text: 'c' }))).toBe(true);
    expect(isHarnessChatworkPost('  [info]x[/info]')).toBe(true);
    expect(isHarnessChatworkPost('普通の発言')).toBe(false);
  });
});

describe('formatIncomingNotice', () => {
  test('本文に [/info] が含まれても枠が壊れない', () => {
    const s = formatIncomingNotice({ accountName: 'A', friendName: 'B', text: 'x[/info]y' });
    expect(s.endsWith('[/info]')).toBe(true);
    expect(s.indexOf('[/info]')).toBe(s.length - '[/info]'.length);
  });
});

describe('sendChatworkMessage', () => {
  test('message_id を返し、form-urlencoded で投げる', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.chatwork.com/v2/rooms/123/messages');
      expect((init?.headers as Record<string, string>)['X-ChatWorkToken']).toBe('tok');
      expect(String(init?.body)).toContain('body=hello');
      return new Response(JSON.stringify({ message_id: '999' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sendChatworkMessage('tok', '123', 'hello', { fetcher })).toBe('999');
  });

  test('非2xxは例外', async () => {
    const fetcher = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(sendChatworkMessage('tok', '123', 'hello', { fetcher })).rejects.toThrow(/401/);
  });
});

describe('isHarnessChatworkPost: [To:本人] 付きの通知', () => {
  test('[To:本人] が先頭に付いていてもハーネス自身の投稿と判定する', () => {
    expect(isHarnessChatworkPost('[To:1390104]\n[info][title]💬 x さん[/title]hi[/info]')).toBe(true);
  });
  test('池田の手打ちに [To:] が付いていてもハーネス投稿ではない', () => {
    expect(isHarnessChatworkPost('[To:1390104] こんにちは')).toBe(false);
  });
});
