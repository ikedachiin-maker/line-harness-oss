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
ingest.post('/api/ingest/subscriber', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const email = cleanString(body.email, MAX_EMAIL);
    if (!email || !isValidEmail(email)) {
      return c.json({ success: false, error: 'valid email is required' }, 400);
    }

    const user = await upsertUserByEmail(c.env.DB, {
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
      const route = await getEntryRouteByRefCode(c.env.DB, refCode);
      entryRouteId = route?.id ?? null;

      await recordRefTracking(c.env.DB, {
        refCode,
        userId: user.id,
        entryRouteId,
        sourceUrl: cleanString(body.sourceUrl, 2000),
        utmSource: cleanString(body.utmSource, 200),
        utmMedium: cleanString(body.utmMedium, 200),
        utmCampaign: cleanString(body.utmCampaign, 200),
      });
    }

    return c.json({
      success: true,
      data: { userId: user.id, refCode, entryRouteId, refTracked: Boolean(refCode) },
    });
  } catch (err) {
    console.error('POST /api/ingest/subscriber error:', err);
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
