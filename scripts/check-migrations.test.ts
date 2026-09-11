import { describe, expect, it } from 'vitest';
import {
  POLICY_CUTOFF_PREFIX,
  checkMigration,
  filterMigrationsByPolicy,
  hasRecreateWaiver,
} from './check-migrations';

describe('checkMigration', () => {
  it('rejects CREATE TRIGGER because its body cannot be split safely', () => {
    const result = checkMigration(
      'CREATE TRIGGER audit AFTER INSERT ON friends BEGIN INSERT INTO logs VALUES (NEW.id); END;',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toContain('CREATE TRIGGER');
  });
  it('allows CREATE TABLE', () => {
    const sql = `CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows ALTER TABLE ADD COLUMN with DEFAULT', () => {
    const sql = `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows ALTER TABLE ADD COLUMN with NULL (no NOT NULL)', () => {
    const sql = `ALTER TABLE foo ADD COLUMN nickname TEXT;`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows CREATE INDEX', () => {
    const sql = `CREATE INDEX idx_foo_name ON foo (name);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows INSERT seed data', () => {
    const sql = `INSERT INTO foo (id, name) VALUES (1, 'seed');`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('blocks DROP TABLE', () => {
    const sql = `DROP TABLE foo;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP TABLE/i);
  });

  it('blocks DROP COLUMN', () => {
    const sql = `ALTER TABLE foo DROP COLUMN name;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP COLUMN/i);
  });

  it('blocks RENAME TABLE (ALTER TABLE x RENAME TO y)', () => {
    const sql = `ALTER TABLE foo RENAME TO bar;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME/i);
  });

  it('blocks RENAME COLUMN', () => {
    const sql = `ALTER TABLE foo RENAME COLUMN old_name TO new_name;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME COLUMN/i);
  });

  it('blocks ALTER COLUMN TYPE', () => {
    const sql = `ALTER TABLE foo ALTER COLUMN id TYPE INTEGER;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/ALTER COLUMN TYPE/i);
  });

  it('blocks NOT NULL without default', () => {
    const sql = `ALTER TABLE foo ADD COLUMN required_field TEXT NOT NULL;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/NOT NULL/i);
  });

  it('allows NOT NULL with DEFAULT', () => {
    const sql = `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('blocks ADD UNIQUE constraint (inline)', () => {
    const sql = `ALTER TABLE foo ADD UNIQUE (email);`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('blocks ADD CONSTRAINT UNIQUE', () => {
    const sql = `ALTER TABLE foo ADD CONSTRAINT foo_email_unique UNIQUE (email);`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('ignores -- line comments (DROP TABLE in comment is OK)', () => {
    const sql = `-- DROP TABLE foo;\nCREATE TABLE bar (id INTEGER);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('ignores comments mentioning forbidden constructs', () => {
    const sql = `-- This adds a column. We must NOT NULL would be bad without default.\nALTER TABLE foo ADD COLUMN x TEXT;`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('returns first violation if multiple', () => {
    const sql = `DROP TABLE foo;\nDROP TABLE bar;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
  });

  it('allows CREATE UNIQUE INDEX (this is index, not ADD UNIQUE constraint)', () => {
    const sql = `CREATE UNIQUE INDEX idx_foo_email ON foo (email);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('handles case-insensitive matching', () => {
    const sql = `drop table foo;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
  });
});

describe('allow-recreate waiver', () => {
  const WAIVER = '-- migration-policy: allow-recreate — SQLite cannot relax NOT NULL in place.\n';

  it('permits the create-copy-rename sequence when the waiver is present', () => {
    const sql =
      WAIVER +
      `CREATE TABLE foo_new (id TEXT PRIMARY KEY, owner TEXT);\n` +
      `INSERT INTO foo_new (id, owner) SELECT id, owner FROM foo;\n` +
      `ALTER TABLE foo RENAME TO foo_pre070;\n` +
      `ALTER TABLE foo_new RENAME TO foo;\n`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('still blocks the same sequence without the waiver', () => {
    const sql = `ALTER TABLE foo RENAME TO foo_pre070;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME/i);
  });

  // The waiver narrows to recreate-shaped changes only. If it ever suppressed
  // DROP TABLE, a failed migration could delete rows outright — which is the
  // exact risk the no-DROP shape exists to remove.
  it('does NOT waive DROP TABLE', () => {
    const result = checkMigration(WAIVER + 'DROP TABLE foo;');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP TABLE/i);
  });

  it('does NOT waive DROP COLUMN', () => {
    const result = checkMigration(WAIVER + 'ALTER TABLE foo DROP COLUMN name;');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP COLUMN/i);
  });

  it('does NOT waive RENAME COLUMN', () => {
    const result = checkMigration(WAIVER + 'ALTER TABLE foo RENAME COLUMN a TO b;');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME COLUMN/i);
  });

  it('does NOT waive ADD UNIQUE', () => {
    const result = checkMigration(WAIVER + 'ALTER TABLE foo ADD UNIQUE (email);');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('requires a reason after the marker', () => {
    expect(hasRecreateWaiver('-- migration-policy: allow-recreate\n')).toBe(false);
    expect(hasRecreateWaiver('-- migration-policy: allow-recreate — \n')).toBe(false);
    expect(hasRecreateWaiver('-- migration-policy: allow-recreate — because.\n')).toBe(true);
  });

  it('accepts a plain hyphen or colon as the separator before the reason', () => {
    expect(hasRecreateWaiver('-- migration-policy: allow-recreate - because.\n')).toBe(true);
    expect(hasRecreateWaiver('-- migration-policy: allow-recreate: because.\n')).toBe(true);
  });

  it('is not triggered by the phrase appearing outside a comment', () => {
    expect(hasRecreateWaiver(`INSERT INTO notes (body) VALUES ('allow-recreate');`)).toBe(false);
  });
});

describe('filterMigrationsByPolicy', () => {
  const sample = [
    '001_round2.sql',
    '027_dedup_delivery.sql',
    '029_account_management_v2.sql',
    '040_events_multi_account.sql',
    '041_update_history.sql',
    '042_future.sql',
  ];

  it('returns only files with prefix >= POLICY_CUTOFF_PREFIX by default', () => {
    expect(POLICY_CUTOFF_PREFIX).toBe('041');
    expect(filterMigrationsByPolicy(sample)).toEqual([
      '041_update_history.sql',
      '042_future.sql',
    ]);
  });

  it('returns only files with prefix >= POLICY_CUTOFF_PREFIX when all is false', () => {
    expect(filterMigrationsByPolicy(sample, { all: false })).toEqual([
      '041_update_history.sql',
      '042_future.sql',
    ]);
  });

  it('returns all files when all flag is true', () => {
    expect(filterMigrationsByPolicy(sample, { all: true })).toEqual(sample);
  });

  it('excludes the pre-existing 027 / 029 violations under the default cutoff', () => {
    const filtered = filterMigrationsByPolicy(sample);
    expect(filtered).not.toContain('027_dedup_delivery.sql');
    expect(filtered).not.toContain('029_account_management_v2.sql');
  });

  it('returns an empty array when no files meet the cutoff', () => {
    expect(filterMigrationsByPolicy(['001_a.sql', '010_b.sql'])).toEqual([]);
  });
});
