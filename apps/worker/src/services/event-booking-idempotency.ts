// Idempotency-Key store for event booking POSTs.
// Returns same response for repeated submissions within the TTL window.
// Mirrors booking-idempotency.ts pattern but on event_booking_idempotency_keys.
//
// Reservation flow (added to prevent double-tap duplicates):
//   1) Caller invokes reserveEventIdempotency at request start.
//      - 'inserted' → first request, proceed with the booking.
//      - 'cached'   → previous request finished, replay {status, body}.
//      - 'in_progress' → previous request still running, return 429.
//   2) On finish (success or terminal error), caller invokes
//      finalizeEventIdempotencyResponse to overwrite the placeholder row
//      with the real response. Subsequent retries then hit the cached path.

export interface SaveEventIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  status: number;
  body: unknown;
  ttlMinutes: number;
  now: Date;
}

export async function saveEventIdempotencyResponse(
  db: D1Database,
  params: SaveEventIdempotencyParams,
): Promise<void> {
  const expires = new Date(params.now.getTime() + params.ttlMinutes * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO event_booking_idempotency_keys
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

export interface FindEventIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  now: Date;
}

// caller(account+friend) と一致した行のみ返す。tenant 越え露出を防ぐため必須。
export async function findEventIdempotencyResponse(
  db: D1Database,
  params: FindEventIdempotencyParams,
): Promise<{ status: number; body: unknown } | null> {
  const row = await db
    .prepare(
      `SELECT response_status, response_body, expires_at
         FROM event_booking_idempotency_keys
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(params.key, params.lineAccountId, params.friendId)
    .first<{ response_status: number; response_body: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at) <= params.now) return null;
  return { status: row.response_status, body: JSON.parse(row.response_body) };
}

export type ReservationOutcome =
  | { kind: 'inserted' }
  | { kind: 'cached'; status: number; body: unknown }
  | { kind: 'in_progress' };

// Atomically reserve a key. status=0 / body='' means "in flight" — caller
// must finalize on completion. INSERT OR IGNORE guarantees only one writer
// wins for a given (key, account, friend); subsequent callers read the
// existing row and branch on whether response_status is still 0.
export async function reserveEventIdempotency(
  db: D1Database,
  args: { key: string; lineAccountId: string; friendId: string; ttlMinutes: number; now: Date },
): Promise<ReservationOutcome> {
  const expires = new Date(args.now.getTime() + args.ttlMinutes * 60_000).toISOString();
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO event_booking_idempotency_keys
         (key, line_account_id, friend_id, response_status, response_body, expires_at)
       VALUES (?, ?, ?, 0, '', ?)`,
    )
    .bind(args.key, args.lineAccountId, args.friendId, expires)
    .run();
  if ((ins.meta?.changes ?? 0) === 1) return { kind: 'inserted' };

  const row = await db
    .prepare(
      `SELECT response_status, response_body, expires_at
         FROM event_booking_idempotency_keys
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(args.key, args.lineAccountId, args.friendId)
    .first<{ response_status: number; response_body: string; expires_at: string }>();
  if (!row || new Date(row.expires_at) <= args.now) return { kind: 'inserted' };
  if (row.response_status === 0) return { kind: 'in_progress' };
  return {
    kind: 'cached',
    status: row.response_status,
    body: row.response_body ? JSON.parse(row.response_body) : null,
  };
}

export async function finalizeEventIdempotencyResponse(
  db: D1Database,
  args: { key: string; lineAccountId: string; friendId: string; status: number; body: unknown },
): Promise<void> {
  await db
    .prepare(
      `UPDATE event_booking_idempotency_keys
          SET response_status = ?, response_body = ?
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(args.status, JSON.stringify(args.body), args.key, args.lineAccountId, args.friendId)
    .run();
}

export async function purgeExpiredEventIdempotency(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM event_booking_idempotency_keys WHERE expires_at <= ?`)
    .bind(now.toISOString())
    .run();
  return result.meta?.changes ?? 0;
}
