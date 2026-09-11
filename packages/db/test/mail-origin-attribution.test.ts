import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAffiliateAttribution } from '../src/affiliate-attribution.js';
import { trackConversion } from '../src/conversions.js';
import { recordRefTracking } from '../src/entry-routes.js';
import { upsertUserByEmail } from '../src/users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              stmt.run(...params);
              return { results: [], success: true, meta: {} };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          sqlite.prepare(query).run();
          return { results: [], success: true, meta: {} };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

const NOW = '2026-09-10T12:00:00.000+09:00';
function jstDaysAgo(days: number): string {
  const ms = new Date(NOW).getTime() - days * 86_400_000;
  return new Date(ms + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);

  sqlite
    .prepare(
      `INSERT INTO conversion_points (id, name, event_type, value, created_at)
       VALUES ('cp-consult', '個別相談申込', 'consultation', 30000, '2026-01-01T00:00:00.000+09:00')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO affiliates (id, name, code, commission_rate, is_active, created_at, friend_id)
       VALUES ('aff-1', '紹介パートナー', 'partner-1', 0.2, 1, '2026-01-01T00:00:00.000+09:00', NULL)`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, label, line_account_id, is_active, created_at, click_count)
       VALUES ('link-1', 'aff-1', 'mailmaga-0910', 'メルマガ 9/10', NULL, 1, '2026-01-01T00:00:00.000+09:00', 0)`,
    )
    .run();
});

describe('mail-origin people (no LINE friend row)', () => {
  test('upsertUserByEmail creates once and updates thereafter', async () => {
    const first = await upsertUserByEmail(db, { email: 'Reader@Example.com ' });
    expect(first.email).toBe('reader@example.com');

    const second = await upsertUserByEmail(db, {
      email: 'reader@example.com',
      displayName: '読者A',
      externalId: 'utage-8842',
    });
    expect(second.id).toBe(first.id);
    expect(second.display_name).toBe('読者A');
    expect(second.external_id).toBe('utage-8842');

    const count = sqlite.prepare(`SELECT count(*) AS n FROM users`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  // A name the person typed into LINE is better data than one echoed from a
  // mail form, so an existing value must not be clobbered on re-subscribe.
  test('upsertUserByEmail does not overwrite a name it already has', async () => {
    const created = await upsertUserByEmail(db, { email: 'a@example.com', displayName: '本名' });
    const again = await upsertUserByEmail(db, { email: 'a@example.com', displayName: 'form入力' });
    expect(again.id).toBe(created.id);
    expect(again.display_name).toBe('本名');
  });

  test('a ref touch can be recorded against a user with no friend row', async () => {
    const user = await upsertUserByEmail(db, { email: 'reader@example.com' });
    const touch = await recordRefTracking(db, {
      refCode: 'mailmaga-0910',
      userId: user.id,
      sourceUrl: 'https://sub.ad-marketing.xyz/p/abc',
    });
    expect(touch.user_id).toBe(user.id);
    expect(touch.friend_id).toBeNull();
  });

  test('attribution resolves from a user-side touch', async () => {
    const user = await upsertUserByEmail(db, { email: 'reader@example.com' });
    sqlite
      .prepare(
        `INSERT INTO ref_tracking (id, ref_code, friend_id, user_id, created_at)
         VALUES ('rt-1', 'mailmaga-0910', NULL, ?, ?)`,
      )
      .run(user.id, jstDaysAgo(3));

    const attr = await resolveAffiliateAttribution(db, { userId: user.id }, NOW);
    expect(attr).toEqual({ affiliateId: 'aff-1', refCode: 'mailmaga-0910' });
  });

  // This is the whole point of GOAL A: a purchase by someone who only ever
  // gave us an email must still credit the link that brought them in.
  test('a mail-origin conversion carries the affiliate attribution', async () => {
    const user = await upsertUserByEmail(db, { email: 'reader@example.com' });
    sqlite
      .prepare(
        `INSERT INTO ref_tracking (id, ref_code, friend_id, user_id, created_at)
         VALUES ('rt-1', 'mailmaga-0910', NULL, ?, ?)`,
      )
      .run(user.id, jstDaysAgo(3));

    const event = await trackConversion(db, {
      conversionPointId: 'cp-consult',
      userId: user.id,
    });

    expect(event.friend_id).toBeNull();
    expect(event.user_id).toBe(user.id);
    expect(event.affiliate_id).toBe('aff-1');
    expect(event.attributed_ref_code).toBe('mailmaga-0910');
    expect(event.approval_status).toBe('pending');
  });

  test('a mail-origin conversion with no touch stays unattributed', async () => {
    const user = await upsertUserByEmail(db, { email: 'reader@example.com' });
    const event = await trackConversion(db, {
      conversionPointId: 'cp-consult',
      userId: user.id,
    });
    expect(event.affiliate_id).toBeNull();
    expect(event.approval_status).toBeNull();
  });

  test('trackConversion refuses a conversion that belongs to nobody', async () => {
    await expect(trackConversion(db, { conversionPointId: 'cp-consult' })).rejects.toThrow(
      /requires friendId or userId/,
    );
  });

  test('the LINE path is unchanged', async () => {
    sqlite
      .prepare(
        `INSERT INTO friends (id, line_user_id, created_at, updated_at)
         VALUES ('f-1', 'Uline000000000000000000000000001', ?, ?)`,
      )
      .run(jstDaysAgo(10), jstDaysAgo(10));
    sqlite
      .prepare(
        `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
         VALUES ('rt-line', 'mailmaga-0910', 'f-1', ?)`,
      )
      .run(jstDaysAgo(2));

    const event = await trackConversion(db, {
      conversionPointId: 'cp-consult',
      friendId: 'f-1',
    });
    expect(event.friend_id).toBe('f-1');
    expect(event.affiliate_id).toBe('aff-1');
    expect(event.attributed_ref_code).toBe('mailmaga-0910');
  });

  // The old call shape (a bare friend id) is still used across the worker.
  test('resolveAffiliateAttribution still accepts a bare friend id', async () => {
    sqlite
      .prepare(
        `INSERT INTO friends (id, line_user_id, created_at, updated_at)
         VALUES ('f-1', 'Uline000000000000000000000000001', ?, ?)`,
      )
      .run(jstDaysAgo(10), jstDaysAgo(10));
    sqlite
      .prepare(
        `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
         VALUES ('rt-line', 'mailmaga-0910', 'f-1', ?)`,
      )
      .run(jstDaysAgo(2));

    expect(await resolveAffiliateAttribution(db, 'f-1', NOW)).toEqual({
      affiliateId: 'aff-1',
      refCode: 'mailmaga-0910',
    });
  });

  // A friend touch and a user touch must not bleed into each other: resolving
  // by user id must ignore rows that belong to a LINE friend and vice versa.
  test('friend touches and user touches do not cross-attribute', async () => {
    const user = await upsertUserByEmail(db, { email: 'reader@example.com' });
    sqlite
      .prepare(
        `INSERT INTO friends (id, line_user_id, created_at, updated_at)
         VALUES ('f-1', 'Uline000000000000000000000000001', ?, ?)`,
      )
      .run(jstDaysAgo(10), jstDaysAgo(10));
    sqlite
      .prepare(
        `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
         VALUES ('rt-line', 'mailmaga-0910', 'f-1', ?)`,
      )
      .run(jstDaysAgo(2));

    // The user has no touch of their own, only the friend does.
    expect(await resolveAffiliateAttribution(db, { userId: user.id }, NOW)).toBeNull();
  });
});
