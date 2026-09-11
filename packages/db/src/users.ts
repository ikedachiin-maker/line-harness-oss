import { jstNow } from './utils.js';
// =============================================================================
// Users — Internal UUID Cross-Account System
// =============================================================================

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  display_name: string | null;
  // どこから来た人か(073)。NULL は出どころ不明(取り込み前からある行)。
  source: string | null;
  source_list: string | null;
  source_label: string | null;
  subscribed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email?: string | null;
  phone?: string | null;
  externalId?: string | null;
  displayName?: string | null;
}

export async function createUser(
  db: D1Database,
  input: CreateUserInput,
): Promise<User> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO users (id, email, phone, external_id, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.email ?? null,
      input.phone ?? null,
      input.externalId ?? null,
      input.displayName ?? null,
      now,
      now,
    )
    .run();

  return (await getUserById(db, id))!;
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<User | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
}

export async function getUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare(`SELECT * FROM users ORDER BY created_at DESC`)
    .all<User>();
  return result.results;
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<User | null> {
  return db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();
}

/**
 * Find-or-create the user behind an email address, and fill in any detail we
 * did not have before.
 *
 * This is the entry point for people who reach us without LINE — a mail-harness
 * subscribe, a UTAGE opt-in — so it has to be safe to call on every event, not
 * just the first. Repeat calls update rather than duplicate.
 *
 * Email is matched case-insensitively by lower-casing on the way in; callers
 * should not pre-normalise. Existing rows written before this helper may hold
 * mixed case, so the lookup falls back to a case-insensitive comparison before
 * deciding to insert.
 *
 * Only absent fields are filled: a display_name typed by the person into a LINE
 * profile is better data than one echoed from a mail form, so an existing value
 * is never overwritten by this path.
 */
export async function upsertUserByEmail(
  db: D1Database,
  input: { email: string; displayName?: string | null; externalId?: string | null },
): Promise<User> {
  const email = input.email.trim().toLowerCase();

  const existing =
    (await getUserByEmail(db, email)) ??
    (await db
      .prepare(`SELECT * FROM users WHERE lower(email) = ? ORDER BY created_at LIMIT 1`)
      .bind(email)
      .first<User>());

  if (!existing) {
    return createUser(db, {
      email,
      displayName: input.displayName ?? null,
      externalId: input.externalId ?? null,
    });
  }

  const patch: UpdateUserInput = {};
  if (!existing.display_name && input.displayName) patch.display_name = input.displayName;
  if (!existing.external_id && input.externalId) patch.external_id = input.externalId;
  if (Object.keys(patch).length === 0) return existing;

  return (await updateUser(db, existing.id, patch)) ?? existing;
}

export async function getUserByPhone(
  db: D1Database,
  phone: string,
): Promise<User | null> {
  return db
    .prepare(`SELECT * FROM users WHERE phone = ?`)
    .bind(phone)
    .first<User>();
}

export type UpdateUserInput = Partial<
  Pick<User, 'email' | 'phone' | 'external_id' | 'display_name'>
>;

export async function updateUser(
  db: D1Database,
  id: string,
  updates: UpdateUserInput,
): Promise<User | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.phone !== undefined) {
    fields.push('phone = ?');
    values.push(updates.phone);
  }
  if (updates.external_id !== undefined) {
    fields.push('external_id = ?');
    values.push(updates.external_id);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }

  if (fields.length === 0) return getUserById(db, id);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getUserById(db, id);
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
}

export async function linkFriendToUser(
  db: D1Database,
  friendId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE friends SET user_id = ?, updated_at = ? WHERE id = ?`)
    .bind(userId, jstNow(), friendId)
    .run();
}

export async function getUserFriends(
  db: D1Database,
  userId: string,
): Promise<{ id: string; line_user_id: string; display_name: string | null; is_following: number }[]> {
  const result = await db
    .prepare(`SELECT id, line_user_id, display_name, is_following FROM friends WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string; line_user_id: string; display_name: string | null; is_following: number }>();
  return result.results;
}

// =============================================================================
// Bulk upsert — 名簿の取り込み用
// =============================================================================

export interface BulkSubscriberInput {
  email: string;
  displayName?: string | null;
  externalId?: string | null;
  source: string;
  sourceList?: string | null;
  sourceLabel?: string | null;
  subscribedAt?: string | null;
}

export interface BulkUpsertResult {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * email をキーに何件でも upsert する。UTAGE の読者 13,000 人を取り込むための口。
 *
 * 1件ずつ upsertUserByEmail を回すと 13,000 往復になるので、まず既存の email を
 * まとめて引き、無いものは INSERT、あるものは空いている列だけ UPDATE を
 * D1 の batch に積む。**既に入っている値は上書きしない**(display_name / external_id /
 * source 系が埋まっていればそのまま)。取り込みは影であって正本ではないので、
 * こちらで消したり書き換えたりしない。
 *
 * 同じ email が入力内に2回あれば後の行は skipped。冪等なので何度流しても行は増えない。
 */
export async function bulkUpsertUsersByEmail(
  db: D1Database,
  rows: BulkSubscriberInput[],
): Promise<BulkUpsertResult> {
  const result: BulkUpsertResult = { created: 0, updated: 0, skipped: 0 };
  const seen = new Set<string>();
  const clean: BulkSubscriberInput[] = [];
  for (const r of rows) {
    const email = String(r.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) { result.skipped++; continue; }
    seen.add(email);
    clean.push({ ...r, email });
  }
  if (clean.length === 0) return result;

  // 既存を引く。IN の要素数に上限があるので 100 ずつ
  const existing = new Map<string, User>();
  for (let i = 0; i < clean.length; i += 100) {
    const slice = clean.slice(i, i + 100);
    const placeholders = slice.map(() => '?').join(',');
    const res = await db
      .prepare(`SELECT * FROM users WHERE lower(email) IN (${placeholders})`)
      .bind(...slice.map((r) => r.email))
      .all<User>();
    for (const u of res.results ?? []) {
      const key = (u.email ?? '').toLowerCase();
      // 同じ email が既に2行あるときは古いほうを採用(upsertUserByEmail と同じ)
      if (!existing.has(key)) existing.set(key, u);
    }
  }

  const now = jstNow();
  const stmts: D1PreparedStatement[] = [];
  for (const r of clean) {
    const cur = existing.get(r.email);
    if (!cur) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO users (id, email, phone, external_id, display_name, source, source_list, source_label, subscribed_at, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(), r.email, r.externalId ?? null, r.displayName ?? null,
            r.source, r.sourceList ?? null, r.sourceLabel ?? null, r.subscribedAt ?? null, now, now,
          ),
      );
      result.created++;
      continue;
    }
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (!cur.display_name && r.displayName) { sets.push('display_name = ?'); binds.push(r.displayName); }
    if (!cur.external_id && r.externalId) { sets.push('external_id = ?'); binds.push(r.externalId); }
    if (!cur.source) {
      sets.push('source = ?', 'source_list = ?', 'source_label = ?');
      binds.push(r.source, r.sourceList ?? null, r.sourceLabel ?? null);
    }
    if (!cur.subscribed_at && r.subscribedAt) { sets.push('subscribed_at = ?'); binds.push(r.subscribedAt); }
    if (sets.length === 0) { result.skipped++; continue; }
    sets.push('updated_at = ?'); binds.push(now, cur.id);
    stmts.push(db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds));
    result.updated++;
  }

  // D1 の batch は1回に積める数に上限があるので 100 ずつ
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return result;
}
