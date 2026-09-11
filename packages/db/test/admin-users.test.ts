import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hashPassword,
  verifyPassword,
  validatePassword,
  normalizeEmail,
  isValidEmail,
  createAdminUser,
  getAdminUserByEmail,
  listAdminUsers,
  countAdminUsers,
  setAdminUserPassword,
  deactivateAdminUser,
  authenticateAdminUser,
  createAdminSession,
  resolveAdminSession,
  revokeAdminSession,
  revokeAllSessionsForUser,
  purgeExpiredAdminSessions,
  MAX_FAILED_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_PER_ROUND,
} from '../src/admin-users.js';

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

// 本物の計算量だとこの本数でテストが数十秒かかる。アルゴリズムの正しさは
// 計算量に依存しないので、既定値そのものは別に1本だけ確かめる。
const FAST = { iterationsPerRound: 1000, rounds: 1 };

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

describe('password hashing', () => {
  test('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple', FAST);
    expect((await verifyPassword('correct horse battery staple', stored)).valid).toBe(true);
  });

  test('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple', FAST);
    expect((await verifyPassword('Correct horse battery staple', stored)).valid).toBe(false);
    expect((await verifyPassword('', stored)).valid).toBe(false);
  });

  // 同じパスワードでも毎回違う値になること。塩が効いていなければ、
  // 一致するハッシュを見るだけで「同じパスワードの人」が割れる。
  test('salts every hash, so the same password stores differently', async () => {
    const a = await hashPassword('same password here', FAST);
    const b = await hashPassword('same password here', FAST);
    expect(a).not.toBe(b);
    expect((await verifyPassword('same password here', a)).valid).toBe(true);
    expect((await verifyPassword('same password here', b)).valid).toBe(true);
  });

  test('records the algorithm and iteration count in the stored value', async () => {
    const stored = await hashPassword('some password here', FAST);
    const [scheme, hash, perRound, rounds] = stored.split('$');
    expect(scheme).toBe('pbkdf2');
    expect(hash).toBe('sha256');
    expect(Number(perRound)).toBe(FAST.iterationsPerRound);
    expect(Number(rounds)).toBe(FAST.rounds);
  });

  // 回数を上げたとき、古い行をその場で検証できないと全員のパスワードを
  // 再設定させることになる。
  test('verifies a hash stored with a different iteration count', async () => {
    const stored = await hashPassword('some password here', FAST);
    const result = await verifyPassword('some password here', stored);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  test('flags no rehash when stored at the current cost', async () => {
    const stored = await hashPassword('some password here');
    expect((await verifyPassword('some password here', stored)).needsRehash).toBe(false);
  }, 30_000);

  // Cloudflare 本番は 100,000 回を超える導出を拒む (NotSupportedError)。
  // 既定値がそれを超えていると、本番でだけログインが 500 になる。
  // `wrangler dev --local` はこの制限を課さないので、ここで釘を打っておく。
  test('never asks the platform for more iterations than it allows', async () => {
    expect(PBKDF2_ITERATIONS_PER_ROUND).toBeLessThanOrEqual(100_000);
    const stored = await hashPassword('some password here');
    expect(Number(stored.split('$')[2])).toBeLessThanOrEqual(100_000);
  }, 30_000);

  // 上限超えの値が入った行は、この環境では検証しようが無い。
  // 例外ではなく不一致として返らないと、壊れた行1つでログイン全体が 500 になる。
  test('treats an over-limit stored hash as a mismatch, not a crash', async () => {
    const overLimit = `pbkdf2$sha256$600000$1$${btoa('salt')}$${btoa('hash')}`;
    await expect(verifyPassword('anything', overLimit)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  // rounds を持たなかった頃の5列形式も読めること。
  test('still verifies a legacy hash with no rounds field', async () => {
    const salt = 'c2FsdHNhbHRzYWx0c2E=';
    const legacy = await hashPassword('legacy password', { iterationsPerRound: 1000, rounds: 1 });
    const asFiveColumn = legacy.split('$').filter((_, i) => i !== 3).join('$');
    expect(asFiveColumn.split('$')).toHaveLength(5);
    expect((await verifyPassword('legacy password', asFiveColumn)).valid).toBe(true);
    expect(salt).toBeTruthy();
  });

  // 壊れた行1つでログイン全体が 500 になっては困る。
  test('treats a malformed stored value as a mismatch, not an error', async () => {
    for (const bad of ['', 'garbage', 'pbkdf2$sha256$notanumber$a$b', 'bcrypt$x$y$z$w', 'a$b$c$d$e']) {
      await expect(verifyPassword('anything', bad)).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    }
  });
});

describe('validatePassword', () => {
  test(`requires at least ${MIN_PASSWORD_LENGTH} characters`, () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/文字以上/);
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  test('rejects a non-string and an absurd length', () => {
    expect(validatePassword(undefined)).toMatch(/入力/);
    expect(validatePassword(12345678901234)).toMatch(/入力/);
    expect(validatePassword('a'.repeat(201))).toMatch(/長すぎます/);
  });

  // 記号の強制はしない。長いパスフレーズが通ることを保証しておく。
  test('accepts a long passphrase with no symbols', () => {
    expect(validatePassword('みかんをたくさん食べる朝')).toBeNull();
  });
});

describe('email handling', () => {
  test('normalizes case and surrounding space', () => {
    expect(normalizeEmail('  Ikeda@Example.COM ')).toBe('ikeda@example.com');
    expect(normalizeEmail(undefined)).toBe('');
  });

  test('validates shape', () => {
    expect(isValidEmail('ikeda@example.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a b@example.com')).toBe(false);
  });

  // Foo@ と foo@ で2アカウント作れてしまうと、どちらが本物か分からなくなる。
  test('the database refuses a second account differing only in case', async () => {
    await createAdminUser(db, { email: 'ikeda@example.com', password: 'a'.repeat(12) });
    await expect(
      createAdminUser(db, { email: 'IKEDA@example.com', password: 'b'.repeat(12) }),
    ).rejects.toThrow(/UNIQUE/i);
  }, 30_000);

  test('finds a user regardless of the case typed at login', async () => {
    await createAdminUser(db, { email: 'Ikeda@Example.com', password: 'a'.repeat(12) });
    expect(await getAdminUserByEmail(db, 'IKEDA@EXAMPLE.COM')).not.toBeNull();
  }, 30_000);
});

describe('admin user records', () => {
  test('created users are counted and listed without the hash', async () => {
    expect(await countAdminUsers(db)).toBe(0);
    await createAdminUser(db, {
      email: 'ikeda@example.com',
      password: 'a'.repeat(12),
      name: '池田宜史',
      role: 'owner',
    });
    expect(await countAdminUsers(db)).toBe(1);

    const listed = await listAdminUsers(db);
    expect(listed).toHaveLength(1);
    expect(listed[0].email).toBe('ikeda@example.com');
    expect(listed[0].name).toBe('池田宜史');
    // 一覧に載せると、画面やログ経由で外へ出る経路が増える。
    expect('password_hash' in listed[0]).toBe(false);
  }, 30_000);

  test('a deactivated user stops counting and cannot sign in', async () => {
    const user = await createAdminUser(db, {
      email: 'ikeda@example.com',
      password: 'a'.repeat(12),
    });
    await deactivateAdminUser(db, user.id);

    expect(await countAdminUsers(db)).toBe(0);
    const result = await authenticateAdminUser(db, 'ikeda@example.com', 'a'.repeat(12));
    expect(result).toEqual({ ok: false, reason: 'inactive' });
  }, 30_000);
});

describe('authenticateAdminUser', () => {
  const EMAIL = 'ikeda@example.com';
  const PASSWORD = 'correct horse battery';

  beforeEach(async () => {
    await createAdminUser(db, { email: EMAIL, password: PASSWORD, name: '池田' });
  }, 30_000);

  test('accepts the right password', async () => {
    const result = await authenticateAdminUser(db, EMAIL, PASSWORD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.email).toBe(EMAIL);
  }, 30_000);

  test('records the login time and clears the failure count', async () => {
    await authenticateAdminUser(db, EMAIL, 'wrong');
    await authenticateAdminUser(db, EMAIL, PASSWORD);
    const user = await getAdminUserByEmail(db, EMAIL);
    expect(user!.failed_attempts).toBe(0);
    expect(user!.last_login_at).not.toBeNull();
  }, 30_000);

  // 「そのアドレスは無い」と「パスワードが違う」を区別して返すと、
  // どのアドレスが登録済みかを外から数えられる。
  test('gives the same answer for an unknown address as for a wrong password', async () => {
    const unknown = await authenticateAdminUser(db, 'nobody@example.com', PASSWORD);
    const wrong = await authenticateAdminUser(db, EMAIL, 'wrong password here');
    expect(unknown).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(wrong).toEqual({ ok: false, reason: 'invalid_credentials' });
  }, 30_000);

  // 存在しないアドレスのほうが計算量が多いと、応答時間の差で未登録だと分かる。
  // どちらの経路も「検証1回」に揃っていることを、経過時間の比で確かめる。
  test('spends comparable time on an unknown address as on a known one', async () => {
    const t0 = Date.now();
    await authenticateAdminUser(db, 'nobody@example.com', PASSWORD);
    const unknown = Date.now() - t0;

    const t1 = Date.now();
    await authenticateAdminUser(db, EMAIL, 'wrong password here');
    const known = Date.now() - t1;

    // 厳密な等時間は保証できない (DB 往復もある)。倍半分に収まっていれば、
    // 「片方だけハッシュを1回余分に作る」ような差は無い。
    expect(unknown).toBeLessThan(known * 2 + 200);
    expect(known).toBeLessThan(unknown * 2 + 200);
  }, 60_000);

  test('counts consecutive failures', async () => {
    await authenticateAdminUser(db, EMAIL, 'wrong');
    await authenticateAdminUser(db, EMAIL, 'wrong');
    expect((await getAdminUserByEmail(db, EMAIL))!.failed_attempts).toBe(2);
  }, 30_000);

  test('locks the account after too many failures, then lets it back in', async () => {
    const now = new Date('2026-09-11T10:00:00Z');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await authenticateAdminUser(db, EMAIL, 'wrong', { now });
    }

    // 正しいパスワードでも締められている間は通さない。
    const locked = await authenticateAdminUser(db, EMAIL, PASSWORD, { now });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.reason).toBe('locked');
      expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    }

    const later = new Date(now.getTime() + 16 * 60 * 1000);
    expect((await authenticateAdminUser(db, EMAIL, PASSWORD, { now: later })).ok).toBe(true);
  }, 60_000);
});

describe('sessions', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createAdminUser(db, {
      email: 'ikeda@example.com',
      password: 'a'.repeat(12),
    });
    userId = user.id;
  }, 30_000);

  test('a fresh token resolves to its user', async () => {
    const { token } = await createAdminSession(db, userId);
    const resolved = await resolveAdminSession(db, token);
    expect(resolved?.id).toBe(userId);
  });

  // DB に券そのものを置くと、DB が漏れた時点で全員になりすませる。
  test('stores only a hash of the token, never the token itself', async () => {
    const { token } = await createAdminSession(db, userId);
    const rows = sqlite.prepare(`SELECT token_hash FROM admin_sessions`).all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('an unknown or empty token resolves to nothing', async () => {
    expect(await resolveAdminSession(db, 'not-a-real-token')).toBeNull();
    expect(await resolveAdminSession(db, '')).toBeNull();
  });

  test('an expired token stops working', async () => {
    const now = new Date('2026-09-11T10:00:00Z');
    const { token } = await createAdminSession(db, userId, { ttlSeconds: 60, now });
    expect(await resolveAdminSession(db, token, { now })).not.toBeNull();

    const later = new Date(now.getTime() + 61 * 1000);
    expect(await resolveAdminSession(db, token, { now: later })).toBeNull();
  });

  // 使い続ける限り切れない、では7日の期限が意味を失う。
  test('using a session does not extend its expiry', async () => {
    const now = new Date('2026-09-11T10:00:00Z');
    const { token, expiresAt } = await createAdminSession(db, userId, { ttlSeconds: 3600, now });
    await resolveAdminSession(db, token, { now: new Date(now.getTime() + 1800 * 1000) });

    const row = sqlite.prepare(`SELECT expires_at, last_seen_at FROM admin_sessions`).get() as {
      expires_at: string;
      last_seen_at: string;
    };
    expect(row.expires_at).toBe(expiresAt);
    expect(row.last_seen_at).not.toBe(now.toISOString());
  });

  test('revoking one token leaves the others alone', async () => {
    const a = await createAdminSession(db, userId);
    const b = await createAdminSession(db, userId);
    await revokeAdminSession(db, a.token);

    expect(await resolveAdminSession(db, a.token)).toBeNull();
    expect(await resolveAdminSession(db, b.token)).not.toBeNull();
  });

  test('revoking all cuts every device', async () => {
    const a = await createAdminSession(db, userId);
    const b = await createAdminSession(db, userId);
    await revokeAllSessionsForUser(db, userId);

    expect(await resolveAdminSession(db, a.token)).toBeNull();
    expect(await resolveAdminSession(db, b.token)).toBeNull();
  });

  // パスワードを変える動機はたいてい「漏れたかもしれない」。
  // 古い券が生き残っていては変えた意味が無い。
  test('changing the password cuts every existing session', async () => {
    const { token } = await createAdminSession(db, userId);
    await setAdminUserPassword(db, userId, 'a-brand-new-password');
    expect(await resolveAdminSession(db, token)).toBeNull();
  }, 30_000);

  test('changing the password clears must_change_password and the lockout', async () => {
    sqlite
      .prepare(
        `UPDATE admin_users SET must_change_password = 1, failed_attempts = 5, locked_until = '2099-01-01' WHERE id = ?`,
      )
      .run(userId);
    await setAdminUserPassword(db, userId, 'a-brand-new-password');

    const user = await getAdminUserByEmail(db, 'ikeda@example.com');
    expect(user!.must_change_password).toBe(0);
    expect(user!.failed_attempts).toBe(0);
    expect(user!.locked_until).toBeNull();
    expect((await authenticateAdminUser(db, 'ikeda@example.com', 'a-brand-new-password')).ok).toBe(
      true,
    );
  }, 30_000);

  test('deactivating a user invalidates their live sessions', async () => {
    const { token } = await createAdminSession(db, userId);
    await deactivateAdminUser(db, userId);
    expect(await resolveAdminSession(db, token)).toBeNull();
  });

  test('purge removes expired rows and keeps live ones', async () => {
    const now = new Date('2026-09-11T10:00:00Z');
    await createAdminSession(db, userId, { ttlSeconds: 60, now });
    const live = await createAdminSession(db, userId, { ttlSeconds: 86400, now });

    await purgeExpiredAdminSessions(db, { now: new Date(now.getTime() + 3600 * 1000) });

    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM admin_sessions`).get() as { n: number };
    expect(count.n).toBe(1);
    expect(await resolveAdminSession(db, live.token, { now })).not.toBeNull();
  });

  test('two sessions never collide', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) tokens.add((await createAdminSession(db, userId)).token);
    expect(tokens.size).toBe(50);
  });
});
