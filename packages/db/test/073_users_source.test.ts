import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bulkUpsertUsersByEmail, upsertUserByEmail } from '../src/users.js';
import { listPeople } from '../src/people.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');
const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    try { db.exec(stmt); } catch (err) {
      if (!BENIGN.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

// better-sqlite3 を D1 の形に被せる(他の db テストと同じ最小限)
function asD1(sqlite: Database.Database): D1Database {
  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => { bound = args; return stmt; },
      first: async <T,>() => (sqlite.prepare(sql).get(...bound) as T) ?? null,
      all: async <T,>() => ({ results: sqlite.prepare(sql).all(...bound) as T[] }),
      run: async () => { sqlite.prepare(sql).run(...bound); return { success: true }; },
      _sql: sql, _bound: () => bound,
    };
    return stmt;
  };
  return {
    prepare,
    batch: async (stmts: any[]) => { for (const s of stmts) await s.run(); return []; },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('bulkUpsertUsersByEmail', () => {
  test('inserts new people with their source and keeps running it idempotent', async () => {
    const rows = [
      { email: 'A@example.com', displayName: '太郎', externalId: 'utage:r1', source: 'utage', sourceList: 'utage-purchasers', sourceLabel: '購入者リスト', subscribedAt: '2026-08-01 10:00:00' },
      { email: 'b@example.com', source: 'utage', sourceList: 'utage-mnp-consult', sourceLabel: 'mnp無料コンサル' },
    ];
    const first = await bulkUpsertUsersByEmail(db, rows);
    expect(first).toEqual({ created: 2, updated: 0, skipped: 0 });

    const a = sqlite.prepare(`SELECT * FROM users WHERE email = 'a@example.com'`).get() as any;
    expect(a.display_name).toBe('太郎');
    expect(a.source_list).toBe('utage-purchasers');
    expect(a.subscribed_at).toBe('2026-08-01 10:00:00');

    // 2回目: 何も増えない、何も変わらない
    const second = await bulkUpsertUsersByEmail(db, rows);
    expect(second).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect((sqlite.prepare(`SELECT COUNT(*) n FROM users`).get() as any).n).toBe(2);
  });

  // 影は正本を上書きしない。既に名前が入っている人の名前を、取り込みで変えない。
  test('fills only empty fields on people who already exist', async () => {
    await upsertUserByEmail(db, { email: 'c@example.com', displayName: '既存の名前' });
    const r = await bulkUpsertUsersByEmail(db, [
      { email: 'c@example.com', displayName: '取り込みの名前', source: 'utage', sourceList: 'utage-mnp-consult', sourceLabel: 'mnp無料コンサル' },
    ]);
    expect(r).toEqual({ created: 0, updated: 1, skipped: 0 });
    const c = sqlite.prepare(`SELECT * FROM users WHERE email = 'c@example.com'`).get() as any;
    expect(c.display_name).toBe('既存の名前');
    expect(c.source).toBe('utage');
  });

  test('skips duplicates inside one batch and malformed emails', async () => {
    const r = await bulkUpsertUsersByEmail(db, [
      { email: 'd@example.com', source: 'utage' },
      { email: 'D@example.com', source: 'utage' },
      { email: 'not-an-email', source: 'utage' },
    ]);
    expect(r).toEqual({ created: 1, updated: 0, skipped: 2 });
  });
});

describe('listPeople', () => {
  beforeEach(async () => {
    sqlite.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token) VALUES ('acc1','本体','1','s','t')`).run();
    sqlite.prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, first_followed_at) VALUES ('f1','U1','山田','acc1',1,'2026-09-01T00:00:00')`).run();
    sqlite.prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following, first_followed_at) VALUES ('f2','U2','ブロック済','acc1',0,'2026-09-02T00:00:00')`).run();
    await bulkUpsertUsersByEmail(db, [
      { email: 'reader@example.com', displayName: '読者', source: 'utage', sourceList: 'utage-mnp-consult', sourceLabel: 'mnp無料コンサル', subscribedAt: '2026-09-03 00:00:00' },
      { email: 'old@example.com', source: 'utage', sourceLabel: '購入者リスト', subscribedAt: '2026-01-01 00:00:00' },
    ]);
  });

  test('merges LINE friends and mail readers, newest first, hiding unfollowed', async () => {
    const r = await listPeople(db, { channel: 'all' });
    expect(r.total).toBe(3);
    expect(r.items.map((i) => [i.channel, i.display_name ?? i.email])).toEqual([
      ['mail', '読者'],
      ['line', '山田'],
      ['mail', 'old@example.com'],
    ]);
    expect(r.items[0].source_label).toBe('mnp無料コンサル');
  });

  test('filters by channel', async () => {
    expect((await listPeople(db, { channel: 'line' })).items.map((i) => i.channel)).toEqual(['line']);
    expect((await listPeople(db, { channel: 'mail' })).total).toBe(2);
  });

  test('searches mail readers by email as well as name', async () => {
    const r = await listPeople(db, { channel: 'all', search: 'old@' });
    expect(r.items.map((i) => i.email)).toEqual(['old@example.com']);
  });

  test('paginates across the union', async () => {
    const p1 = await listPeople(db, { channel: 'all', limit: 2, offset: 0 });
    const p2 = await listPeople(db, { channel: 'all', limit: 2, offset: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.hasNextPage).toBe(true);
    expect(p2.items).toHaveLength(1);
    expect(p2.hasNextPage).toBe(false);
  });
});
