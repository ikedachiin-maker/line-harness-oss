import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  authenticateAdminUser,
  createAdminSession,
  revokeAdminSession,
  createAdminUser,
  listAdminUsers,
  countAdminUsers,
  getAdminUserById,
  getAdminUserByEmail,
  setAdminUserPassword,
  deactivateAdminUser,
  verifyPassword,
  validatePassword,
  normalizeEmail,
  isValidEmail,
  SESSION_TTL_SECONDS,
} from '@line-crm/db';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  adminSessionCookie,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';

/**
 * 管理画面のログイン。**メールアドレス + パスワード**。
 *
 * 機械の認証 (SDK / MCP / ハーネス間ポーリング / 集計スクリプト) は
 * Authorization: Bearer <API キー> のままで、ここは通らない。
 *
 * env の API キーは break-glass として残してある。パスワードを失っても
 * ロックアウトされないため、そして最初の1人を作る足場として要るため。
 */
export const adminAuth = new Hono<Env>();

function cookieFrom(c: { req: { header: (n: string) => string | undefined } }): string | null {
  const header = c.req.header('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ADMIN_AUTH_COOKIE) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}

/**
 * POST /api/auth/login — { email, password }
 *
 * 成功したら:
 *   lh_admin_session (HttpOnly) … ランダムな入場券。JS からは読めない
 *   lh_csrf (読める)            … double-submit 用。別サイトの SPA は API 側の
 *                                 Cookie を読めないので、本文でも返して
 *                                 X-CSRF-Token ヘッダで返させる
 */
adminAuth.post('/api/auth/login', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error('[admin-auth] refused login — misconfigured topology:', config.misconfigured);
    return c.json({ success: false, error: config.misconfigured }, 500);
  }

  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({}) as { email?: string; password?: string });

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return c.json({ success: false, error: 'メールアドレスとパスワードを入力してください' }, 400);
  }

  const result = await authenticateAdminUser(c.env.DB, email, password);

  if (!result.ok) {
    // 締めている間だけは理由を返す。待てば入れると分かったほうが親切で、
    // 「締まっている」こと自体は当ててきた相手にはどのみち分かる。
    if (result.reason === 'locked') {
      const minutes = Math.ceil((result.retryAfterSeconds ?? 0) / 60);
      return c.json(
        {
          success: false,
          error: `ログインの失敗が続いたため一時的に停止しています。約${minutes}分後にもう一度お試しください`,
        },
        429,
      );
    }
    // それ以外は理由を区別して見せない。「そのアドレスは未登録」と
    // 「パスワードが違う」を分けると、登録済みのアドレスを外から数えられる。
    return c.json(
      { success: false, error: 'メールアドレスまたはパスワードが正しくありません' },
      401,
    );
  }

  const { token, expiresAt } = await createAdminSession(c.env.DB, result.user.id, {
    ttlSeconds: SESSION_TTL_SECONDS,
    userAgent: c.req.header('User-Agent') ?? null,
  });

  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', adminSessionCookie(token, config.sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });

  return c.json({
    success: true,
    data: {
      id: result.user.id,
      name: result.user.name ?? result.user.email,
      email: result.user.email,
      role: result.user.role,
      mustChangePassword: result.user.must_change_password === 1,
      expiresAt,
    },
    csrfToken,
  });
});

/**
 * POST /api/auth/logout — Cookie を消し、**サーバ側の券も失効させる**。
 *
 * Cookie を消すだけだと、抜き取られていた券は生き続ける。
 * CSRF は要求しない。自分のログインを切るのは攻撃の役に立たないし、
 * トークンを失った状態でも出られるようにしておきたい。
 */
adminAuth.post('/api/auth/logout', async (c) => {
  const { sameSite } = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  const token = cookieFrom(c);
  if (token) await revokeAdminSession(c.env.DB, token);

  c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
  c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
  return c.json({ success: true, data: null });
});

/**
 * GET /api/auth/session — いまログインしている人と CSRF トークン。
 *
 * リロードで CSRF トークンを失っても、ここで拾い直せる (再ログイン不要)。
 */
adminAuth.get('/api/auth/session', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  let csrfToken = csrfTokenFromCookie(c);
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  }

  const staff = c.get('staff');
  // 初期パスワードのままなら、画面が変更フォームへ誘導できるように伝える。
  let mustChangePassword = false;
  if (staff) {
    const user = await getAdminUserById(c.env.DB, staff.id);
    mustChangePassword = user?.must_change_password === 1;
  }

  return c.json({ success: true, data: { ...staff, mustChangePassword }, csrfToken });
});

/**
 * POST /api/auth/password — 自分のパスワードを変える。
 * { currentPassword, newPassword }
 *
 * 成功すると **自分の既存セッションも全部切れる**。変える動機はたいてい
 * 「漏れたかもしれない」なので、古い券を残さない。その場で新しい券を1枚出して、
 * 操作中の端末だけは続けて使えるようにする。
 */
adminAuth.post('/api/auth/password', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  const staff = c.get('staff');
  if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const user = await getAdminUserById(c.env.DB, staff.id);
  // Bearer の API キーで来た相手にはパスワードが無い。変えるものが無い。
  if (!user) {
    return c.json(
      { success: false, error: 'このログイン方法ではパスワードを変更できません' },
      400,
    );
  }

  const body = await c.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => ({}) as { currentPassword?: string; newPassword?: string });

  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';

  // 現在のパスワードを必ず確かめる。Cookie を抜いた相手が、本人を締め出す形で
  // パスワードを書き換えられるのを防ぐ。
  if (!(await verifyPassword(current, user.password_hash)).valid) {
    return c.json({ success: false, error: '現在のパスワードが正しくありません' }, 401);
  }

  const invalid = validatePassword(next);
  if (invalid) return c.json({ success: false, error: invalid }, 400);
  if (next === current) {
    return c.json({ success: false, error: '現在と違うパスワードにしてください' }, 400);
  }

  await setAdminUserPassword(c.env.DB, user.id, next);

  const { token } = await createAdminSession(c.env.DB, user.id, {
    ttlSeconds: SESSION_TTL_SECONDS,
    userAgent: c.req.header('User-Agent') ?? null,
  });
  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', adminSessionCookie(token, config.sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });

  return c.json({ success: true, data: { id: user.id }, csrfToken });
});

// ── 利用者の管理 ────────────────────────────────────────────────────────────
//
// 作成・停止は owner だけ。ただし **1人もいない間は API キーでも作れる**
// (最初の1人を作る足場。鶏と卵を解く)。

function canManageUsers(c: Context<Env>): boolean {
  // env の API キーで来た相手も authenticateApiToken が owner として返すので、
  // ここは役割だけ見れば足りる。
  return c.get('staff')?.role === 'owner';
}

adminAuth.get('/api/auth/admin-users', async (c) => {
  if (!canManageUsers(c)) return c.json({ success: false, error: 'Forbidden' }, 403);
  return c.json({ success: true, data: await listAdminUsers(c.env.DB) });
});

/**
 * POST /api/auth/admin-users — { email, password, name?, role?, mustChangePassword? }
 *
 * 1人目は API キー (Bearer) で作る。2人目以降は owner のログインが要る。
 */
adminAuth.post('/api/auth/admin-users', async (c) => {
  const existing = await countAdminUsers(c.env.DB);

  if (existing > 0 && !canManageUsers(c)) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  if (existing === 0) {
    // 足場を使えるのは API キーを持っている相手だけ。
    const header = c.req.header('Authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!(await authenticateApiToken(c, bearer))) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
  }

  type CreateBody = {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
    mustChangePassword?: boolean;
  };
  const body: CreateBody = await c.req.json<CreateBody>().catch(() => ({}));

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return c.json({ success: false, error: 'メールアドレスの形式が正しくありません' }, 400);
  }
  const invalid = validatePassword(body.password);
  if (invalid) return c.json({ success: false, error: invalid }, 400);

  if (await getAdminUserByEmail(c.env.DB, email)) {
    return c.json({ success: false, error: 'このメールアドレスは既に登録されています' }, 409);
  }

  const role =
    body.role === 'admin' || body.role === 'staff' || body.role === 'owner' ? body.role : 'owner';

  const user = await createAdminUser(c.env.DB, {
    email,
    password: body.password as string,
    name: body.name ?? null,
    role,
    // 誰かが代わりに作ったアカウントは、初回ログインで必ず変えさせる。
    mustChangePassword: body.mustChangePassword !== false,
  });

  return c.json(
    {
      success: true,
      data: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
    201,
  );
});

/** POST /api/auth/admin-users/:id/deactivate — 停止 (行は消さず、ログインだけ止める)。 */
adminAuth.post('/api/auth/admin-users/:id/deactivate', async (c) => {
  if (!canManageUsers(c)) return c.json({ success: false, error: 'Forbidden' }, 403);

  const id = c.req.param('id');
  const staff = c.get('staff');
  // 自分を止めると誰も入れなくなりうる。
  if (staff && staff.id === id) {
    return c.json({ success: false, error: '自分自身は停止できません' }, 400);
  }
  if (!(await getAdminUserById(c.env.DB, id))) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  await deactivateAdminUser(c.env.DB, id);
  return c.json({ success: true, data: null });
});
