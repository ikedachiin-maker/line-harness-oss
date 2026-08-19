import { describe, expect, test } from 'vitest';
import {
  findIdempotencyResponse,
  purgeExpiredIdempotency,
  saveIdempotencyResponse,
} from './booking-idempotency.js';

interface Row {
  key: string;
  line_account_id: string;
  friend_id: string;
  response_status: number;
  response_body: string;
  expires_at: string;
}

function memDB(): { db: D1Database; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          if (sql.startsWith('SELECT')) {
            // SELECT binds: key, line_account_id, friend_id
            const [key, accountId, friendId] = bound as [string, string, string];
            const row = rows.get(key);
            if (!row) return null;
            if (row.line_account_id !== accountId || row.friend_id !== friendId) return null;
            return row as T;
          }
          return null;
        },
        async run() {
          if (sql.startsWith('INSERT')) {
            const [key, accountId, friendId, status, body, expiresAt] = bound as [
              string, string, string, number, string, string,
            ];
            if (!rows.has(key)) {
              rows.set(key, {
                key,
                line_account_id: accountId,
                friend_id: friendId,
                response_status: status,
                response_body: body,
                expires_at: expiresAt,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE')) {
            const cutoff = String(bound[0]);
            let deleted = 0;
            for (const [key, row] of rows) {
              if (row.expires_at <= cutoff) {
                rows.delete(key);
                deleted++;
              }
            }
            return { success: true, meta: { changes: deleted } };
          }
          return { success: true, meta: {} };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, rows };
}

describe('idempotency', () => {
  test('save → find returns same response', async () => {
    const { db } = memDB();
    await saveIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      status: 201,
      body: { booking_id: 'B1' },
      ttlMinutes: 5,
      now: new Date('2026-05-08T00:00:00Z'),
    });
    const found = await findIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      now: new Date('2026-05-08T00:01:00Z'),
    });
    expect(found).toEqual({ status: 201, body: { booking_id: 'B1' } });
  });

  test('expired keys not returned', async () => {
    const { db } = memDB();
    await saveIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      status: 201,
      body: { booking_id: 'B1' },
      ttlMinutes: 5,
      now: new Date('2026-05-08T00:00:00Z'),
    });
    const found = await findIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      now: new Date('2026-05-08T00:06:00Z'),
    });
    expect(found).toBeNull();
  });

  test('未保存 key は null', async () => {
    const { db } = memDB();
    expect(
      await findIdempotencyResponse(db, {
        key: 'nope',
        lineAccountId: 'A1',
        friendId: 'F1',
        now: new Date(),
      }),
    ).toBeNull();
  });

  test('save: 同一 key の二度目は黙殺（最初の値を保持）', async () => {
    const { db } = memDB();
    await saveIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      status: 201,
      body: { booking_id: 'first' },
      ttlMinutes: 5,
      now: new Date('2026-05-08T00:00:00Z'),
    });
    await saveIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      status: 409,
      body: { error: 'second' },
      ttlMinutes: 5,
      now: new Date('2026-05-08T00:01:00Z'),
    });
    const found = await findIdempotencyResponse(db, {
      key: 'k1',
      lineAccountId: 'A1',
      friendId: 'F1',
      now: new Date('2026-05-08T00:02:00Z'),
    });
    expect(found?.body).toEqual({ booking_id: 'first' });
  });

  test('purgeExpired: 期限切れ行を削除して件数を返す', async () => {
    const { db, rows } = memDB();
    await saveIdempotencyResponse(db, {
      key: 'old',
      lineAccountId: 'A1',
      friendId: 'F1',
      status: 201,
      body: {},
      ttlMinutes: 5,
      now: new Date('2026-05-08T00:00:00Z'),
    });
    await saveIdempotencyResponse(db, {
      key: 'new',
      lineAccountId: 'A1',
      friendId: 'F1',
      status: 201,
      body: {},
      ttlMinutes: 5,
      now: new Date('2026-05-08T01:00:00Z'),
    });
    const purged = await purgeExpiredIdempotency(db, new Date('2026-05-08T00:30:00Z'));
    expect(purged).toBe(1);
    expect(rows.has('old')).toBe(false);
    expect(rows.has('new')).toBe(true);
  });
});
