// Chatwork 連携（池田独自・上流に無い。upstream merge で必ず残す）
//
// LINE 友だちからの受信を、アカウントごとに決めた Chatwork ルームへ流し、
// Chatwork の「返信」ボタンで書いた本文をその友だちの LINE に push する双方向リレー。
//
// 設計の要点:
//   - ハーネスが Chatwork に投稿する文は必ず [info] で始める。Chatwork の webhook は
//     自分の API トークンで投稿した分も配信してくるので、この印でエコーを捨てる
//   - 返信先の特定は Chatwork の返信タグ [rp aid=… to=ROOM-MSGID] だけを信じる。
//     本文の「最後に届いた人」などの推測はしない（誤送信の元）
//   - LINE に送れるのは池田本人（CHATWORK_OWNER_ACCOUNT_ID）の発言だけ。fail-closed

const CHATWORK_API = 'https://api.chatwork.com/v2';

export interface ChatworkWebhookEvent {
  message_id?: string | number;
  room_id?: string | number;
  account_id?: string | number;
  from_account_id?: string | number;
  body?: string;
}

export interface ChatworkWebhookPayload {
  webhook_event_type?: string;
  webhook_event?: ChatworkWebhookEvent;
}

/** LINE 受信をどのルームに流すか。line_accounts.chatwork_room_id から組む */
export interface ChatworkNotifyTarget {
  apiToken: string;
  roomId: string;
  accountName: string;
  /** 通知先（池田本人の account_id）。あれば [To:] を付けて未読で投稿する */
  ownerAccountId?: string;
}

/**
 * ルームに投稿し、Chatwork が採番した message_id を返す。
 * 返信タグの照合に使うので、message_id が取れない応答は空文字で返す（例外にしない）。
 */
export async function sendChatworkMessage(
  apiToken: string,
  roomId: string,
  body: string,
  opts: { selfUnread?: boolean; fetcher?: typeof fetch } = {},
): Promise<string> {
  const fetcher = opts.fetcher ?? fetch;
  const res = await fetcher(`${CHATWORK_API}/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': apiToken,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ body, self_unread: opts.selfUnread ? '1' : '0' }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Chatwork API ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    const parsed = JSON.parse(text) as { message_id?: string | number };
    return parsed.message_id === undefined || parsed.message_id === null
      ? ''
      : String(parsed.message_id);
  } catch {
    return '';
  }
}

// ---- Webhook 署名検証 -------------------------------------------------------
// トークン(base64)をデコードした鍵で HMAC-SHA256(生ボディ) → base64 が
// ヘッダ X-ChatWorkWebhookSignature と一致するか。固定時間で比較する。

async function matchesToken(rawBody: string, signature: string, webhookToken: string): Promise<boolean> {
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(webhookToken), (ch) => ch.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const mac = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (mac.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/**
 * Chatwork の webhook はルーム単位で作るとトークンが増えるので、カンマ区切りで
 * 複数トークンを受け取り、どれか1本と一致すれば通す。
 * 管理画面からのコピペで全角カッコや空白が混ざると atob が落ちて「署名が合わない」
 * としか見えないため、base64 に現れない文字は捨ててから照合する。
 */
export async function verifyChatworkSignature(
  rawBody: string,
  signature: string | undefined,
  webhookTokens: string | undefined,
): Promise<boolean> {
  if (!signature || !webhookTokens) return false;
  const tokens = String(webhookTokens)
    .split(',')
    .map((t) => t.replace(/[^A-Za-z0-9+/=]/g, ''))
    .filter(Boolean);
  for (const token of tokens) {
    if (await matchesToken(rawBody, signature, token)) return true;
  }
  return false;
}

/**
 * 発言者のアカウントID。webhook の種類でフィールド名が違う:
 * アカウントイベント= from_account_id、ルームイベント= account_id。
 */
export function chatworkSenderId(ev: ChatworkWebhookEvent | undefined): string {
  const id = ev?.from_account_id ?? ev?.account_id;
  return id === undefined || id === null ? '' : String(id);
}

// ---- 返信タグ ---------------------------------------------------------------

/** Chatwork の「返信」ボタンが付ける [rp aid=… to=ROOM-MSGID] から返信先を取り出す */
export function parseChatworkReplyTarget(body: string): { roomId: string; messageId: string } | null {
  const m = /\[rp\s+aid=\d+\s+to=(\d+)-(\d+)\]/i.exec(body);
  if (!m) return null;
  return { roomId: m[1]!, messageId: m[2]!, };
}

/**
 * LINE に送る本文から Chatwork の装飾を落とす。
 * 返信タグ・宛先タグ・「[pname:…]さん」・引用ブロック・[info]…[/info] を除く。
 */
export function stripChatworkReplyMarkup(body: string): string {
  return body
    .replace(/\[qt\][\s\S]*?\[\/qt\]/gi, '')
    .replace(/\[info\][\s\S]*?\[\/info\]/gi, '')
    .replace(/\[rp\s+aid=\d+\s+to=\d+-\d+\]/gi, '')
    .replace(/\[To:\d+\]/gi, '')
    .replace(/\[(?:pname|piconname):\d+\]\s*さん/gi, '')
    .replace(/\[(?:pname|piconname|picon):\d+\]/gi, '')
    .replace(/\[(?:hr|\/?title|\/?code|\/?preview[^\]]*|dtext:[^\]]*)\]/gi, '')
    .trim();
}

/** ハーネス自身の投稿か（エコー除外用）。投稿は必ず [info] で始める */
export function isHarnessChatworkPost(body: string): boolean {
  return body.trimStart().startsWith('[info]');
}

// ---- 投稿文 -----------------------------------------------------------------

function safeText(s: string): string {
  // 本文が [/info] 等を含むと投稿の枠が崩れるので全角に逃がす
  return s.replace(/\[\/?(info|title|code|qt)\]/gi, (m) => m.replace('[', '［').replace(']', '］'));
}

export function formatIncomingNotice(p: { accountName: string; friendName: string; text: string }): string {
  return `[info][title]💬 ${safeText(p.friendName)} さん（${safeText(p.accountName)}）[/title]${safeText(p.text)}[/info]`;
}

export function formatFollowNotice(p: { accountName: string; friendName: string }): string {
  return `[info][title]➕ 友だち追加（${safeText(p.accountName)}）[/title]${safeText(p.friendName)} さんが友だち追加しました。このメッセージに「返信」すると、この方のLINEに届きます。[/info]`;
}

export function formatUnfollowNotice(p: { accountName: string; friendName: string }): string {
  return `[info][title]🚫 ブロック（${safeText(p.accountName)}）[/title]${safeText(p.friendName)} さんがブロックしました。[/info]`;
}

export function formatSentConfirmation(friendName: string): string {
  return `[info]✅ ${safeText(friendName)} さんのLINEに送信しました。[/info]`;
}

export function formatReplyHint(reason: 'no-reply-tag' | 'unknown-target' | 'friend-missing'): string {
  switch (reason) {
    case 'no-reply-tag':
      return '[info]💡 LINEに返すには、届いたメッセージの「返信」ボタンから書いてください。この投稿はLINEには送られていません。[/info]';
    case 'unknown-target':
      return '[info]⚠️ 返信先のLINEが見つかりませんでした。💬 で始まる受信メッセージ、または ➕ 友だち追加のメッセージに「返信」してください。[/info]';
    case 'friend-missing':
      return '[info]⚠️ この方は友だち一覧から消えているため送信できませんでした。[/info]';
  }
}

// ---- 受信→Chatwork 通知（webhook.ts から呼ぶ） -------------------------------

/**
 * Chatwork に通知し、返信先を引けるように message_id と友だちの対応を記録する。
 * 失敗しても LINE 側の処理は止めない（ログだけ残す）。
 */
export async function notifyChatworkAndRemember(
  db: D1Database,
  target: ChatworkNotifyTarget,
  text: string,
  friendId: string | null,
  lineAccountId: string | null,
): Promise<void> {
  try {
    // 投稿は池田本人のトークンで行うので、そのままでは自分の発言＝既読・通知なしになる。
    // [To:本人] を付け、self_unread=1 で未読に積んで気づけるようにする。
    const owner = String(target.ownerAccountId ?? '').trim();
    const body = /^\d+$/.test(owner) ? `[To:${owner}]\n${text}` : text;
    const messageId = await sendChatworkMessage(target.apiToken, target.roomId, body, { selfUnread: true });
    if (messageId && friendId) {
      await db
        .prepare(
          `INSERT OR REPLACE INTO chatwork_relay_messages (cw_message_id, cw_room_id, friend_id, line_account_id, created_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
        )
        .bind(messageId, target.roomId, friendId, lineAccountId)
        .run();
    }
  } catch (err) {
    console.error('Chatwork notify error:', err);
  }
}
