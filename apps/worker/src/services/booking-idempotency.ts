// Idempotency-Key store for booking request POSTs.
// Returns same response for repeated submissions within the TTL window.

export interface SaveIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  status: number;
  body: unknown;
  ttlMinutes: number;
  now: Date;
}

export async function saveIdempotencyResponse(
  db: D1Database,
  params: SaveIdempotencyParams,
): Promise<void> {
  const expires = new Date(params.now.getTime() + params.ttlMinutes * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO booking_idempotency_keys
         (key, line_account_id, friend_id, response_status, response_body, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO NOTHING`,
    )
    .bind(
      params.key,
      params.lineAccountId,
      params.friendId,
      params.status,
      JSON.stringify(params.body),
      expires,
    )
    .run();
}

export interface FindIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  now: Date;
}

// caller(account+friend) と一致した行のみを返す。同じ key を別 caller が使った場合は
// nothing-cached 扱いとし、そちらは新規 INSERT で衝突 (PK重複) して別の handling 経路に流れる。
// global lookup にすると tenant 越しに booking_id が漏れるので必須。
export async function findIdempotencyResponse(
  db: D1Database,
  params: FindIdempotencyParams,
): Promise<{ status: number; body: unknown } | null> {
  const row = await db
    .prepare(
      `SELECT response_status, response_body, expires_at
         FROM booking_idempotency_keys
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(params.key, params.lineAccountId, params.friendId)
    .first<{ response_status: number; response_body: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at) <= params.now) return null;
  return { status: row.response_status, body: JSON.parse(row.response_body) };
}

export async function purgeExpiredIdempotency(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM booking_idempotency_keys WHERE expires_at <= ?`)
    .bind(now.toISOString())
    .run();
  return result.meta?.changes ?? 0;
}
