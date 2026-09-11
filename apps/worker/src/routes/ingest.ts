import { Hono } from 'hono';
import {
  upsertUserByEmail,
  getEntryRouteByRefCode,
  recordRefTracking,
  trackConversion,
} from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * Ingest — people who reach us without passing through LINE.
 *
 * The whole point of the 5-harness setup is one answer to "which post did this
 * person come from, and what did they pay". LINE, Threads and IG all funnel
 * into `friends`; mail does not. Someone who opts in by email never gets a
 * `friends` row, because `friends.line_user_id` is UNIQUE NOT NULL — and that
 * is correct, a friends row IS the person's LINE channel.
 *
 * So mail-origin people are recorded against `users` instead, and their ref
 * touches and conversions carry `user_id` where a LINE person carries
 * `friend_id`. Attribution, the affiliate report and the entry-route funnel all
 * key off ref_code, so once the touch is logged those work unchanged.
 *
 * Callers: mail-harness `/subscribe`, and the UTAGE opt-in bridge. Both
 * authenticate with the standard Bearer API key (see middleware/auth.ts) —
 * these paths are NOT in the public allowlist.
 *
 * Deliberately NOT here: any notion of a referral program, tags, scenarios or
 * step delivery for mail. Those already exist once, in this harness. Re-adding
 * them on the mail side would be the same concept implemented a sixth time.
 */
const ingest = new Hono<Env>();

const MAX_EMAIL = 320; // RFC 3696 practical limit
const MAX_REF_CODE = 128;
const MAX_NAME = 100;
// URL に載る資格情報なので、短い token を許すと総当たりが現実的になる。
const MIN_INGEST_TOKEN = 32;

/**
 * 定数時間比較。長さが違っても早く返らないよう、常に同じ回数だけ回す。
 *
 * 先に `a.length !== b.length` で弾くと、長さだけは応答時間から読めてしまう。
 * token の長さが分かると総当たりの空間が狭まるので、長さも漏らさない。
 */
function timingSafeEqual(a: string | undefined, b: string): boolean {
  const given = a ?? '';
  let diff = given.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= given.charCodeAt(i % (given.length || 1)) ^ b.charCodeAt(i);
  }
  return diff === 0 && given.length === b.length;
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// Same shape as the mail-harness validator: one @, no spaces, a dot in the
// domain. Deliberately loose — the authority on deliverability is the mail
// provider's bounce, not a regex.
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= MAX_EMAIL;
}

/**
 * POST /api/ingest/subscriber
 *
 * Body: { email, refCode?, name?, externalId?, sourceUrl?, utmSource?,
 *         utmMedium?, utmCampaign? }
 *
 * Idempotent: safe to call on every opt-in event. The user is upserted by
 * email. A ref touch is logged only when refCode is present, and each call
 * with a refCode logs one touch — which is what last-touch attribution wants,
 * since a person re-entering through a newer link should re-attribute.
 *
 * `externalId` is where a UTAGE reader id belongs (users.external_id), so the
 * same person can later be reconciled against UTAGE, which stays the source of
 * truth for people.
 */
/**
 * 1人分の取り込み。ルートが2つ (認証つきの API と UTAGE の受け口) あるので、
 * 中身はここ1箇所に置く。
 *
 * 返り値の `error` が入っているときは呼び出し側が 400 を返す。
 */
export async function ingestSubscriber(
  db: D1Database,
  body: Record<string, unknown>,
): Promise<
  | { error: string }
  | { userId: string; refCode: string | null; entryRouteId: string | null; refTracked: boolean }
> {
  const email = cleanString(body.email, MAX_EMAIL);
  if (!email || !isValidEmail(email)) return { error: 'valid email is required' };

  const user = await upsertUserByEmail(db, {
    email,
    displayName: cleanString(body.name, MAX_NAME),
    externalId: cleanString(body.externalId, MAX_REF_CODE),
  });

  const refCode = cleanString(body.refCode, MAX_REF_CODE);
  let entryRouteId: string | null = null;

  if (refCode) {
    // An unregistered ref_code still gets its touch logged with a NULL
    // entry_route_id. createEntryRoute() backfills those rows when the code
    // is registered later, so nothing is lost by logging it now.
    const route = await getEntryRouteByRefCode(db, refCode);
    entryRouteId = route?.id ?? null;

    await recordRefTracking(db, {
      refCode,
      userId: user.id,
      entryRouteId,
      sourceUrl: cleanString(body.sourceUrl, 2000),
      utmSource: cleanString(body.utmSource, 200),
      utmMedium: cleanString(body.utmMedium, 200),
      utmCampaign: cleanString(body.utmCampaign, 200),
    });
  }

  return { userId: user.id, refCode, entryRouteId, refTracked: Boolean(refCode) };
}

ingest.post('/api/ingest/subscriber', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await ingestSubscriber(c.env.DB, body);
    if ('error' in result) return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/ingest/subscriber error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/ingest/utage/:token — UTAGE のオプトインを受ける。
 *
 * **なぜ他と違う形なのか。**UTAGE のファネルアクション (webhook 送信) は
 * 送り先の URL と本文しか決められない。Authorization ヘッダも署名ヘッダも
 * 付けられないので、`/api/ingest/subscriber` にも
 * `/api/webhooks/incoming/:id/receive` (HMAC 必須) にも届かない。
 * 資格情報を載せられる場所が URL しか無いため、token をパスに置く。
 *
 * この形が成立する条件を外さないこと:
 *   - HTTPS のみ。パスは TLS の中なので経路では読めない
 *   - token は Worker の secret (UTAGE_INGEST_TOKEN)。未設定なら 404 で閉じる
 *   - 32文字以上を要求する。総当たりで当てられる長さにしない
 *   - 比較は定数時間。長さ違いも含めて早期 return しない
 *   - 落ちる時は理由を返さない。404 か 401 のどちらかで、
 *     「token は合っているが本文が変」以外は区別できないようにする
 *
 * 本文は UTAGE 側のアクション定義で決める。最低限 email があればよい:
 *   { "email": "...", "name": "...", "refCode": "...", "externalId": "<UTAGE読者ID>" }
 *
 * 冪等。同じ人が何度オプトインしても users は email で1行に寄る。
 */
ingest.post('/api/ingest/utage/:token', async (c) => {
  try {
    const expected = c.env.UTAGE_INGEST_TOKEN;
    // 未設定のまま口だけ開いている状態を作らない。
    if (!expected || expected.length < MIN_INGEST_TOKEN) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (!timingSafeEqual(c.req.param('token'), expected)) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const result = await ingestSubscriber(c.env.DB, body);
    if ('error' in result) return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/ingest/utage error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/ingest/conversion
 *
 * Body: { conversionPointId, email? , userId?, friendId?, metadata? }
 *
 * Records a conversion for a person identified by email (looked up/created in
 * `users`), by an explicit userId, or by a friendId. Last-touch affiliate
 * attribution is resolved inside trackConversion from whichever identity is
 * given, so a mail-origin purchase credits the same affiliate link a LINE
 * purchase would.
 */
ingest.post('/api/ingest/conversion', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const conversionPointId = cleanString(body.conversionPointId, 64);
    if (!conversionPointId) {
      return c.json({ success: false, error: 'conversionPointId is required' }, 400);
    }

    const friendId = cleanString(body.friendId, 64);
    let userId = cleanString(body.userId, 64);
    const email = cleanString(body.email, MAX_EMAIL);

    if (!userId && !friendId && email) {
      if (!isValidEmail(email)) {
        return c.json({ success: false, error: 'invalid email' }, 400);
      }
      const user = await upsertUserByEmail(c.env.DB, {
        email,
        displayName: cleanString(body.name, MAX_NAME),
      });
      userId = user.id;
    }

    if (!userId && !friendId) {
      return c.json(
        { success: false, error: 'one of friendId, userId or email is required' },
        400,
      );
    }

    const event = await trackConversion(c.env.DB, {
      conversionPointId,
      friendId,
      userId,
      metadata: cleanString(body.metadata, 4000),
    });

    return c.json({
      success: true,
      data: {
        id: event.id,
        friendId: event.friend_id,
        userId: event.user_id,
        affiliateId: event.affiliate_id,
        attributedRefCode: event.attributed_ref_code,
        approvalStatus: event.approval_status,
      },
    });
  } catch (err) {
    console.error('POST /api/ingest/conversion error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { ingest };
