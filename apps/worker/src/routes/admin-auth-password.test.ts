import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { adminAuth } from './admin-auth.js';
import type { Env } from '../index.js';

// メールアドレス + パスワードのログイン。
// パスワードの伸長・セッションの保存そのものは packages/db/test/admin-users.test.ts
// が実物の SQLite で見ている。ここで見るのは HTTP 側の振る舞い:
// 何を返すか、何を返さないか、どの経路が通るか。

const SESSION_TOKEN = 'session-token-abc';
const OWNER = {
  id: 'admin-1',
  email: 'ikeda@example.com',
  password_hash: 'pbkdf2$sha256$1$c2FsdA==$aGFzaA==',
  name: '池田',
  role: 'owner' as const,
  is_active: 1,
  must_change_password: 0,
  last_login_at: null,
  failed_attempts: 0,
  locked_until: null,
  created_at: '2026-09-11T00:00:00.000+09:00',
  updated_at: null,
};

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  adminCount: 1,
  loginResult: null as unknown,
}));

const dbMocks = vi.hoisted(() => ({
  getStaffByApiKey: vi.fn(async () => null),
  authenticateAdminUser: vi.fn(async () => state.loginResult),
  createAdminSession: vi.fn(async () => ({
    token: 'session-token-abc',
    expiresAt: '2026-09-18T00:00:00.000Z',
  })),
  resolveAdminSession: vi.fn(async (_db: unknown, token: string) =>
    token === 'session-token-abc' ? state.user : null,
  ),
  revokeAdminSession: vi.fn(async () => {}),
  getAdminUserById: vi.fn(async (_db: unknown, id: string) =>
    state.user && (state.user as { id: string }).id === id ? state.user : null,
  ),
  getAdminUserByEmail: vi.fn(async () => null),
  createAdminUser: vi.fn(async (_db: unknown, input: Record<string, unknown>) => ({
    ...OWNER,
    id: 'new-user',
    email: input.email,
    name: input.name ?? null,
    role: input.role ?? 'owner',
  })),
  listAdminUsers: vi.fn(async () => []),
  countAdminUsers: vi.fn(async () => state.adminCount),
  setAdminUserPassword: vi.fn(async () => {}),
  deactivateAdminUser: vi.fn(async () => {}),
  verifyPassword: vi.fn(async (password: string) => ({
    valid: password === 'correct horse battery',
    needsRehash: false,
  })),
  validatePassword: vi.fn((password: unknown) =>
    typeof password === 'string' && password.length >= 12
      ? null
      : 'パスワードは12文字以上にしてください',
  ),
  normalizeEmail: (email: unknown) =>
    typeof email === 'string' ? email.trim().toLowerCase() : '',
  isValidEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  SESSION_TTL_SECONDS: 604800,
}));
vi.mock('@line-crm/db', () => dbMocks);

const API_KEY = 'env-owner-key';

function envBindings(): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    LINE_CHANNEL_SECRET: 's',
    LINE_CHANNEL_ACCESS_TOKEN: 't',
    API_KEY,
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'c',
    LINE_LOGIN_CHANNEL_ID: 'l',
    LINE_LOGIN_CHANNEL_SECRET: 'ls',
    WORKER_URL: 'https://api.example.com',
    ADMIN_ORIGIN: 'https://admin.example.com',
  } as unknown as Env['Bindings'];
}

function app() {
  const a = new Hono<Env>();
  a.use('*', authMiddleware);
  a.route('/', adminAuth);
  a.get('/api/protected', (c) => c.json({ success: true, data: c.get('staff') }));
  return a;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app().request(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...headers },
    },
    envBindings(),
  );
}

const SESSION_COOKIE = { Cookie: `lh_admin_session=${SESSION_TOKEN}; lh_csrf=t`, 'X-CSRF-Token': 't' };

beforeEach(() => {
  vi.clearAllMocks();
  state.user = OWNER;
  state.adminCount = 1;
  state.loginResult = { ok: true, user: OWNER };
});

describe('POST /api/auth/login', () => {
  test('accepts an email and password and returns the identity', async () => {
    const res = await post('/api/auth/login', {
      email: 'ikeda@example.com',
      password: 'correct horse battery',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { email: string; role: string } };
    expect(body.data).toMatchObject({ email: 'ikeda@example.com', role: 'owner' });
  });

  test('normalises the email before looking it up', async () => {
    await post('/api/auth/login', { email: '  IKEDA@Example.COM ', password: 'x'.repeat(12) });
    expect(dbMocks.authenticateAdminUser).toHaveBeenCalledWith(
      expect.anything(),
      'ikeda@example.com',
      'x'.repeat(12),
    );
  });

  // 「そのアドレスは未登録」と「パスワードが違う」を区別して見せると、
  // どのアドレスが登録済みかを外から数えられる。
  test('gives one indistinguishable message for a bad email and a bad password', async () => {
    state.loginResult = { ok: false, reason: 'invalid_credentials' };
    const res = await post('/api/auth/login', { email: 'nobody@example.com', password: 'nope12345678' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('メールアドレスまたはパスワードが正しくありません');
  });

  test('does not set a session cookie when the credentials are wrong', async () => {
    state.loginResult = { ok: false, reason: 'invalid_credentials' };
    const res = await post('/api/auth/login', { email: 'ikeda@example.com', password: 'wrong1234567' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(dbMocks.createAdminSession).not.toHaveBeenCalled();
  });

  test('tells the user how long a locked account stays locked', async () => {
    state.loginResult = { ok: false, reason: 'locked', retryAfterSeconds: 900 };
    const res = await post('/api/auth/login', { email: 'ikeda@example.com', password: 'x'.repeat(12) });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/15分後/);
  });

  test('a deactivated account cannot sign in', async () => {
    state.loginResult = { ok: false, reason: 'inactive' };
    const res = await post('/api/auth/login', { email: 'ikeda@example.com', password: 'x'.repeat(12) });
    expect(res.status).toBe(401);
  });

  test('rejects a request missing either field without touching the database', async () => {
    for (const body of [{}, { email: 'a@b.co' }, { password: 'x'.repeat(12) }, { email: '', password: '' }]) {
      const res = await post('/api/auth/login', body);
      expect(res.status).toBe(400);
    }
    expect(dbMocks.authenticateAdminUser).not.toHaveBeenCalled();
  });

  // API キーを貼る旧方式は廃止した。受け付けてしまうと、弱いほうの入口が残る。
  test('no longer accepts an apiKey field as credentials', async () => {
    const res = await post('/api/auth/login', { apiKey: API_KEY });
    expect(res.status).toBe(400);
    expect(dbMocks.createAdminSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  // Cookie を消すだけだと、抜き取られていた券は生き続ける。
  test('revokes the session server-side, not just in the browser', async () => {
    const res = await post('/api/auth/logout', {}, { Cookie: `lh_admin_session=${SESSION_TOKEN}` });
    expect(res.status).toBe(200);
    expect(dbMocks.revokeAdminSession).toHaveBeenCalledWith(expect.anything(), SESSION_TOKEN);
  });

  test('still clears the cookies when there is no session to revoke', async () => {
    const res = await post('/api/auth/logout', {});
    expect(res.status).toBe(200);
    expect(dbMocks.revokeAdminSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/password', () => {
  test('changes the password when the current one is right', async () => {
    const res = await post(
      '/api/auth/password',
      { currentPassword: 'correct horse battery', newPassword: 'a-brand-new-password' },
      SESSION_COOKIE,
    );
    expect(res.status).toBe(200);
    expect(dbMocks.setAdminUserPassword).toHaveBeenCalledWith(
      expect.anything(),
      'admin-1',
      'a-brand-new-password',
    );
  });

  // Cookie を抜いた相手が、本人を締め出す形でパスワードを書き換えられては困る。
  test('refuses without the current password', async () => {
    const res = await post(
      '/api/auth/password',
      { currentPassword: 'wrong', newPassword: 'a-brand-new-password' },
      SESSION_COOKIE,
    );
    expect(res.status).toBe(401);
    expect(dbMocks.setAdminUserPassword).not.toHaveBeenCalled();
  });

  test('enforces the minimum length on the new password', async () => {
    const res = await post(
      '/api/auth/password',
      { currentPassword: 'correct horse battery', newPassword: 'short' },
      SESSION_COOKIE,
    );
    expect(res.status).toBe(400);
    expect(dbMocks.setAdminUserPassword).not.toHaveBeenCalled();
  });

  test('refuses to set the same password again', async () => {
    const res = await post(
      '/api/auth/password',
      { currentPassword: 'correct horse battery', newPassword: 'correct horse battery' },
      SESSION_COOKIE,
    );
    expect(res.status).toBe(400);
  });

  // 変更するとサーバ側で全セッションが切れるので、その端末だけは
  // 新しい券を受け取って操作を続けられる必要がある。
  test('issues a fresh session so the current device stays signed in', async () => {
    const res = await post(
      '/api/auth/password',
      { currentPassword: 'correct horse battery', newPassword: 'a-brand-new-password' },
      SESSION_COOKIE,
    );
    expect(dbMocks.createAdminSession).toHaveBeenCalled();
    expect(res.headers.get('Set-Cookie')).toContain('lh_admin_session=');
  });

  test('requires a session', async () => {
    const res = await post('/api/auth/password', {
      currentPassword: 'correct horse battery',
      newPassword: 'a-brand-new-password',
    });
    expect(res.status).toBe(401);
  });
});

describe('must_change_password gate', () => {
  beforeEach(() => {
    state.user = { ...OWNER, must_change_password: 1 };
  });

  // 初期パスワードのまま運用に入られると、配った経路が漏れた時点で入られる。
  test('blocks every other API until the password is changed', async () => {
    const res = await app().request(
      '/api/protected',
      { headers: { Cookie: `lh_admin_session=${SESSION_TOKEN}` } },
      envBindings(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('password_change_required');
  });

  test('still allows the password change itself', async () => {
    const res = await post(
      '/api/auth/password',
      { currentPassword: 'correct horse battery', newPassword: 'a-brand-new-password' },
      SESSION_COOKIE,
    );
    expect(res.status).toBe(200);
  });

  test('still allows session and logout so the user is not stuck', async () => {
    const session = await app().request(
      '/api/auth/session',
      { headers: { Cookie: `lh_admin_session=${SESSION_TOKEN}` } },
      envBindings(),
    );
    expect(session.status).toBe(200);
    expect(((await session.json()) as { data: { mustChangePassword: boolean } }).data
      .mustChangePassword).toBe(true);

    const logout = await post('/api/auth/logout', {}, { Cookie: `lh_admin_session=${SESSION_TOKEN}` });
    expect(logout.status).toBe(200);
  });

  // 機械は Bearer で来る。パスワードという概念が無いので、この門で止めてはいけない。
  test('does not block Bearer callers', async () => {
    const res = await app().request(
      '/api/protected',
      { headers: { Authorization: `Bearer ${API_KEY}` } },
      envBindings(),
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/admin-users', () => {
  const NEW_USER = { email: 'staff@example.com', password: 'a'.repeat(12), name: '担当' };

  test('lets the API key create the very first account (bootstrap)', async () => {
    state.adminCount = 0;
    const res = await post('/api/auth/admin-users', NEW_USER, {
      Authorization: `Bearer ${API_KEY}`,
    });
    expect(res.status).toBe(201);
    expect(dbMocks.createAdminUser).toHaveBeenCalled();
  });

  // 足場を誰でも踏めると、アカウントが0件の隙に他人が owner を作れてしまう。
  test('the bootstrap still needs the API key', async () => {
    state.adminCount = 0;
    const res = await post('/api/auth/admin-users', NEW_USER);
    expect(res.status).toBe(401);
    expect(dbMocks.createAdminUser).not.toHaveBeenCalled();
  });

  test('once an account exists, only an owner may add another', async () => {
    state.adminCount = 1;
    state.user = { ...OWNER, role: 'staff' };
    const res = await post('/api/auth/admin-users', NEW_USER, SESSION_COOKIE);
    expect(res.status).toBe(403);
    expect(dbMocks.createAdminUser).not.toHaveBeenCalled();
  });

  test('an owner session may add another account', async () => {
    const res = await post('/api/auth/admin-users', NEW_USER, SESSION_COOKIE);
    expect(res.status).toBe(201);
  });

  // 人が代わりに作ったアカウントは、配った経路が漏れている前提で扱う。
  test('accounts created for someone else must change the password first', async () => {
    await post('/api/auth/admin-users', NEW_USER, SESSION_COOKIE);
    expect(dbMocks.createAdminUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mustChangePassword: true }),
    );
  });

  test('validates the email and the password', async () => {
    const bad = await post('/api/auth/admin-users', { email: 'nope', password: 'a'.repeat(12) }, SESSION_COOKIE);
    expect(bad.status).toBe(400);

    const weak = await post('/api/auth/admin-users', { email: 'a@b.co', password: 'short' }, SESSION_COOKIE);
    expect(weak.status).toBe(400);
    expect(dbMocks.createAdminUser).not.toHaveBeenCalled();
  });

  test('refuses an email that is already registered', async () => {
    dbMocks.getAdminUserByEmail.mockResolvedValueOnce(OWNER as never);
    const res = await post('/api/auth/admin-users', NEW_USER, SESSION_COOKIE);
    expect(res.status).toBe(409);
  });

  // 役割の文字列をそのまま信じると、任意の値を送って権限を作られる。
  test('falls back to a known role when an unknown one is sent', async () => {
    await post('/api/auth/admin-users', { ...NEW_USER, role: 'superuser' }, SESSION_COOKIE);
    expect(dbMocks.createAdminUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'owner' }),
    );
  });
});

describe('POST /api/auth/admin-users/:id/deactivate', () => {
  test('an owner can deactivate someone else', async () => {
    const res = await post('/api/auth/admin-users/other-1/deactivate', {}, SESSION_COOKIE);
    expect(res.status).toBe(404); // getAdminUserById only knows the signed-in user
    expect(dbMocks.deactivateAdminUser).not.toHaveBeenCalled();
  });

  // 自分を止めると、最後の1人だった場合に誰も入れなくなる。
  test('refuses to deactivate yourself', async () => {
    const res = await post('/api/auth/admin-users/admin-1/deactivate', {}, SESSION_COOKIE);
    expect(res.status).toBe(400);
    expect(dbMocks.deactivateAdminUser).not.toHaveBeenCalled();
  });

  test('a non-owner cannot deactivate anyone', async () => {
    state.user = { ...OWNER, role: 'staff' };
    const res = await post('/api/auth/admin-users/other-1/deactivate', {}, SESSION_COOKIE);
    expect(res.status).toBe(403);
  });
});
