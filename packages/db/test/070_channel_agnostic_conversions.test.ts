import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * schema.sql + every migration, with an optional hook that runs immediately
 * before 070 so a test can seed pre-070 rows and watch them survive the
 * table rebuild.
 */
function setupDb(seed?: (db: Database.Database) => void): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    if (file.startsWith('070') && seed) seed(db);
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function seedLineConversion(db: Database.Database): void {
  db.prepare(
    `INSERT INTO conversion_points (id, name, event_type, value, created_at)
     VALUES ('cp1', '個別相談申込', 'consultation', 1000, '2026-01-01')`,
  ).run();
  db.prepare(`INSERT INTO friends (id, line_user_id) VALUES ('f1', 'U-line-1')`).run();
  db.prepare(
    `INSERT INTO conversion_events (id, conversion_point_id, friend_id, created_at)
     VALUES ('cv-line', 'cp1', 'f1', '2026-01-02')`,
  ).run();
}

function indexNames(db: Database.Database, table: string): string[] {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'`,
    )
    .all(table)
    .map((r) => (r as { name: string }).name)
    .sort();
}

function columns(db: Database.Database, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => (c as { name: string }).name);
}

describe('070_channel_agnostic_conversions', () => {
  test('conversion_events.friend_id is nullable after the migration', () => {
    const db = setupDb();
    const friendCol = db
      .prepare(`PRAGMA table_info(conversion_events)`)
      .all()
      .find((c) => (c as { name: string }).name === 'friend_id') as { notnull: number };
    expect(friendCol.notnull).toBe(0);
  });

  test('the column list is unchanged apart from nullability', () => {
    const db = setupDb();
    expect(columns(db, 'conversion_events')).toEqual([
      'id',
      'conversion_point_id',
      'friend_id',
      'user_id',
      'affiliate_code',
      'metadata',
      'affiliate_id',
      'attributed_ref_code',
      'approval_status',
      'approved_at',
      'created_at',
    ]);
  });

  test('a mail-origin CV (no LINE friend) can be recorded against a user', () => {
    const db = setupDb(seedLineConversion);
    db.exec('PRAGMA foreign_keys = ON');
    db.prepare(`INSERT INTO users (id, email) VALUES ('u1', 'reader@example.com')`).run();
    db.prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, user_id, created_at)
       VALUES ('cv-mail', 'cp1', NULL, 'u1', '2026-02-01')`,
    ).run();
    const row = db
      .prepare(`SELECT friend_id, user_id FROM conversion_events WHERE id = 'cv-mail'`)
      .get() as { friend_id: string | null; user_id: string };
    expect(row.friend_id).toBeNull();
    expect(row.user_id).toBe('u1');
  });

  // The point of relaxing NOT NULL is to admit mail/UTAGE people, not to admit
  // conversions that belong to nobody. Without this CHECK a bug upstream would
  // quietly produce CVs that no report can ever attribute.
  test('a CV with neither friend_id nor user_id is rejected', () => {
    const db = setupDb(seedLineConversion);
    expect(() =>
      db
        .prepare(
          `INSERT INTO conversion_events (id, conversion_point_id, created_at)
           VALUES ('cv-orphan', 'cp1', '2026-02-01')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/i);
  });

  test('existing LINE conversions survive the rebuild', () => {
    const db = setupDb(seedLineConversion);
    const row = db
      .prepare(`SELECT conversion_point_id, friend_id FROM conversion_events WHERE id = 'cv-line'`)
      .get() as { conversion_point_id: string; friend_id: string };
    expect(row).toEqual({ conversion_point_id: 'cp1', friend_id: 'f1' });
  });

  // The migration renames the old table aside instead of dropping it, because
  // D1 does not wrap a --file batch in a transaction: a DROP that succeeded
  // followed by a failed RENAME would lose every conversion on record.
  test('the pre-migration table is kept as a backup rather than dropped', () => {
    const db = setupDb(seedLineConversion);
    const backup = db
      .prepare(`SELECT count(*) AS n FROM conversion_events_pre070`)
      .get() as { n: number };
    expect(backup.n).toBe(1);
  });

  // SQLite carries indexes across ALTER TABLE ... RENAME TO, keeping their
  // names. If the old names are not freed first, `CREATE INDEX IF NOT EXISTS`
  // silently no-ops and the live table runs with zero indexes.
  test('every index lands on the live table, not the backup', () => {
    const db = setupDb(seedLineConversion);
    expect(indexNames(db, 'conversion_events')).toEqual([
      'idx_conversion_events_affiliate',
      'idx_conversion_events_friend',
      'idx_conversion_events_point',
      'idx_conversion_events_user',
    ]);
    expect(indexNames(db, 'conversion_events_pre070')).toEqual([]);
  });

  test('ref_tracking can record a touch that has no LINE friend', () => {
    const db = setupDb();
    expect(columns(db, 'ref_tracking')).toContain('user_id');
    db.prepare(`INSERT INTO users (id, email) VALUES ('u1', 'reader@example.com')`).run();
    db.prepare(
      `INSERT INTO ref_tracking (id, ref_code, friend_id, user_id, created_at)
       VALUES ('rt1', 'mail-sep', NULL, 'u1', '2026-02-01')`,
    ).run();
    const row = db
      .prepare(`SELECT friend_id, user_id FROM ref_tracking WHERE id = 'rt1'`)
      .get() as { friend_id: string | null; user_id: string };
    expect(row.friend_id).toBeNull();
    expect(row.user_id).toBe('u1');
  });

  // An anonymous landing click on /r/:ref has neither a friend nor a user yet.
  // That has always been allowed and must stay allowed.
  test('ref_tracking still allows a fully anonymous click', () => {
    const db = setupDb();
    db.prepare(
      `INSERT INTO ref_tracking (id, ref_code, created_at) VALUES ('rt2', 'x-post-1', '2026-02-01')`,
    ).run();
    expect(
      (db.prepare(`SELECT count(*) AS n FROM ref_tracking WHERE id = 'rt2'`).get() as { n: number }).n,
    ).toBe(1);
  });

  test('schema.sql alone (fresh install) already has the relaxed shape', () => {
    const db = new Database(':memory:');
    execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
    const friendCol = db
      .prepare(`PRAGMA table_info(conversion_events)`)
      .all()
      .find((c) => (c as { name: string }).name === 'friend_id') as { notnull: number };
    expect(friendCol.notnull).toBe(0);
  });
});
