import { describe, expect, test } from 'vitest';
import { runEventBookingExpirer } from './event-booking-expirer.js';

interface BookingRow {
  id: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  updated_at: string | null;
}
interface ReminderRow {
  id: string;
  booking_id: string;
  status: string;
}
interface IdemRow {
  key: string;
  expires_at: string;
}

function memDB(state: { bookings: BookingRow[]; reminders: ReminderRow[]; idem: IdemRow[] }): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T>() { return null as T | null; },
        async all<T>() {
          if (sql.includes('FROM event_bookings\n        WHERE status = \'requested\'')) {
            const [cutoff] = bound as [string];
            const items = state.bookings.filter(
              (b) => b.status === 'requested' && b.requested_at < cutoff,
            );
            return { results: items as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('UPDATE event_bookings\n            SET status = \'expired\'')) {
            const [decided_at, _updated_at, id] = bound as [string, string, string];
            const b = state.bookings.find((x) => x.id === id && x.status === 'requested');
            if (!b) return { success: true, meta: { changes: 0 } };
            b.status = 'expired';
            b.decided_at = decided_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE event_booking_reminders')) {
            const [booking_id] = bound as [string];
            let n = 0;
            for (const r of state.reminders) {
              if (r.booking_id === booking_id && (r.status === 'pending' || r.status === 'failed')) {
                r.status = 'cancelled';
                n++;
              }
            }
            return { success: true, meta: { changes: n } };
          }
          if (sql.startsWith('DELETE FROM event_booking_idempotency_keys')) {
            const [cutoff] = bound as [string];
            let n = 0;
            for (let i = state.idem.length - 1; i >= 0; i--) {
              if (state.idem[i].expires_at <= cutoff) {
                state.idem.splice(i, 1);
                n++;
              }
            }
            return { success: true, meta: { changes: n } };
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('runEventBookingExpirer', () => {
  test('expires requested bookings older than 24h', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const stale = '2026-05-08T11:00:00Z'; // > 24h ago
    const fresh = '2026-05-09T11:30:00Z'; // 30min ago
    const state = {
      bookings: [
        { id: 'b1', status: 'requested', requested_at: stale, decided_at: null, updated_at: null },
        { id: 'b2', status: 'requested', requested_at: fresh, decided_at: null, updated_at: null },
      ],
      reminders: [{ id: 'r1', booking_id: 'b1', status: 'pending' }],
      idem: [{ key: 'k1', expires_at: '2026-05-09T00:00:00Z' }],
    };
    const result = await runEventBookingExpirer(memDB(state), { now });
    expect(result.expired).toBe(1);
    expect(state.bookings[0].status).toBe('expired');
    expect(state.bookings[1].status).toBe('requested');
  });

  test('cancels related pending reminders', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const state = {
      bookings: [{ id: 'b1', status: 'requested', requested_at: '2026-05-08T00:00:00Z', decided_at: null, updated_at: null }],
      reminders: [
        { id: 'r1', booking_id: 'b1', status: 'pending' },
        { id: 'r2', booking_id: 'b1', status: 'sent' },
        { id: 'r3', booking_id: 'b2', status: 'pending' },
      ],
      idem: [],
    };
    await runEventBookingExpirer(memDB(state), { now });
    expect(state.reminders[0].status).toBe('cancelled');
    expect(state.reminders[1].status).toBe('sent');
    expect(state.reminders[2].status).toBe('pending');
  });

  test('purges expired idempotency keys', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const state = {
      bookings: [],
      reminders: [],
      idem: [
        { key: 'old', expires_at: '2026-05-08T00:00:00Z' },
        { key: 'new', expires_at: '2099-01-01T00:00:00Z' },
      ],
    };
    const result = await runEventBookingExpirer(memDB(state), { now });
    expect(result.idempotencyPurged).toBe(1);
    expect(state.idem.map((x) => x.key)).toEqual(['new']);
  });

  test('does nothing when no stale bookings', async () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const state = {
      bookings: [
        { id: 'b1', status: 'confirmed', requested_at: '2026-01-01T00:00:00Z', decided_at: null, updated_at: null },
      ],
      reminders: [],
      idem: [],
    };
    const result = await runEventBookingExpirer(memDB(state), { now });
    expect(result.expired).toBe(0);
  });
});
