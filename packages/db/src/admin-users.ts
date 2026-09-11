import { jstNow } from './utils.js';

// =============================================================================
// Admin users — 管理画面のメールアドレス + パスワードログイン
// =============================================================================
//
// ここが扱うのは **ブラウザからのログインだけ**。SDK / MCP / ハーネス間の
// ポーリングなど機械の認証は Authorization: Bearer <API キー> のままで、
// このモジュールは一切関与しない。
//
// 設計の要点:
//   - パスワードは PBKDF2-SHA256 で伸ばして保存する。Workers で使える中で
//     まともな選択肢はこれ (bcrypt/argon2 は WASM を積まないと動かない)
//   - セッションCookie に入れるのはランダムな入場券で、API キーではない。
//     DB には券の SHA-256 だけを置くので、DB が漏れてもログインは作れない
//   - 比較は必ず定数時間で行う。早期 return は「どこまで一致したか」を
//     応答時間として漏らす
//
// 経緯は migrations/072_admin_password_login.sql

const encoder = new TextEncoder();

/**
 * **Cloudflare 本番の PBKDF2 は 100,000 回で打ち止め。**
 * 超えると NotSupportedError:
 *   "Pbkdf2 failed: iteration counts above 100000 are not supported"
 *
 * ⚠ `wrangler dev --local` はこの制限を課さない。手元では 1,000,000 回でも
 *   通ってしまうので、**ローカルで測った値をそのまま本番に持っていくと落ちる**
 *   (2026-09-11 に実際に踏んだ)。
 *
 * OWASP が PBKDF2-HMAC-SHA256 に求める 600,000 回には1回では届かないので、
 * 100,000 回の導出を鎖状に繰り返して work factor を積む。
 *
 *   h1 = PBKDF2(password, salt, 100k)
 *   h2 = PBKDF2(h1,       salt, 100k)   … これを ROUNDS 回
 *
 * 各呼び出しが上限以下なので本番でも通り、総計算量は掛け算で効く。
 * 新しい構成を発明しているわけではなく、PBKDF2 が内部でやっている反復を
 * 外側で足しているだけ。
 */
export const PBKDF2_ITERATIONS_PER_ROUND = 100_000;
export const PBKDF2_ROUNDS = 6;

/** 実効の反復回数 (表示・比較用)。 */
export const PBKDF2_ITERATIONS = PBKDF2_ITERATIONS_PER_ROUND * PBKDF2_ROUNDS;

const SALT_BYTES = 16;
const KEY_BITS = 256;
const SESSION_TOKEN_BYTES = 32;

/** セッションの有効期間。従来の localStorage 相当に合わせて7日。 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 何回続けて失敗したら締めるか、どれだけ締めるか。 */
export const MAX_FAILED_ATTEMPTS = 8;
export const LOCKOUT_SECONDS = 15 * 60;

/** パスワードの最低長。長さだけを課し、文字種は課さない (長さのほうが効く)。 */
export const MIN_PASSWORD_LENGTH = 12;

export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: 'owner' | 'admin' | 'staff';
  is_active: number;
  must_change_password: number;
  last_login_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string | null;
}

// ── エンコード ───────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 定数時間比較。
 *
 * 長さが違う時点で false を返すのは避けられない (長さ自体は秘密ではない)。
 * 中身の比較では、不一致を見つけても最後まで回す。
 */
function timingSafeEqual(a: string, b: string): boolean {
  const A = encoder.encode(a);
  const B = encoder.encode(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

// ── パスワード ───────────────────────────────────────────────────────────────

async function deriveOnce(
  material: BufferSource,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * 100,000 回の導出を rounds 回つないで伸ばす。上の定数のコメント参照。
 * 1回目だけパスワードを材料にし、以降は前段の出力を材料にする。
 */
async function derive(
  password: string,
  salt: Uint8Array,
  iterationsPerRound: number,
  rounds: number,
): Promise<string> {
  let material: BufferSource = encoder.encode(password);
  for (let i = 0; i < rounds; i++) {
    material = await deriveOnce(material, salt, iterationsPerRound);
  }
  return toBase64(material as Uint8Array);
}

/**
 * 保存形式: `pbkdf2$sha256$<iterationsPerRound>$<rounds>$<salt_b64>$<hash_b64>`
 *
 * アルゴリズムと計算量を値の中に書いておく。こうしておくと、あとで強度を
 * 上げても既存の行をその場で検証でき、全員のパスワードを再設定させずに済む。
 */
export async function hashPassword(
  password: string,
  opts: { iterationsPerRound?: number; rounds?: number } = {},
): Promise<string> {
  const iterationsPerRound = opts.iterationsPerRound ?? PBKDF2_ITERATIONS_PER_ROUND;
  const rounds = opts.rounds ?? PBKDF2_ROUNDS;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterationsPerRound, rounds);
  return `pbkdf2$sha256$${iterationsPerRound}$${rounds}$${toBase64(salt)}$${hash}`;
}

export interface PasswordVerification {
  valid: boolean;
  /** 保存時の回数が現行より少ない。成功したら新しい回数で入れ直すべき。 */
  needsRehash: boolean;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<PasswordVerification> {
  const parts = String(stored ?? '').split('$');
  if (parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return { valid: false, needsRehash: false };
  }

  // 5列は rounds を持たなかった頃の形。rounds=1 として読む。
  const legacy = parts.length === 5;
  if (!legacy && parts.length !== 6) return { valid: false, needsRehash: false };

  const iterationsPerRound = Number(parts[2]);
  const rounds = legacy ? 1 : Number(parts[3]);
  const saltB64 = legacy ? parts[3] : parts[4];
  const expected = legacy ? parts[4] : parts[5];

  if (
    !Number.isInteger(iterationsPerRound) || iterationsPerRound < 1
    || !Number.isInteger(rounds) || rounds < 1 || rounds > 32
  ) {
    return { valid: false, needsRehash: false };
  }

  // 本番は 100,000 回を超える導出を拒む。そういう値が入っている行は
  // この環境では検証しようが無いので、例外ではなく不一致として返す
  // (throw すると壊れた行1つでログイン全体が 500 になる)。
  if (iterationsPerRound > PBKDF2_ITERATIONS_PER_ROUND) {
    return { valid: false, needsRehash: false };
  }

  let salt: Uint8Array;
  try {
    salt = fromBase64(saltB64);
  } catch {
    return { valid: false, needsRehash: false };
  }

  let candidate: string;
  try {
    candidate = await derive(password, salt, iterationsPerRound, rounds);
  } catch {
    // 実行環境が拒む組み合わせ。落とさずに不一致扱いにする。
    return { valid: false, needsRehash: false };
  }

  return {
    valid: timingSafeEqual(candidate, expected),
    needsRehash: iterationsPerRound * rounds < PBKDF2_ITERATIONS,
  };
}

/**
 * パスワードの最低条件。
 *
 * 文字種の強制はしない。記号を混ぜろという規則は、かえって短くて推測しやすい
 * 語を選ばせる。長さだけを課す。
 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'パスワードを入力してください';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  }
  if (password.length > 200) return 'パスワードが長すぎます';
  return null;
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function countAdminUsers(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM admin_users WHERE is_active = 1`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getAdminUserByEmail(
  db: D1Database,
  email: string,
): Promise<AdminUser | null> {
  return db
    .prepare(`SELECT * FROM admin_users WHERE lower(email) = ?`)
    .bind(normalizeEmail(email))
    .first<AdminUser>();
}

export async function getAdminUserById(db: D1Database, id: string): Promise<AdminUser | null> {
  return db.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(id).first<AdminUser>();
}

export interface CreateAdminUserInput {
  email: string;
  password: string;
  name?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  mustChangePassword?: boolean;
}

export async function createAdminUser(
  db: D1Database,
  input: CreateAdminUserInput,
): Promise<AdminUser> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO admin_users
         (id, email, password_hash, name, role, is_active, must_change_password,
          failed_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      normalizeEmail(input.email),
      await hashPassword(input.password),
      input.name ?? null,
      input.role ?? 'owner',
      input.mustChangePassword ? 1 : 0,
      now,
      now,
    )
    .run();

  return (await getAdminUserById(db, id))!;
}

export async function listAdminUsers(
  db: D1Database,
): Promise<Omit<AdminUser, 'password_hash'>[]> {
  const result = await db
    .prepare(
      `SELECT id, email, name, role, is_active, must_change_password,
              last_login_at, failed_attempts, locked_until, created_at, updated_at
         FROM admin_users ORDER BY created_at`,
    )
    .all<Omit<AdminUser, 'password_hash'>>();
  return result.results;
}

/**
 * パスワードを差し替える。
 *
 * 差し替えたら **その人の既存セッションを全部切る**。パスワードを変える動機は
 * たいてい「漏れたかもしれない」なので、古い入場券が生き残っていては意味が無い。
 * 呼び出し側は、変更した本人の端末だけ入り直させればよい。
 */
export async function setAdminUserPassword(
  db: D1Database,
  userId: string,
  password: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE admin_users
          SET password_hash = ?, must_change_password = 0,
              failed_attempts = 0, locked_until = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(await hashPassword(password), jstNow(), userId)
    .run();

  await revokeAllSessionsForUser(db, userId);
}

export async function deactivateAdminUser(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`UPDATE admin_users SET is_active = 0, updated_at = ? WHERE id = ?`)
    .bind(jstNow(), userId)
    .run();
  await revokeAllSessionsForUser(db, userId);
}

// ── ログイン ─────────────────────────────────────────────────────────────────

/**
 * 未登録のアドレスで来たときに検証するダミー。
 *
 * どのパスワードとも一致しない値を、本番と同じ計算量で事前に作って埋めてある。
 * 秘密ではない (一致する入力が存在しないため) が、現行の計算量と揃えておく
 * 必要はある。揃っていないと応答時間の差で未登録かどうかが読めてしまう。
 */
const DUMMY_HASH =
  'pbkdf2$sha256$100000$6$j1FzRjtIQ6kp/NDIqvwtiA==$NoFC2PQ088oVpE6P+M9NbNfqJFRSF2bAKYjoeLj6qC8=';

export type LoginFailure =
  | 'invalid_credentials'
  | 'locked'
  | 'inactive';

export type LoginResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: LoginFailure; retryAfterSeconds?: number };

function secondsUntil(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / 1000));
}

/**
 * メールアドレスとパスワードを照合する。
 *
 * 失敗の理由を呼び出し側には返すが、**画面には出さない**こと。
 * 「そのメールアドレスは存在しない」と「パスワードが違う」を区別して見せると、
 * どのアドレスが登録済みかを外から数えられる。
 *
 * 存在しないアドレスでも同じだけ時間を使う (ダミーのハッシュを1回検証する)。
 * 早く返すと、応答時間だけで登録済みかどうかが分かってしまう。
 */
export async function authenticateAdminUser(
  db: D1Database,
  email: string,
  password: string,
  opts: { now?: Date } = {},
): Promise<LoginResult> {
  const now = opts.now ?? new Date();
  const user = await getAdminUserByEmail(db, email);

  if (!user) {
    // タイミングを揃えるためのダミー検証。結果は使わない。
    //
    // ここで hashPassword を呼ぶと、存在しないアドレスのほうが **存在する場合の
    // 倍** 計算することになる (ハッシュ生成 + 検証)。遅いほうが未登録だと
    // 分かってしまっては逆効果だし、CPU も2倍要る。
    // 固定のダミー値を検証するだけにして、どちらの経路も「検証1回」に揃える。
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (!user.is_active) return { ok: false, reason: 'inactive' };

  if (user.locked_until && Date.parse(user.locked_until) > now.getTime()) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterSeconds: secondsUntil(user.locked_until, now),
    };
  }

  const { valid, needsRehash } = await verifyPassword(password, user.password_hash);

  if (!valid) {
    const attempts = user.failed_attempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCKOUT_SECONDS * 1000).toISOString()
        : null;
    await db
      .prepare(`UPDATE admin_users SET failed_attempts = ?, locked_until = ? WHERE id = ?`)
      .bind(attempts, lockedUntil, user.id)
      .run();
    return { ok: false, reason: 'invalid_credentials' };
  }

  // 成功したら失敗回数を落とす。回数を上げた場合はここで入れ直す。
  const rehashed = needsRehash ? await hashPassword(password) : null;
  await db
    .prepare(
      `UPDATE admin_users
          SET failed_attempts = 0, locked_until = NULL, last_login_at = ?,
              password_hash = COALESCE(?, password_hash)
        WHERE id = ?`,
    )
    .bind(jstNow(), rehashed, user.id)
    .run();

  return { ok: true, user: { ...user, failed_attempts: 0, locked_until: null } };
}

// ── セッション ───────────────────────────────────────────────────────────────

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CreatedSession {
  /** Cookie に入れる値。**これ以降どこにも保存されない** (DB にはハッシュだけ)。 */
  token: string;
  expiresAt: string;
}

export async function createAdminSession(
  db: D1Database,
  userId: string,
  opts: { ttlSeconds?: number; userAgent?: string | null; now?: Date } = {},
): Promise<CreatedSession> {
  const now = opts.now ?? new Date();
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES)));
  const expiresAt = new Date(
    now.getTime() + (opts.ttlSeconds ?? SESSION_TTL_SECONDS) * 1000,
  ).toISOString();

  await db
    .prepare(
      `INSERT INTO admin_sessions (token_hash, admin_user_id, created_at, expires_at, last_seen_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(token),
      userId,
      now.toISOString(),
      expiresAt,
      now.toISOString(),
      opts.userAgent?.slice(0, 500) ?? null,
    )
    .run();

  return { token, expiresAt };
}

/**
 * Cookie の値から利用者を引く。期限切れ・失効済み・無効化された利用者は null。
 *
 * last_seen_at は書き込むが、**期限は延ばさない**。延ばすと、使い続ける限り
 * セッションが永久に切れなくなる。7日で必ず入り直す。
 */
export async function resolveAdminSession(
  db: D1Database,
  token: string,
  opts: { now?: Date } = {},
): Promise<AdminUser | null> {
  if (!token) return null;
  const now = opts.now ?? new Date();

  const row = await db
    .prepare(
      `SELECT u.* FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    )
    .bind(await sha256Hex(token), now.toISOString())
    .first<AdminUser>();

  if (!row) return null;

  await db
    .prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?`)
    .bind(now.toISOString(), await sha256Hex(token))
    .run();

  return row;
}

export async function revokeAdminSession(db: D1Database, token: string): Promise<void> {
  if (!token) return;
  await db
    .prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`)
    .bind(await sha256Hex(token))
    .run();
}

export async function revokeAllSessionsForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM admin_sessions WHERE admin_user_id = ?`).bind(userId).run();
}

/** 期限切れの掃除。cron から呼ぶ。 */
export async function purgeExpiredAdminSessions(
  db: D1Database,
  opts: { now?: Date } = {},
): Promise<void> {
  await db
    .prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`)
    .bind((opts.now ?? new Date()).toISOString())
    .run();
}
